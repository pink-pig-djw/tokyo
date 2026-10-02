// City buildings: MeshStandardMaterial extended with a procedural facade system.
// 24 facade archetypes (houses, mansions, danchi, pencil buildings, offices,
// curtain-wall / finned / banded / residential towers, industry, temples, hotels),
// each randomised per building (bay width, floor height, glass tint, spandrels,
// balcony rails, fins, podium, mechanical floors, louvered crowns) and a deliberately
// "messy" night: per-building occupancy, mixed colour temperatures, hotels, malls,
// tenant-by-floor zakkyo buildings, TV flicker and coloured LED accents.
import * as THREE from 'three';
import { U } from '../core/env.js';

const FACADE_PARS = /* glsl */`
uniform float uNight;
uniform float uLitRes;
uniform float uLitOff;
uniform float uTime;
uniform float uSnow;
uniform float uWet;
uniform vec3 uWallPal[36];
uniform vec3 uRoofPal[16];
uniform vec3 uGlassPal[10];
uniform float uDbgEmis;
uniform float uWinLod;
varying vec3 vWPos;
varying float vU;
flat varying vec4 vInfo;
flat varying vec4 vInfo2;

float fh11(float n) { return fract(sin(n * 127.1) * 43758.5453); }
float fh21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

const vec3 SPANDREL[8] = vec3[8](
  vec3(0.86, 0.85, 0.82), vec3(0.62, 0.63, 0.62), vec3(0.42, 0.43, 0.44), vec3(0.16, 0.17, 0.19),
  vec3(0.55, 0.32, 0.24), vec3(0.74, 0.67, 0.55), vec3(0.55, 0.64, 0.68), vec3(0.09, 0.1, 0.11));
const vec3 ACCENT[6] = vec3[6](
  vec3(0.2, 0.45, 1.0), vec3(0.65, 0.25, 1.0), vec3(0.1, 0.9, 1.0), vec3(0.2, 1.0, 0.45),
  vec3(1.0, 0.25, 0.65), vec3(1.0, 0.72, 0.25));

// colour temperature ramp: 0 = 2700K .. 1 = 6500K
vec3 cct(float k) {
  k = clamp(k, 0.0, 1.0) * 4.0;
  vec3 c0 = vec3(1.0, 0.56, 0.24), c1 = vec3(1.0, 0.7, 0.42), c2 = vec3(1.0, 0.84, 0.64),
       c3 = vec3(0.97, 0.95, 0.9), c4 = vec3(0.8, 0.9, 1.0);
  if (k < 1.0) return mix(c0, c1, k);
  if (k < 2.0) return mix(c1, c2, k - 1.0);
  if (k < 3.0) return mix(c2, c3, k - 2.0);
  return mix(c3, c4, k - 3.0);
}

float boxm(float x, float lo, float hi, float fw) {
  return smoothstep(lo - fw, lo + fw, x) * (1.0 - smoothstep(hi - fw, hi + fw, x));
}

vec4 facade(out float rough, out float metal, out vec3 emis) {
  vec3 cr = cross(dFdx(vWPos), dFdy(vWPos));
  float crl = length(cr);
  vec3 wN = crl > 1e-12 ? cr / crl : vec3(0.0, 1.0, 0.0);
  bool roof = abs(wN.y) > 0.45;
  int wallIdx = int(vInfo.x + 0.5);
  int roofIdx = int(vInfo.y + 0.5);
  float bh = vInfo2.x * 0.1;
  int fl = int(vInfo2.y + 0.5);
  float minh = float(fl >> 8);
  int flags = fl & 255;
  int arch = int(vInfo2.z + 0.5);
  float R = floor(vInfo2.w + 0.5);
  float r1 = fh11(R * 0.0137 + 0.31), r2 = fh11(R * 0.0291 + 1.7), r3 = fh11(R * 0.0419 + 2.9);
  float r4 = fh11(R * 0.0533 + 4.1), r5 = fh11(R * 0.0617 + 5.3), r6 = fh11(R * 0.0743 + 6.7);
  float r7 = fh11(R * 0.0871 + 7.9), r8 = fh11(R * 0.0997 + 9.1);
  bool zone = (flags & 2) != 0;
  emis = vec3(0.0);

  if (roof) {
    vec3 c = uRoofPal[roofIdx] * (0.8 + 0.4 * r1);
    // a few big flat roofs are planted (rooftop gardens are common on newer buildings)
    if (r6 > 0.9 && bh > 20.0 && arch >= 7) c = mix(c, vec3(0.2, 0.3, 0.13), 0.75);
    c = mix(c, vec3(0.93, 0.95, 0.98), uSnow * smoothstep(0.35, 0.8, abs(wN.y)));
    rough = mix(0.85, 0.35, uWet);
    metal = (arch == 19 || arch == 20) ? 0.35 : 0.0;
    return vec4(c, 0.0);
  }

  vec3 wall = uWallPal[wallIdx] * (0.8 + 0.4 * r1);
  vec3 glass = uGlassPal[int(r2 * 9.99)] * (0.55 + 0.6 * r3);
  vec3 spand = SPANDREL[int(r4 * 7.99)];
  float y = vWPos.y;
  float u = vU + r1 * 37.0;

  // ------------------------------------------------ archetype parameters
  float floorH = 3.0, bayW = 3.2, ground = 3.4;
  vec2 lo = vec2(0.15, 0.3), hi = vec2(0.85, 0.88);
  float bandH = 0.0; vec3 bandCol = wall;
  float finW = 0.0, finEvery = 1.0; vec3 finCol = wall;
  float mechEvery = 0.0, presence = 1.0, podiumFl = 0.0, topFl = 0.0;
  vec3 podCol = wall;
  vec3 frame = wall;
  float gRough = 0.14, gMetal = 0.35;
  int mode = 0;          // 0 home, 1 office, 2 hotel, 3 tenants-by-floor, 4 sparse
  float cctB = 0.15;
  bool ribs = false;

  if (arch == 0) { floorH = 2.8; bayW = 2.6 + r5 * 1.8; ground = 0.0; lo = vec2(0.3, 0.33); hi = vec2(0.7, 0.8); presence = 0.55; gRough = 0.25; gMetal = 0.15; cctB = 0.08 + 0.2 * r6; }
  else if (arch == 1) { frame = mix(wall, vec3(0.12, 0.12, 0.13), 0.78); floorH = 2.9; bayW = 4.0; ground = 0.0; lo = vec2(0.1, 0.2); hi = vec2(0.55, 0.9); presence = 0.45; cctB = 0.3; }
  else if (arch == 2) { floorH = 2.8; bayW = 3.0; ground = 0.0; lo = vec2(0.2, 0.3); hi = vec2(0.8, 0.85); presence = 0.6; frame = wall * 0.9; cctB = 0.05; }
  else if (arch == 3) { floorH = 2.95; bayW = 3.4 + r5 * 2.4; ground = 3.4; lo = vec2(0.06, 0.38); hi = vec2(0.94, 0.96); bandH = 0.36; bandCol = mix(SPANDREL[0], spand, step(0.55, r6) * 0.85); cctB = 0.1 + 0.25 * r7; }
  else if (arch == 4) { floorH = 3.0; bayW = 4.0 + r5 * 2.0; ground = 3.6; lo = vec2(0.05, 0.4); hi = vec2(0.95, 0.96); bandH = 0.4; bandCol = mix(vec3(0.5, 0.62, 0.66), vec3(0.32, 0.36, 0.38), r6); cctB = 0.2 + 0.3 * r7; }
  else if (arch == 5) { floorH = 2.75; bayW = 3.6; ground = 0.6; lo = vec2(0.18, 0.35); hi = vec2(0.82, 0.85); bandH = 0.3; bandCol = wall * 1.1; frame = wall * 0.95; cctB = 0.35 + 0.4 * r7; }
  else if (arch == 6) { floorH = 2.9; bayW = 2.4 + r5; ground = 3.0; lo = vec2(0.22, 0.3); hi = vec2(0.78, 0.8); presence = 0.85; cctB = 0.1 + 0.2 * r7; }
  else if (arch == 7) { floorH = 3.6 + r5 * 0.6; bayW = 1.8 + r6 * 1.2; ground = 4.5; lo = vec2(0.02, 0.38); hi = vec2(0.98, 0.9); frame = spand; mode = 1; cctB = 0.55 + 0.45 * r6; gMetal = 0.5; }
  else if (arch == 8) { floorH = 3.7 + r5 * 0.5; bayW = 1.6 + r6 * 1.4; ground = 4.8; lo = vec2(0.18, 0.26); hi = vec2(0.82, 0.86); mode = 1; cctB = 0.45 + 0.45 * r6; }
  else if (arch == 9) { floorH = 3.8; bayW = 1.2 + r5 * 0.6; ground = 5.0; lo = vec2(0.0, 0.12); hi = vec2(1.0, 0.95); finW = 0.12 + r6 * 0.1; finCol = mix(wall, SPANDREL[0], 0.5); mode = 1; cctB = 0.6 + 0.4 * r7; }
  else if (arch == 10) { floorH = 3.2 + r5 * 0.6; bayW = 2.0 + r6 * 2.0; ground = 3.6; lo = vec2(0.08, 0.25); hi = vec2(0.92, 0.85); mode = 3; cctB = 0.5; }
  else if (arch == 11) { floorH = 3.9; bayW = 1.8 + r5; ground = 5.5; lo = vec2(0.08, 0.1); hi = vec2(0.92, 0.92); frame = mix(spand, wall, 0.4); mode = 1; cctB = 0.7 + 0.3 * r7; gMetal = 0.6; gRough = 0.08; }
  else if (arch == 12) { floorH = 4.0; bayW = 1.5; ground = 6.0; lo = vec2(0.03, 0.04); hi = vec2(0.97, 0.97); frame = glass * 0.7; mode = 1; cctB = 0.65 + 0.35 * r7; gMetal = 0.75; gRough = 0.05; }
  else if (arch == 13) { floorH = 4.1; bayW = 1.6; ground = 6.0; lo = vec2(0.02, 0.3); hi = vec2(0.98, 0.95); frame = mix(SPANDREL[1], SPANDREL[2], r6); mode = 1; cctB = 0.75 + 0.25 * r7; gMetal = 0.7; gRough = 0.06; }
  else if (arch == 14) { floorH = 4.0; bayW = 1.4; ground = 6.0; lo = vec2(0.0, 0.06); hi = vec2(1.0, 0.96); finW = 0.16; finEvery = 2.0; finCol = SPANDREL[0] * 0.9; mode = 1; cctB = 0.55 + 0.4 * r7; gMetal = 0.65; }
  else if (arch == 15) { glass = vec3(0.035, 0.045, 0.055) + glass * 0.1; floorH = 4.0; bayW = 1.5; ground = 6.5; lo = vec2(0.02, 0.05); hi = vec2(0.98, 0.96); frame = vec3(0.08, 0.09, 0.1); mode = 4; cctB = 0.9; gMetal = 0.85; gRough = 0.04; }
  else if (arch == 16) { floorH = 3.9; bayW = 1.8 + r5 * 0.8; ground = 6.0; lo = vec2(0.2, 0.2); hi = vec2(0.8, 0.85); mode = 1; cctB = 0.45 + 0.4 * r7; }
  else if (arch == 17) { floorH = 4.0; bayW = 1.6; ground = 6.0; lo = vec2(0.04, 0.15); hi = vec2(0.96, 0.94); mechEvery = 8.0 + floor(r5 * 10.0); frame = mix(glass, spand, 0.5); mode = 1; cctB = 0.6 + 0.4 * r7; gMetal = 0.6; }
  else if (arch == 18) { floorH = 3.15; bayW = 5.0 + r5 * 2.0; ground = 6.0; lo = vec2(0.03, 0.42); hi = vec2(0.97, 0.97); bandH = 0.42; bandCol = mix(vec3(0.55, 0.66, 0.7), SPANDREL[0], step(0.5, r6)); cctB = 0.12 + 0.3 * r7; gMetal = 0.5; }
  else if (arch == 19) { floorH = 6.0; bayW = 7.0; ground = 0.0; lo = vec2(0.05, 0.62); hi = vec2(0.95, 0.82); presence = 0.35; mode = 4; cctB = 0.9; ribs = true; }
  else if (arch == 20) { floorH = 4.5; bayW = 6.0; ground = 0.0; lo = vec2(0.1, 0.55); hi = vec2(0.9, 0.75); presence = 0.25; mode = 4; cctB = 0.95; }
  else if (arch == 22) { floorH = 5.0; bayW = 3.0; ground = 0.0; lo = vec2(0.05, 0.3); hi = vec2(0.95, 0.85); mode = 1; cctB = 0.85; }
  else if (arch == 23) { floorH = 3.1; bayW = 3.6 + r5; ground = 6.0; lo = vec2(0.25, 0.28); hi = vec2(0.75, 0.82); mode = 2; cctB = 0.05 + 0.2 * r7; }

  if (arch == 21) {
    // temples / shrines: plaster and dark timber, no glazing
    vec3 c = wall;
    float post = boxm(fract(vU / 3.6), 0.0, 0.12, fwidth(vU / 3.6));
    c = mix(c, vec3(0.2, 0.12, 0.08), post * 0.8);
    c *= mix(0.6, 1.0, smoothstep(0.0, 6.0, y - minh));
    rough = 0.9; metal = 0.0;
    emis = vec3(1.0, 0.6, 0.3) * uNight * 0.05;
    return vec4(c, 0.0);
  }
  if (((arch >= 7 && arch <= 17) || arch == 23) && r7 < 0.6) {
    podiumFl = 1.0 + floor(r6 * 3.0);
    podCol = r5 < 0.5 ? vec3(0.07, 0.08, 0.09) : SPANDREL[int(r3 * 7.99)];
  }
  if (arch >= 12 && arch <= 18 && r6 < 0.55) topFl = 1.0 + floor(r8 * 2.5);

  // ------------------------------------------------ pattern
  float yy = y - minh - ground;
  float podH = podiumFl * 4.6;
  float yy2 = yy - podH;
  vec2 cell = vec2(u / bayW, yy2 / floorH);
  vec2 id = floor(cell);
  vec2 f = fract(cell);
  vec2 fw = fwidth(cell);
  float pix = max(fw.x, fw.y);
  float far = smoothstep(0.3 - 0.12 * uWinLod, 0.85 - 0.3 * uWinLod, pix);
  float nFloors = floor((bh - minh - ground - podH) / floorH);
  float body = step(0.0, yy2) * step(y, bh - 1.2);
  bool topZone = topFl > 0.0 && id.y >= nFloors - topFl;
  bool mech = mechEvery > 0.0 && mod(id.y, mechEvery) > mechEvery - 1.5;
  float present = presence >= 1.0 ? 1.0 : step(1.0 - presence, fh21(id + R * 0.01));
  float win = boxm(f.x, lo.x, hi.x, fw.x) * boxm(f.y, lo.y, hi.y, fw.y) * present * body;
  float avgWin = (hi.x - lo.x) * (hi.y - lo.y) * presence * body;

  vec3 col = frame;
  vec3 avgFrame = frame;
  if (bandH > 0.0) {
    float band = 1.0 - smoothstep(bandH - fw.y, bandH + fw.y, f.y);
    col = mix(col, bandCol, band);
    avgFrame = mix(frame, bandCol, min(1.0, bandH / max(1.0 - (hi.y - lo.y), 0.01)));
  }
  float finM = 0.0;
  if (finW > 0.0) {
    float fx = fract(cell.x / finEvery);
    float fwf = fwidth(cell.x / finEvery);
    float wdt = finW / finEvery;
    finM = 1.0 - smoothstep(wdt - fwf, wdt + fwf, min(fx, 1.0 - fx));
    col = mix(col, finCol, finM);
    win *= 1.0 - finM;
    avgWin *= 1.0 - wdt * 2.0;
    avgFrame = mix(avgFrame, finCol, wdt * 2.0);
  }
  if (ribs) {
    float rb = fract(u / 0.6);
    col *= 0.88 + 0.12 * smoothstep(0.2, 0.5, abs(rb - 0.5)) * (1.0 - far);
  }
  if (topZone || mech) {
    // louvered plant floors
    float lv = step(0.5, fract(yy2 / 0.45));
    vec3 lc = mix(SPANDREL[2], SPANDREL[3], 0.5 + 0.5 * r1);
    col = mix(lc, lc * 0.7, lv * (1.0 - far));
    avgFrame = lc * 0.85;
    win = 0.0;
    avgWin = 0.0;
  }
  // podium / lobby: tall glazing or stone base
  bool inPod = podiumFl > 0.0 && yy >= 0.0 && yy < podH;
  if (inPod) {
    float pc = fract(u / 6.0);
    float pg = boxm(pc, 0.06, 0.94, fwidth(u / 6.0)) * boxm(fract(yy / 4.6), 0.08, 0.92, fwidth(yy / 4.6));
    col = mix(podCol, glass * 0.6, pg);
    avgFrame = mix(podCol, glass * 0.6, 0.7);
    win = pg; avgWin = 0.7;
  }

  // window glass by day: tinted, with per-pane variation (blinds, curtains, open sashes)
  float pane = fh21(id * 1.37 + R * 0.003);
  vec3 g = glass * (0.75 + 0.5 * pane);
  if (mode == 0 || mode == 2) g = mix(g, vec3(0.55, 0.52, 0.48), step(0.8, pane) * 0.5); // curtains
  vec3 nearCol = mix(col, g, win);
  vec3 farCol = mix(avgFrame, glass * 0.9, avgWin);
  vec3 outCol = mix(nearCol, farCol, far);
  float wm = mix(win, avgWin, far);

  // ------------------------------------------------ night lights
  // building activity: long-tailed, so neighbours differ wildly
  float act = pow(r4, 2.0) * 2.2;
  if (r5 < 0.07) act = 0.03;            // vacant / closed
  if (r6 > 0.94) act = 4.0;             // everyone's working late
  float base = mode == 0 ? uLitRes : mode == 1 ? uLitOff : mode == 2 ? 0.55 : mode == 3 ? max(uLitOff, uLitRes) : 0.06;
  if (zone) base = min(0.9, base * 1.25 + 0.06);
  float frac = clamp(base * act, 0.0, 0.95);
  float bright = (0.25 + 0.75 * r3 * r3) * 0.55;  // lamp type / glazing transmission

  float hw = fh21(id + vec2(R * 0.0113, R * 0.0071));
  float gs = 2.0 + floor(r7 * 5.0);                      // tenants take several floors
  float hf = fh11(floor(id.y / gs) * 1.731 + R * 0.0057) * 0.85 + fh11(id.y * 7.3 + R * 0.001) * 0.15;
  float hb = fh21(vec2(floor(id.x / 7.0), id.y) + R * 0.002); // per tenant bay
  float on;
  float k = cctB;
  float inten;
  vec3 special = vec3(-1.0);
  if (mode == 1) {
    // offices light up in runs: whole floors / tenant sections, rarely single windows
    float segLen = 3.0 + floor(r8 * 8.0);
    float hs = fh21(vec2(floor(id.x / segLen), id.y) + R * 0.0031);
    on = step(hf, frac * 1.15) * step(hs, 0.82 + frac * 0.15) * step(hw, 0.975);
    k = cctB + (hf - 0.5) * 0.35;
    inten = 0.6;
  } else if (mode == 2) {
    on = step(hw, 0.4 + 0.35 * r8);
    k = cctB + (hw - 0.5) * 0.2;
    inten = 0.35;
  } else if (mode == 3) {
    on = step(hf, frac * 1.3 + 0.1) * step(hw, 0.88);
    k = hf;
    inten = 0.8;
    if (fh11(id.y * 3.3 + R * 0.01) > (zone ? 0.72 : 0.9)) special = ACCENT[int(fh11(id.y + R) * 5.99)] * 0.8;
  } else {
    // homes: a household spans ~2 bays, so windows switch on in pairs
    float hu = fh21(vec2(floor(id.x / 2.0), id.y) + R * 0.0093);
    on = step(hu, frac) * step(hw, 0.9);
    k = cctB + (hu - 0.5) * 0.3;
    inten = mode == 4 ? 0.6 : 0.6;
    // television flicker
    if (mode == 0 && hw > 0.965 && uNight > 0.0) special = vec3(0.45, 0.62, 1.0) * (0.6 + 0.4 * sin(uTime * 7.0 + hw * 50.0) * sin(uTime * 2.3 + hw * 9.0));
  }
  vec3 lc = special.x >= 0.0 ? special : cct(k);
  float jitter = mode == 1 ? 0.85 + 0.15 * fh21(id * 2.17 + R * 0.001) : 0.55 + 0.45 * fh21(id * 2.17 + R * 0.001);
  float wiN = on * win * inten * bright * jitter;
  // far: preserve the per-floor / per-group variation instead of a flat average
  float grp = mode == 1 ? hf : fh21(vec2(floor(id.x / 4.0), floor(id.y / 3.0)) + R * 0.003);
  float farLit = avgWin * clamp(frac * (0.5 + grp * 1.0), 0.0, 1.0) * inten * bright * 0.8;
  vec3 farC = cct(cctB + (grp - 0.5) * 0.3);
  if (mode == 3) farC = mix(farC, ACCENT[int(r8 * 5.99)], zone ? 0.35 : 0.1);
  float ambientWin = win * (1.0 - on) * frac * 0.08 * bright;
  vec3 lit = mix(lc * wiN + cct(cctB) * ambientWin, farC * farLit, far);
  if (topZone || mech) lit = vec3(0.0);
  // lobby / mall podium: bright at street level, often brighter than the floors above
  if (inPod) lit = cct(0.2 + 0.5 * r2) * win * (0.18 + 0.5 * step(0.45, r8)) * (zone ? 1.3 : 1.0);
  float nightW = max(uNight, (mode == 1 && uLitOff > 0.3) ? 0.06 : 0.0);
  emis += lit * nightW;

  // LED accents: coloured fins / floor edges on some towers and nightlife buildings
  if (bh > 60.0 && r8 > 0.86 || zone && bh > 18.0 && r8 > 0.8) {
    vec3 ac = ACCENT[int(r1 * 5.99)];
    float every = 3.0 + floor(r2 * 4.0);
    float floorSel = step(mod(id.y, every), 0.5) + step(nFloors - 2.5, id.y);
    float lw = max(0.05, fw.y * 1.2);
    float edge = finM > 0.0 ? finM * step(0.5, fract(id.x * 0.5)) : (1.0 - smoothstep(lw, lw + fw.y, f.y)) * body * min(floorSel, 1.0) * (0.05 / lw);
    emis += ac * edge * uNight * 1.6 * (1.0 - far * 0.6);
  }

  // street-level shops
  if ((flags & 16) != 0 && minh < 1.0 && y < 3.6 && y > 0.4) {
    float seg = floor(u / 5.5);
    float shop = step(0.22, fh21(vec2(seg, R * 0.01)));
    float sk = fh11(seg + R * 0.003);
    vec3 sc = sk < 0.2 ? cct(0.9) : sk < 0.7 ? cct(0.15 + sk * 0.3) : (sk < 0.88 ? cct(0.55) : ACCENT[int(fh11(seg * 7.0) * 5.99)]);
    float sm = shop * smoothstep(0.02, 0.1, fract(u / 5.5)) * smoothstep(0.98, 0.9, fract(u / 5.5));
    outCol = mix(outCol, vec3(0.08, 0.09, 0.1), sm * 0.8);
    emis += sc * sm * (0.7 + 0.8 * sk) * max(uNight, 0.12);
    wm = max(wm, sm);
  }

  // crown lighting on supertall towers (colour varies)
  if ((flags & 8) != 0 && r5 > 0.45) {
    vec3 cc = r2 < 0.55 ? cct(0.3 + r3 * 0.7) : ACCENT[int(r3 * 5.99)];
    if (r7 < 0.5) {
      // thin band under the parapet
      float band = smoothstep(bh - 3.2, bh - 2.4, y) * (1.0 - smoothstep(bh - 1.2, bh - 0.6, y));
      emis += cc * band * 1.0 * uNight;
    } else {
      // washed top floors, fading downwards
      float wash = smoothstep(bh - 14.0 - r8 * 12.0, bh - 1.0, y) * step(y, bh - 0.5);
      emis += cc * wash * wash * 0.35 * uNight;
    }
  }

  // contact darkening near the ground
  outCol *= mix(0.62, 1.0, smoothstep(0.0, 9.0, y - minh));
  outCol *= 1.0 - uWet * 0.18;
  rough = mix(0.86, gRough, wm);
  rough = mix(rough, rough * 0.45, uWet);
  metal = mix(0.0, gMetal, wm);
  emis *= uDbgEmis;
  return vec4(outCol, wm);
}
`;

