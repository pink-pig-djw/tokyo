import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { U, Environment } from './core/env.js';
import { Post } from './core/post.js';
import { PlanarReflection } from './core/reflection.js';
import { createSky } from './world/sky.js';
import { createGround } from './world/ground.js';
import { buildingMaterial, createChunkMeshes } from './world/buildings.js';
import { fetchBinary, fetchJSON, parseGround, parseFar, parseExtras, parseRoutes } from './data/loader.js';
import { createTraffic } from './world/traffic.js';
import { createRoads } from './world/roads.js';
import { createLandmarks, makeLL } from './world/landmarks.js';
import { Director } from './core/director.js';
import { Tour } from './core/tour.js';
import { UI } from './ui/ui.js';
import { PLACES } from './ui/places.js';
import { createTrees, createLamps, createAviation, createRoofUnits, createSigns, createSprawl } from './world/extras.js';
import { WorkerPool } from './data/workerPool.js';

const params = new URLSearchParams(location.search);

function storedQuality() {
  try { return localStorage.getItem('tokyo3d.quality'); } catch (e) { return null; }
}

function detectQuality(forced) {
  const q = forced || params.get('q') || storedQuality();
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || Math.min(screen.width, screen.height) < 600;
  const level = ['low', 'medium', 'high'].includes(q) ? q : (mobile ? 'low' : 'high');
  return {
    level,
    msaa: level !== 'low',
    ao: level !== 'low' && !params.has('noao'),
    shadows: level !== 'low' && !params.has('noshadow'),
    shadowSize: level === 'high' ? 4096 : 2048,
    dpr: Math.min(window.devicePixelRatio, level === 'high' ? 1.75 : level === 'medium' ? 1.25 : 1),
  };
}

export class App {
  constructor(canvas) {
    this.quality = detectQuality();
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true,
      preserveDrawingBuffer: params.has('shot'),
    });
    this.renderer.setPixelRatio(this.quality.dpr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.shadowMap.enabled = this.quality.shadows;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

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

    this.env = new Environment();
    if (params.has('t')) this.env.setHours(parseFloat(params.get('t')));

    // lights
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = this.quality.shadows;
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

    this.post = new Post(this.renderer, this.scene, this.camera, this.quality);
    this.reflection = new PlanarReflection(this.renderer,
      params.has('norefl') ? 0 : this.quality.level === 'high' ? 0.5 : this.quality.level === 'medium' ? 0.33 : 0);
    this.pool = new WorkerPool(Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1)));
    this.buildingMeshes = [];
    this.timer = new THREE.Timer();
    this.ready = false;

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
    this.scene.add(createSprawl(far));
    this.landmarks = createLandmarks(manifest);
    this.scene.add(this.landmarks.group);
    onProgress?.(0.06, '地形');

    // roads (built in a worker) and city details load alongside the buildings
    const roadsP = fetchBinary('roads.bin.gz')
      .then((buf) => this.pool.run('roads', buf, { rainbow: manifest.rainbow }))
      .then((res) => { this.roads = createRoads(res); this.scene.add(this.roads); this.reflection.exclude([this.roads]); });
    const trafficP = fetchBinary('routes.bin.gz').then((buf) => {
      this.traffic = createTraffic(parseRoutes(buf), this.quality);
      this.scene.add(this.traffic);
      this.reflection.exclude([this.traffic]);
    });
    const extrasP = fetchBinary('extras.bin.gz').then((buf) => {
      const ex = parseExtras(buf);
      this.trees = createTrees(ex.trees, this.quality);
      this.lamps = createLamps(ex.lamps);
      this.aviation = createAviation(ex.aviation);
      this.roofUnits = createRoofUnits(ex.roofUnits);
      this.signs = createSigns(ex.signs);
      this.scene.add(this.trees, this.lamps, this.aviation, this.roofUnits, this.signs);
      this.reflection.exclude([this.trees, this.roofUnits]);
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
        if (m.userData.small) this.reflection.exclude([m]);
      }
      this.buildingMeshes.push(...meshes);
      done++;
      onProgress?.(0.08 + 0.9 * done / chunks.length, '建筑');
    }));
    await Promise.all([roadsP, extrasP, trafficP]);
    this.ready = true;
  }

  startTour() {
    this.ui.dismissLoader();
    this.tour.start(0);
  }

  setQuality(level) {
    try { localStorage.setItem('tokyo3d.quality', level); } catch (e) { /* private mode */ }
    const q = detectQuality(level);
    this.quality = q;
    this.renderer.setPixelRatio(q.dpr);
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    this.reflection.scale = q.level === 'high' ? 0.5 : q.level === 'medium' ? 0.33 : 0;
    this.reflection.uniforms.uReflStrength.value = this.reflection.scale ? 1 : 0;
    this.post.composer.dispose();
    this.post = new Post(this.renderer, this.scene, this.camera, q);
    this.scene.traverse((o) => {
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; });
    });
    this.resize();
  }

  updateEnvMap(force) {
    const h = this.env.hours;
    const key = `${Math.round(h * 12)}_${this.env.weather}_${Math.round(U.uCloud.value * 10)}`;
    if (!force && key === this.lastEnvKey) return;
    this.lastEnvKey = key;
    const rt = this.pmrem.fromScene(this.envScene, 0, 1, 1000);
    if (this.envRT) this.envRT.dispose();
    this.envRT = rt;
    this.scene.environment = rt.texture;
    this.scene.environmentIntensity = 0.9;
  }

  updateShadow() {
    const s = this.sun;
    const t = this.controls.target;
    const dist = this.camera.position.distanceTo(t);
    const ext = THREE.MathUtils.clamp(dist * 0.85, 250, 3500);
    const dir = U.uSunDir.value;
    const useDir = dir.y > 0.02 ? dir : U.uMoonDir.value;
    s.target.position.copy(t);
    s.position.copy(t).addScaledVector(useDir, 5000);
    const cam = s.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext;
    cam.far = 10000;
    cam.updateProjectionMatrix();
    this.moon.target.position.copy(t);
    this.moon.position.copy(t).addScaledVector(U.uMoonDir.value, 5000);
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
    this.tour?.update(dt);
    const driven = this.director ? this.director.update(dt) : false;
    if (!driven) this.controls.update();
    // keep the near plane as far as possible for depth precision
    const alt = Math.max(1, this.camera.position.y);
    this.camera.near = THREE.MathUtils.clamp(alt * 0.02, 0.3, 30);
    this.camera.updateProjectionMatrix();

    const { night } = this.env.update(dt, this.sun, this.moon, this.hemi, this.camera);
    this.sky.position.copy(this.camera.position);
    if (this.manifest) { this.updateFuji(); this.updateSeasonalLights(); }
    this.updateShadow();
    this.updateEnvMap(false);
    if (this.ui && this.manifest) this.ui.update();
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
}).then(() => {
  app.ui = new UI(app);
  app.tour = new Tour(app, app.director, PLACES, app.ui);
  app.ui.init();
  document.body.classList.add('ready');
  const l = document.getElementById('loadlabel');
  if (l) l.textContent = '城市已就绪';
  if (params.has('shot')) { document.body.classList.add('shot'); app.ui.dismissLoader(); }
  if (params.has('place')) {
    const p = PLACES.find((q) => q.id === params.get('place'));
    if (p) { const r = app.director.resolve(p); app.camera.position.copy(r.pos); app.controls.target.copy(r.target); app.camera.lookAt(r.target); }
  }
  window.__tokyoReady = true;
}).catch((e) => {
  console.error(e);
  const l = document.getElementById('loadlabel');
  if (l) l.textContent = '加载失败：' + e.message;
});
