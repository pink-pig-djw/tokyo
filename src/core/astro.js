// Sun and moon positions (low-precision astronomical formulas, good to ~0.1 deg),
// returned as unit vectors in world space: x = east, y = up, z = south.

const RAD = Math.PI / 180;
const E = RAD * 23.4397; // obliquity of the ecliptic

function toDays(date) {
  return date.valueOf() / 86400000 - 0.5 + 2440588 - 2451545;
}

function rightAscension(l, b) {
  return Math.atan2(Math.sin(l) * Math.cos(E) - Math.tan(b) * Math.sin(E), Math.cos(l));
}

function declination(l, b) {
  return Math.asin(Math.sin(b) * Math.cos(E) + Math.cos(b) * Math.sin(E) * Math.sin(l));
}

function siderealTime(d, lw) {
  return RAD * (280.16 + 360.9856235 * d) - lw;
}

function horizontal(H, phi, dec) {
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
  // azimuth measured from south, positive towards west
  const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { alt, az };
}

function toVector(alt, az, out) {
  const c = Math.cos(alt);
  out.set(-Math.sin(az) * c, Math.sin(alt), Math.cos(az) * c);
  return out;
}

export function sunDirection(date, lat, lon, out) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const M = RAD * (357.5291 + 0.98560028 * d);
  const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
  const L = M + C + RAD * 102.9372 + Math.PI;
  const dec = declination(L, 0);
  const ra = rightAscension(L, 0);
  const H = siderealTime(d, lw) - ra;
  const { alt, az } = horizontal(H, phi, dec);
  return toVector(alt, az, out);
}

export function moonDirection(date, lat, lon, out) {
  const lw = RAD * -lon;
  const phi = RAD * lat;
  const d = toDays(date);
  const L = RAD * (218.316 + 13.176396 * d);
  const M = RAD * (134.963 + 13.064993 * d);
  const F = RAD * (93.272 + 13.229350 * d);
  const l = L + RAD * 6.289 * Math.sin(M);
  const b = RAD * 5.128 * Math.sin(F);
  const dec = declination(l, b);
  const ra = rightAscension(l, b);
  const H = siderealTime(d, lw) - ra;
  const { alt, az } = horizontal(H, phi, dec);
  return toVector(alt, az, out);
}

/** A Date for the given JST wall-clock time on the JST calendar day of `base`. */
export function jstDate(base, hours) {
  const jst = new Date(base.valueOf() + 9 * 3600e3);
  const y = jst.getUTCFullYear(), m = jst.getUTCMonth(), dd = jst.getUTCDate();
  return new Date(Date.UTC(y, m, dd, 0, 0, 0) - 9 * 3600e3 + hours * 3600e3);
}

export function jstHours(date) {
  const jst = new Date(date.valueOf() + 9 * 3600e3);
  return jst.getUTCHours() + jst.getUTCMinutes() / 60 + jst.getUTCSeconds() / 3600;
}