const GLASS_PALETTE = ['#2e4756', '#22404a', '#3b4a55', '#5d6f78', '#1d2730', '#4c5a4e', '#5a4c3e', '#6f8a99', '#3a3f47', '#80939c'];

let sharedMaterial = null;

export function buildingMaterial(manifest) {
  if (sharedMaterial) return sharedMaterial;
  const wallPal = manifest.wallPalette.map((h) => new THREE.Color(h));
  const roofPal = manifest.roofPalette.map((h) => new THREE.Color(h));
  while (wallPal.length < 36) wallPal.push(new THREE.Color(0.8, 0.8, 0.8));
  while (roofPal.length < 16) roofPal.push(new THREE.Color(0.5, 0.5, 0.5));
  const glassPal = GLASS_PALETTE.map((h) => new THREE.Color(h));

  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0, flatShading: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, {
      uNight: U.uNight, uLitRes: U.uLitRes, uLitOff: U.uLitOff, uTime: U.uTime, uSnow: U.uSnow, uWet: U.uWet,
      uWallPal: { value: wallPal }, uRoofPal: { value: roofPal }, uGlassPal: { value: glassPal },
      uDbgEmis: U.uDbgEmis, uWinLod: U.uWinLod,
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aU;
        attribute vec4 aInfo;
        attribute vec4 aInfo2;
        varying vec3 vWPos;
        varying float vU;
        flat varying vec4 vInfo;
        flat varying vec4 vInfo2;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vU = aU * 0.1;
        vInfo = aInfo;
        vInfo2 = aInfo2;
        vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FACADE_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float fRough, fMetal; vec3 fEmis;
        vec4 fac = facade(fRough, fMetal, fEmis);
        diffuseColor.rgb = fac.rgb;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = fMetal;')
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = fEmis;');
  };
  mat.customProgramCacheKey = () => 'tokyo-building-v2';
  sharedMaterial = mat;
  return mat;
}

