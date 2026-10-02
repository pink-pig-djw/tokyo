import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { U, Environment } from './core/env.js';
import { Post } from './core/post.js';
import { PlanarReflection } from './core/reflection.js';
import { detectGpuLevel, resolveQuality, LodManager } from './core/quality.js';
import { createSky } from './world/sky.js';
import { createGround } from './world/ground.js';
import { buildingMaterial, createChunkMeshes } from './world/buildings.js';
import { fetchBinary, fetchJSON, parseGround, parseFar, parseExtras, parseRoutes } from './data/loader.js';
import { createTraffic } from './world/traffic.js';
import { Weather } from './world/weather.js';
import { createRoads } from './world/roads.js';
import { createLandmarks, makeLL } from './world/landmarks.js';
import { Director } from './core/director.js';
import { Tour } from './core/tour.js';
import { UI } from './ui/ui.js';
import { PLACES } from './ui/places.js';
import {
  createTrees, createLamps, createAviation, createRoofUnits, createSigns, createSprawl, setTileDensity,
} from './world/extras.js';
import { WorkerPool } from './data/workerPool.js';

const params = new URLSearchParams(location.search);
const LEVELS = ['low', 'medium', 'high'];
const FLAGS = { noao: params.has('noao'), norefl: params.has('norefl') };

function storedQuality() {
  try { return localStorage.getItem('tokyo3d.quality'); } catch (e) { return null; }
}

