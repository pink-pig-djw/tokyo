// Global environment state: time of day, sun/moon, sky palette, weather.
// Every custom shader references the same uniform objects from `U`, so a single
// update per frame propagates to all materials.
import * as THREE from 'three';
import { sunDirection, moonDirection, jstDate, jstHours } from './astro.js';

export const TOKYO = { lat: 35.68, lon: 139.76 };

export const U = {
  uTime: { value: 0 },
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uMoonDir: { value: new THREE.Vector3(0, -1, 0) },
  uSunColor: { value: new THREE.Color() },
  uZenith: { value: new THREE.Color() },
  uHorizon: { value: new THREE.Color() },
  uGlow: { value: new THREE.Color() },
  uNight: { value: 0 },          // 0 = full day, 1 = full night
  uDusk: { value: 0 },           // peaks around sunset/sunrise
  uLitRes: { value: 0.3 },       // fraction of residential windows lit
  uLitOff: { value: 0.3 },       // fraction of office windows lit
  uWet: { value: 0 },            // rain wetness
  uSnow: { value: 0 },           // snow cover
  uCloud: { value: 0.35 },       // cloud coverage
  uSakura: { value: 0 },         // cherry blossom season
  uAutumn: { value: 0 },
  uSkytreeMode: { value: 0 },    // 0 = Iki (blue), 1 = Miyabi (purple)
  uFogDensity: { value: 0.00011 },
  uFogFalloff: { value: 1 / 700 },
  uCamPos: { value: new THREE.Vector3() },
  uFuji: { value: new THREE.Vector4(0, 0, 0, 0) }, // azimuth, elevation, half-width, visibility
  uExposure: { value: 1 },
  uDbgEmis: { value: 1 },
};

// sky palette keyframes by sun elevation (degrees)
const KEYS = [
  [-90, '#010208', '#050913', '#050913', 0.0],
  [-18, '#02040c', '#0a1020', '#0b1022', 0.0],
  [-12, '#040a1e', '#111b38', '#1b1c3a', 0.0],
  [-8, '#0a1636', '#25305a', '#4a3558', 0.15],
  [-4, '#152a5e', '#4a5582', '#b06a62', 0.35],
  [-1, '#22417c', '#7c7f99', '#ef8550', 0.6],
  [1, '#2c5290', '#a4a2a6', '#ff9a52', 0.8],
  [4, '#3965a8', '#bcbfc4', '#ffb878', 0.9],
  [10, '#447ac0', '#c9d3dc', '#ffdcae', 1.0],
  [25, '#3a74c4', '#bed4e6', '#fff0d8', 1.0],
  [90, '#2c66c0', '#adcbea', '#ffffff', 1.0],
];
const _c1 = new THREE.Color(), _c2 = new THREE.Color();

function samplePalette(el, out) {
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1][0]) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = THREE.MathUtils.clamp((el - a[0]) / (b[0] - a[0]), 0, 1);
  const lerp = (k, target) => target.copy(_c1.set(a[k])).lerp(_c2.set(b[k]), t);
  lerp(1, out.zenith);
  lerp(2, out.horizon);
  lerp(3, out.glow);
  out.daylight = a[4] + (b[4] - a[4]) * t;
}

export class Environment {
  constructor() {
    this.date = jstDate(new Date(), 17.1);
    this.timeScale = 0;           // simulated hours per real second when playing
    this.weather = 'clear';
    this.season = 'autumn';
    this.pal = { zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color(), daylight: 1 };
    this.sunEl = 0;
    this._wet = 0; this._snow = 0; this._cloud = 0.35; this._fogBoost = 1;
    const m = new Date(this.date.valueOf() + 9 * 3600e3).getUTCMonth() + 1;
    this.setSeason(m >= 3 && m <= 4 ? 'spring' : m >= 5 && m <= 9 ? 'summer' : m >= 10 && m <= 11 ? 'autumn' : 'winter');
  }

  sunElevation() {
    const v = sunDirection(this.date, TOKYO.lat, TOKYO.lon, new THREE.Vector3());
    return Math.asin(THREE.MathUtils.clamp(v.y, -1, 1)) * 180 / Math.PI;
  }

  get hours() { return jstHours(this.date); }

  setHours(h) {
    this.date = jstDate(this.date, ((h % 24) + 24) % 24);
  }

  setWeather(w) { this.weather = w; }

  setSeason(s) {
    this.season = s;
    U.uSakura.value = s === 'spring' ? 1 : 0;
    U.uAutumn.value = s === 'autumn' ? 1 : 0;
    // winter brings snow on Fuji; actual snowfall is a weather choice
  }