/** Create THREE meshes for one processed chunk. */
export function createChunkMeshes(chunkRes, material) {
  const meshes = [];
  for (const b of chunkRes.batches) {
    const g = new THREE.BufferGeometry();
    const ib = new THREE.InterleavedBuffer(b.pos, 4);
    g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0, false));
    g.setAttribute('aU', new THREE.InterleavedBufferAttribute(ib, 1, 3, false));
    g.setAttribute('aInfo', new THREE.BufferAttribute(b.info, 4, false));
    g.setAttribute('aInfo2', new THREE.BufferAttribute(b.info2, 4, false));
    g.setIndex(new THREE.BufferAttribute(b.idx, 1));
    const [cx, cy, cz, r] = b.sphere;
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, cy, cz), r);
    g.boundingBox = new THREE.Box3(
      new THREE.Vector3(cx - r, cy - r, cz - r), new THREE.Vector3(cx + r, cy + r, cz + r));
    const m = new THREE.Mesh(g, material);
    m.position.set(chunkRes.cx, 0, chunkRes.cz);
    m.scale.setScalar(0.05);
    m.castShadow = true;
    m.receiveShadow = true;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    m.userData.small = b.small;
    m.userData.center = new THREE.Vector3(chunkRes.cx + cx * 0.05, cy * 0.05, chunkRes.cz + cz * 0.05);
    m.userData.radius = r * 0.05;
    meshes.push(m);
  }
  return meshes;
}