export class App {
  constructor(canvas) {
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
      preserveDrawingBuffer: params.has('shot'),
    });
    const detected = detectGpuLevel(this.renderer.getContext());
    this.gpu = detected.gpu;
    const wanted = params.get('q') || storedQuality() || detected.level;
    this.quality = resolveQuality(LEVELS.includes(wanted) ? wanted : detected.level, FLAGS);
    this.renderer.setPixelRatio(this.quality.dpr);
    U.uWinLod.value = this.quality.msaa ? 0 : 1;
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    // no shadows on low (switching them later recompiles every lit material once)
    this.shadowsEnabled = !params.has('noshadow') && this.quality.level !== 'low';
    this.renderer.shadowMap.enabled = this.shadowsEnabled;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    // the shadow map is only re-rendered when the view or the sun moved enough
    this.renderer.shadowMap.autoUpdate = false;
    this.shadowState = { center: new THREE.Vector3(Infinity, 0, 0), ext: 0, dir: new THREE.Vector3(), force: true, dirty: false, wait: 0 };

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 2, 220000);
    this.camera.position.set(2600, 1500, 11000);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.set(-600, 0, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.minDistance = 20;
    this.controls.maxDistance = 30000;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    // slow cinematic drift until the viewer touches anything
    this.controls.autoRotate = !params.has('shot');
    this.controls.autoRotateSpeed = 0.35;
    this.controls.addEventListener('start', () => { this.controls.autoRotate = false; });

    this.env = new Environment();
    if (params.has('t')) this.env.setHours(parseFloat(params.get('t')));
    if (params.has('w')) {
      // test hook: start fully in a weather state
      this.env.setWeather(params.get('w'));
      this.env._wet = this.env.weather === 'rain' ? 1 : 0;
      this.env._snow = this.env.weather === 'snow' ? 1 : 0;
      this.env._cloud = this.env.weather === 'clear' ? 0.3 : 0.95;
    }
    if (params.has('season')) this.env.setSeason(params.get('season'));

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = this.shadowsEnabled;
    this.sun.shadow.mapSize.set(this.quality.shadowSize, this.quality.shadowSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.6;
    this.sun.shadow.camera.near = 10;
    this.sun.shadow.camera.far = 12000;
    this.scene.add(this.sun, this.sun.target);
    this.moon = new THREE.DirectionalLight(0x9fb6ff, 0.2);
    this.scene.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight(0xbcd2ee, 0x3a3630, 0.8);
    this.scene.add(this.hemi);

    const sky = createSky();
    this.sky = sky.mesh;
    this.envScene = sky.envScene;
    this.scene.add(this.sky);
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = null;
    this.lastEnvKey = '';
    this.lastEnvTime = -1e9;

    this.weather = new Weather(this.scene);
    if (params.has('w') || params.has('season')) this.weather.instant = true;
    this.post = new Post(this.renderer, this.scene, this.camera, this.quality);
    this.perf = { acc: 0, n: 0, wait: 0, armed: false };
    this.reflection = new PlanarReflection(this.renderer, this.quality.reflection);
    this.reflection.exclude([this.weather.group]);
    this.lod = new LodManager();
    this.lod.setLimits(this.quality.lod, this.quality.lodAlt);
    this.pool = new WorkerPool(Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)));
    this.buildingMeshes = [];
    this.timer = new THREE.Timer();
    this.ready = false;
    // nothing is drawn while the opaque loading screen covers the canvas
    this.revealed = params.has('shot');

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.post.setSize(w, h);
    const pr = this.renderer.getPixelRatio();
    this.reflection?.setSize(w * pr, h * pr);
  }

  async load(onProgress) {
    const manifest = await fetchJSON('manifest.json');
    this.manifest = manifest;
    this.ll = makeLL(manifest);
    const [groundBuf, farBuf] = await Promise.all([fetchBinary('ground.bin.gz'), fetchBinary('far.bin.gz')]);
    const far = parseFar(farBuf);
    this.ground = createGround(manifest, parseGround(groundBuf), far, this.reflection);
    this.reflection.exclude([this.ground]);
    this.scene.add(this.ground);
    this.sprawl = createSprawl(far);
    setTileDensity(this.sprawl.tiles, this.quality.sprawlDensity);
    this.scene.add(this.sprawl.group);
    this.reflection.exclude([this.sprawl.group]);
    this.landmarks = createLandmarks(manifest);
    this.scene.add(this.landmarks.group);
    onProgress?.(0.06, '地形');

    // roads (built in a worker) and city details load alongside the buildings
    const roadsP = fetchBinary('roads.bin.gz')
      .then((buf) => this.pool.run('roads', buf, { rainbow: manifest.rainbow }))
      .then((res) => { this.roads = createRoads(res); this.scene.add(this.roads); this.reflection.exclude([this.roads]); });
    const trafficP = fetchBinary('routes.bin.gz').then((buf) => {
      this.traffic = createTraffic(parseRoutes(buf), this.quality);
      this.traffic.userData.setLod(this.quality.lod);
      this.scene.add(this.traffic);
      this.reflection.exclude([this.traffic]);
    });
    const extrasP = fetchBinary('extras.bin.gz').then((buf) => {
      const ex = parseExtras(buf);
      this.trees = createTrees(ex.trees, this.ll);
      setTileDensity(this.trees.tiles, this.quality.treeDensity);
      for (const t of this.trees.tiles) this.lod.add(t.mesh, 'tree', t.center, t.radius);
      this.roofUnits = createRoofUnits(ex.roofUnits);
      for (const t of this.roofUnits.tiles) this.lod.add(t.mesh, 'roof', t.center, t.radius);
      this.lamps = createLamps(ex.lamps);
      this.aviation = createAviation(ex.aviation);
      this.signs = createSigns(ex.signs);
      this.scene.add(this.trees.group, this.roofUnits.group, this.lamps, this.aviation, this.signs);
      this.reflection.exclude([this.trees.group, this.roofUnits.group]);
    });

    const mat = buildingMaterial(manifest);
    // nearest chunks first
    const t = this.controls.target;
    const chunks = [...manifest.chunks].sort((a, b) =>
      Math.hypot(a.cx - t.x, a.cz - t.z) - Math.hypot(b.cx - t.x, b.cz - t.z));
    let done = 0;
    await Promise.all(chunks.map(async (c) => {
      const buf = await fetchBinary(c.file);
      const res = await this.pool.run('chunk', buf);
      const meshes = createChunkMeshes(res, mat);
      for (const m of meshes) {
        this.scene.add(m);
        if (m.userData.small) {
          this.reflection.exclude([m]);
          this.lod.add(m, 'small', m.userData.center, m.userData.radius);
        }
      }
      this.buildingMeshes.push(...meshes);
      done++;
      onProgress?.(0.08 + 0.9 * done / chunks.length, '建筑');
    }));
    await Promise.all([roadsP, extrasP, trafficP]);
    this.ready = true;
    this.shadowState.force = true;
  }

  /** Compile every material before the loader goes away, so the first frames don't stall. */
  async warmUp() {
    this.lod.update(this.camera);
    this.updateEnvMap(true);
    try {
      if (this.renderer.compileAsync) await this.renderer.compileAsync(this.scene, this.camera);
      else this.renderer.compile(this.scene, this.camera);
    } catch (e) { console.warn('precompile', e); }
  }

  reveal() {
    this.revealed = true;
    this.perf = { acc: 0, n: 0, wait: 0, armed: true };
  }

  /** Step quality down while the frame rate after loading stays low (unless the user chose). */
  autoQuality(dt) {
    const p = this.perf;
    if (!p.armed || params.has('q') || params.has('shot') || storedQuality()) return;
    p.wait += dt;
    if (p.wait < 2) return;
    p.acc += dt; p.n++;
    if (p.acc < 3) return;
    const fps = p.n / p.acc;
    p.acc = 0; p.n = 0; p.wait = 0;
    const lv = this.quality.level;
    if (fps < 28 && lv !== 'low') {
      const next = lv === 'high' && fps > 15 ? 'medium' : 'low';
      this.setQuality(next, false);
      this.ui?.toast(`帧率约 ${Math.round(fps)} fps，已自动切换到${next === 'medium' ? '中' : '低'}画质`);
      this.ui?.syncQuality(next);
    } else {
      p.armed = lv !== 'low' && fps < 40;   // keep watching only while marginal
    }
  }

  startTour() {
    this.ui.dismissLoader();
    this.tour.start(0);
  }

  /** Switch quality at runtime; only switching to or from low recompiles materials (shadows). */
  setQuality(level, remember = true) {
    if (remember) { try { localStorage.setItem('tokyo3d.quality', level); } catch (e) { /* private mode */ } }
    const q = resolveQuality(level, FLAGS);
    this.quality = q;
    this.renderer.setPixelRatio(q.dpr);
    U.uWinLod.value = q.msaa ? 0 : 1;
    this.setShadows(level !== 'low');
    if (this.sun.shadow.mapSize.x !== q.shadowSize) {
      this.sun.shadow.mapSize.set(q.shadowSize, q.shadowSize);
      if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
    }
    this.shadowState.force = true;
    this.reflection.setScale(q.reflection);
    this.post.dispose();
    this.post = new Post(this.renderer, this.scene, this.camera, q);
    this.lod.setLimits(q.lod, q.lodAlt);
    if (this.trees) setTileDensity(this.trees.tiles, q.treeDensity);
    if (this.sprawl) setTileDensity(this.sprawl.tiles, q.sprawlDensity);
    this.traffic?.userData.setLod(q.lod);
    this.resize();
  }

  setShadows(on) {
    if (params.has('noshadow') || on === this.shadowsEnabled) return;
    this.shadowsEnabled = on;
    this.renderer.shadowMap.enabled = on;
    this.sun.castShadow = on;
    this.scene.traverse((o) => {
      if (o.material) for (const m of [].concat(o.material)) m.needsUpdate = true;
    });
  }

  updateEnvMap(force) {
    const now = performance.now();
    if (!force && now - this.lastEnvTime < 1500) return;   // PMREM is a dozen passes: at most every 1.5 s
    const h = this.env.hours;
    const key = `${Math.round(h * 12)}_${this.env.weather}_${Math.round(U.uCloud.value * 10)}`;
    if (!force && key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    this.lastEnvTime = now;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.9;
  }

  updateShadow(moving) {
    const s = this.sun;
    const t = this.controls.target;
    const dist = this.camera.position.distanceTo(t);
    const ext = THREE.MathUtils.clamp(dist * 0.85, 250, 3500);
    const dir = U.uSunDir.value;
    const useDir = dir.y > 0.02 ? dir : U.uMoonDir.value;
    // lighting direction follows the sun every frame (cheap) ...
    s.target.position.copy(t);
    s.position.copy(t).addScaledVector(useDir, 5000);
    this.moon.target.position.copy(t);
    this.moon.position.copy(t).addScaledVector(U.uMoonDir.value, 5000);
    if (!this.shadowsEnabled) return;
    // ... but the shadow map is re-rendered only when it would visibly change
    const st = this.shadowState;
    st.wait++;
    const stale = st.force || st.dirty
      || st.center.distanceTo(t) > st.ext * 0.06
      || Math.abs(ext - st.ext) > st.ext * 0.12
      || st.dir.dot(useDir) < 0.99999;          // ~0.25 degree of sun movement
    if (!stale || (!st.force && st.wait < (moving ? 5 : 2))) return;
    const cam = s.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.far = 10000;
    cam.updateProjectionMatrix();
    st.center.copy(t);
    st.ext = ext;
    st.dir.copy(useDir);
    st.force = false;
    st.dirty = false;
    st.wait = 0;
    this.renderer.shadowMap.needsUpdate = true;
  }

  updateSeasonalLights() {
    // Tokyo Tower "Landmark Light": white in summer (7 Jul - 1 Oct), orange otherwise.
    const d = new Date(this.env.date.valueOf() + 9 * 3600e3);
    const md = (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
    const summer = md >= 707 && md <= 1001;
    if (U.uTowerGlow) U.uTowerGlow.value.set(summer ? '#fff2dc' : '#ff8a2e');
    // Skytree alternates daily between "Iki" (blue) and "Miyabi" (purple)
    U.uSkytreeMode.value = Math.floor(this.env.date.valueOf() / 86400e3) % 2;
  }

  updateFuji() {
    // Mt. Fuji summit 35.3606N 138.7274E, 3776 m
    const fx = (138.7274 - 139.76) * this.manifest.origin.kx;
    const fz = -(35.3606 - 35.68) * this.manifest.origin.ky;
    const c = this.camera.position;
    const dx = fx - c.x, dz = fz - c.z;
    const dist = Math.hypot(dx, dz);
    const az = Math.atan2(dx, -dz);
    const drop = dist * dist / (2 * 6371000) * 0.87; // curvature with refraction
    const el = Math.atan2(3776 - drop - c.y, dist);
    U.uFuji.value.set(az < 0 ? az + Math.PI * 2 : az, el, Math.atan2(19000, dist), 1);
  }

  frame() {
    this.timer.update();
    const dt = Math.min(this.timer.getDelta(), 0.1);
    if (!this.revealed) return;
    this.tour?.update(dt);
    const before = this._lastCam || (this._lastCam = new THREE.Vector3());
    const driven = this.director ? this.director.update(dt) : false;
    if (!driven) this.controls.update();
    const moving = before.distanceToSquared(this.camera.position) > 0.25;
    before.copy(this.camera.position);
    // keep the near plane as far as possible for depth precision
    const alt = Math.max(1, this.camera.position.y);
    this.camera.near = THREE.MathUtils.clamp(alt * 0.02, 0.3, 30);
    this.camera.updateProjectionMatrix();

    const { night } = this.env.update(dt, this.sun, this.moon, this.hemi, this.camera);
    this.sky.position.copy(this.camera.position);
    this.weather.update(dt, this.env, this.camera.position.y);
    this.autoQuality(dt);
    if (this.manifest) { this.updateFuji(); this.updateSeasonalLights(); }
    // casters appearing / disappearing with distance: refresh the shadows, but throttled
    if (this.ready && this.lod.update(this.camera)) this.shadowState.dirty = true;
    this.updateShadow(moving || this.env.timeScale > 0);
    this.updateEnvMap(false);
    if (this.ui && this.manifest) this.ui.update(dt);
    this.post.update(this.camera, night);
    this.reflection.render(this.scene, this.camera, this.sky);
    this.post.render(dt);
  }

  start() {
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.frame();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  stop() { this.running = false; }

  /** Deterministic capture for the headless screenshot tool. */
  capture(frames = 3) {
    this.stop();
    for (let i = 0; i < frames; i++) this.frame();
    return this.renderer.domElement.toDataURL('image/png');
  }
}

const app = new App(document.getElementById('c'));
window.__tokyo = app;
app.U = U;
app.director = new Director(app);
if (params.has('cam')) {
  const v = params.get('cam').split(',').map(Number);
  app.camera.position.set(v[0], v[1], v[2]);
  app.controls.target.set(v[3], v[4], v[5]);
}
const bar = document.getElementById('progress');
app.start();
app.load((p, label) => {
  if (bar) bar.style.width = `${Math.round(p * 100)}%`;
  const l = document.getElementById('loadlabel');
  if (l) l.textContent = `${label} · ${Math.round(p * 100)}%`;
}).then(async () => {
  app.ui = new UI(app);
  app.tour = new Tour(app, app.director, PLACES, app.ui);
  app.ui.init();
  if (params.has('place')) {
    const p = PLACES.find((q) => q.id === params.get('place'));
    if (p) { const r = app.director.resolve(p); app.camera.position.copy(r.pos); app.controls.target.copy(r.target); app.camera.lookAt(r.target); }
  }
  const l = document.getElementById('loadlabel');
  if (l) l.textContent = '正在准备着色器…';
  await app.warmUp();
  document.body.classList.add('ready');
  if (l) l.textContent = '城市已就绪';
  if (params.has('shot')) { document.body.classList.add('shot'); app.ui.dismissLoader(); }
  window.__tokyoReady = true;
}).catch((e) => {
  console.error(e);
  const l = document.getElementById('loadlabel');
  if (l) l.textContent = '加载失败：' + e.message;
});