  update(dt, sunLight, moonLight, hemi, camera) {
    if (this.timeScale) this.date = new Date(this.date.valueOf() + dt * this.timeScale * 3600e3);
    U.uTime.value += dt;
    const sun = sunDirection(this.date, TOKYO.lat, TOKYO.lon, U.uSunDir.value);
    moonDirection(this.date, TOKYO.lat, TOKYO.lon, U.uMoonDir.value);
    const el = Math.asin(THREE.MathUtils.clamp(sun.y, -1, 1)) * 180 / Math.PI;
    this.sunEl = el;
    samplePalette(el, this.pal);

    // weather blending
    const k = 1 - Math.exp(-dt * 0.8);
    const targetWet = this.weather === 'rain' ? 1 : 0;
    const targetSnow = this.weather === 'snow' ? 1 : 0;
    const targetCloud = this.weather === 'clear' ? 0.3 : this.weather === 'rain' ? 0.95 : this.weather === 'snow' ? 0.9 : 0.3;
    this._wet += (targetWet - this._wet) * k;
    this._snow += (targetSnow - this._snow) * k * 0.6;
    this._cloud += (targetCloud - this._cloud) * k;
    U.uWet.value = this._wet;
    U.uSnow.value = this._snow;
    U.uCloud.value = this._cloud;
    const overcast = Math.max(this._wet, this._snow);

    const night = THREE.MathUtils.smoothstep(-el, -2, 9);  // 0 above +2deg, 1 below -9deg
    U.uNight.value = night;
    U.uDusk.value = Math.exp(-Math.pow((el - 1) / 7, 2));

    // overcast: desaturate and darken the sky
    const grey = (c, amt) => {
      const l = c.r * 0.3 + c.g * 0.55 + c.b * 0.15;
      c.lerp(_c1.setRGB(l, l, l * 1.04), amt);
    };
    grey(this.pal.zenith, overcast * 0.75);
    grey(this.pal.horizon, overcast * 0.6);
    grey(this.pal.glow, overcast * 0.8);
    this.pal.zenith.multiplyScalar(1 - overcast * 0.35);
    this.pal.horizon.multiplyScalar(1 - overcast * 0.25);

    // Tokyo light pollution: warm skyglow near the horizon at night
    _c1.setRGB(0.028, 0.02, 0.03).multiplyScalar(night * (1 + overcast * 2.5));
    this.pal.horizon.add(_c1);
    _c1.setRGB(0.006, 0.005, 0.007).multiplyScalar(night * (1 + overcast * 3));
    this.pal.zenith.add(_c1);

    U.uZenith.value.copy(this.pal.zenith);
    U.uHorizon.value.copy(this.pal.horizon);
    U.uGlow.value.copy(this.pal.glow);

    // window lighting schedule by local hour
    const h = this.hours;
    const resCurve = (hh) => {
      if (hh < 5) return 0.06 + 0.04 * (5 - hh) / 5;
      if (hh < 7) return 0.06 + 0.2 * (hh - 5) / 2;
      if (hh < 9) return 0.26 - 0.16 * (hh - 7) / 2;
      if (hh < 16) return 0.1;
      if (hh < 20) return 0.1 + 0.42 * (hh - 16) / 4;
      if (hh < 23) return 0.52 - 0.12 * (hh - 20) / 3;
      return 0.4 - 0.3 * (hh - 23);
    };
    const offCurve = (hh) => {
      if (hh < 6) return 0.1;
      if (hh < 9) return 0.1 + 0.5 * (hh - 6) / 3;
      if (hh < 18) return 0.6;
      if (hh < 22) return 0.6 - 0.35 * (hh - 18) / 4;
      return 0.25 - 0.15 * Math.min(1, (hh - 22) / 2);
    };
    U.uLitRes.value = resCurve(h);
    U.uLitOff.value = offCurve(h);

    // fog / haze
    const fogBase = 0.00010 + 0.00005 * night;
    U.uFogDensity.value = fogBase * (1 + this._wet * 5 + this._snow * 7);
    U.uFogFalloff.value = 1 / (700 + 600 * overcast);

    // lights
    const sunUp = THREE.MathUtils.smoothstep(el, -3, 6);
    const sc = this.pal.glow.clone().lerp(new THREE.Color(1, 0.97, 0.92), THREE.MathUtils.smoothstep(el, 8, 35));
    U.uSunColor.value.copy(sc);
    sunLight.color.copy(sc);
    sunLight.intensity = 3.2 * sunUp * (1 - overcast * 0.8);
    const moon = U.uMoonDir.value;
    moonLight.intensity = 0.25 * night * THREE.MathUtils.smoothstep(moon.y, 0.0, 0.25) * (1 - overcast * 0.8);
    moonLight.color.setRGB(0.62, 0.72, 1.0);
    hemi.color.copy(this.pal.zenith).lerp(this.pal.horizon, 0.5).multiplyScalar(1.4);
    hemi.groundColor.setRGB(0.25, 0.23, 0.2).multiplyScalar(0.3 + 0.7 * (1 - night));
    // city glow from below at night
    hemi.groundColor.lerp(new THREE.Color(0.2, 0.12, 0.07), night * 0.8);
    hemi.intensity = (0.6 + 0.55 * (1 - overcast)) * (1 - night) + 0.12 * night;

    U.uExposure.value = 1.0 + night * 0.35;
    U.uCamPos.value.copy(camera.position);
    return { el, night };
  }
}
