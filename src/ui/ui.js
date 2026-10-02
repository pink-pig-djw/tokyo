// DOM overlay: landmark rail, HUD, time/weather bar, tour captions and 3D labels.
import * as THREE from 'three';
import { PLACES, GROUPS, LINES } from './places.js';
import { jstHours } from '../core/astro.js';

const $ = (id) => document.getElementById(id);

function badge(st) {
  const line = st[0];
  const num = st.slice(1);
  const el = document.createElement('span');
  el.className = 'badge' + (line === 'X' ? ' x' : '');
  el.style.setProperty('--c', LINES[line] || '#888');
  el.innerHTML = line === 'X' ? '<i>VIEW</i>' : `<i>${line}</i>${num}`;
  return el;
}

function pointInRing(x, z, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], zi = ring[i][1], xj = ring[j][0], zj = ring[j][1];
    if (((zi > z) !== (zj > z)) && (x < (xj - xi) * (z - zi) / (zj - zi) + xi)) inside = !inside;
  }
  return inside;
}

export class UI {
  constructor(app) {
    this.app = app;
    this.labelsOn = true;
    this.labelEls = [];
    this.activeId = null;
    this.lastWardCheck = 0;
    this._v = new THREE.Vector3();
  }

  init() {
    const app = this.app;
    this._buildPlaces();
    this._buildLabels();

    // rail toggle
    const rail = $('rail'), tog = $('railToggle');
    const setRail = (open) => {
      rail.classList.toggle('collapsed', !open);
      tog.classList.toggle('collapsed', !open);
      tog.setAttribute('aria-expanded', String(open));
      document.body.classList.toggle('rail-collapsed', !open);
    };
    this.setRail = setRail;
    tog.addEventListener('click', () => setRail(rail.classList.contains('collapsed')));

    // modes
    $('modeTour').addEventListener('click', () => app.startTour());
    $('modeOrbit').addEventListener('click', () => { app.tour.stop(); app.director.setMode('orbit'); });
    $('modeFly').addEventListener('click', () => { app.tour.stop(); app.director.setMode('fly'); });
    app.director.onModeChange = (m) => {
      $('modeTour').setAttribute('aria-pressed', String(m === 'tour'));
      $('modeOrbit').setAttribute('aria-pressed', String(m === 'orbit'));
      $('modeFly').setAttribute('aria-pressed', String(m === 'fly'));
    };

    // time
    const slider = $('timeSlider');
    slider.addEventListener('input', () => {
      app.tour.stop();
      app.env.setHours(parseFloat(slider.value));
      this._setPlaying(false);
    });
    $('btnPlay').addEventListener('click', () => this._setPlaying(!app.env.timeScale));
    $('btnNow').addEventListener('click', () => {
      app.env.date = new Date();
      this._setPlaying(false);
    });
    this._drawSunband();

    // weather / season / quality
    const seg = (id, cur, fn) => {
      const root = $(id);
      const set = (v) => root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
      set(cur);
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        set(b.dataset.v);
        fn(b.dataset.v);
      });
    };
    seg('segWeather', app.env.weather, (v) => app.env.setWeather(v));
    seg('segSeason', app.env.season, (v) => app.env.setSeason(v));
    seg('segQuality', app.quality.level, (v) => app.setQuality(v));

    // HUD buttons
    $('btnLabels').addEventListener('click', () => {
      this.labelsOn = !this.labelsOn;
      $('btnLabels').setAttribute('aria-pressed', String(this.labelsOn));
      $('labels').style.display = this.labelsOn ? '' : 'none';
    });
    $('btnFull').addEventListener('click', () => {
      if (document.fullscreenElement) document.exitFullscreen?.();
      else document.documentElement.requestFullscreen?.()?.catch?.(() => {});
    });
    $('btnHelp').addEventListener('click', () => { $('help').hidden = false; });
    $('helpClose').addEventListener('click', () => { $('help').hidden = true; });
    $('help').addEventListener('click', (e) => { if (e.target.id === 'help') $('help').hidden = true; });

    // tour nav
    $('tourPrev').addEventListener('click', () => app.tour.prev());
    $('tourNext').addEventListener('click', () => app.tour.next());
    $('tourExit').addEventListener('click', () => app.tour.stop());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && app.tour.active) app.tour.stop();
    });

    // start buttons
    $('startTour').addEventListener('click', () => { this.dismissLoader(); app.startTour(); });
    $('startFree').addEventListener('click', () => { this.dismissLoader(); });
  }

  dismissLoader() {
    document.body.classList.add('loaded');
    if (window.innerWidth > 760) this.setRail(true);
  }

  _setPlaying(on) {
    this.app.env.timeScale = on ? 0.4 : 0;   // 0.4 simulated hours per second
    $('btnPlay').setAttribute('aria-pressed', String(on));
    $('playIcon').setAttribute('d', on ? 'M2 1h3v10H2zM7 1h3v10H7z' : 'M2 1l9 5-9 5z');
  }

  _buildPlaces() {
    const nav = $('places');
    for (const g of GROUPS) {
      const sec = document.createElement('section');
      sec.className = 'group';
      sec.innerHTML = `<h2><span>${g.zh}</span><span>${g.ja}</span></h2>`;
      for (const p of PLACES.filter((q) => q.group === g.id)) {
        const b = document.createElement('button');
        b.className = 'place';
        b.dataset.id = p.id;
        b.append(badge(p.st));
        const nm = document.createElement('span');
        nm.className = 'nm';
        nm.innerHTML = `<span class="zh">${p.zh}</span><span class="ja">${p.ja}　${p.stName}</span>`;
        b.append(nm);
        const m = document.createElement('span');
        m.className = 'm';
        m.textContent = p.label ? `${p.label} m` : '';
        b.append(m);
        b.addEventListener('click', () => this.goTo(p));
        sec.append(b);
      }
      nav.append(sec);
    }
  }

  goTo(p) {
    const app = this.app;
    app.tour.stop();
    if (app.director.mode === 'fly') app.director.setMode('orbit');
    app.director.flyTo(p);
    this.setActive(p.id);
    if (window.innerWidth <= 760) this.setRail(false);
  }

  setActive(id) {
    this.activeId = id;
    document.querySelectorAll('.place').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
  }

  _buildLabels() {
    const root = $('labels');
    for (const p of PLACES) {
      if (p.group === 'views') continue;
      const el = document.createElement('div');
      el.className = 'lbl';
      el.innerHTML = `<div class="card"><b>${p.zh}</b><span>${p.ja}</span></div><div class="stem"></div>`;
      el.addEventListener('click', () => this.goTo(p));
      root.append(el);
      this.labelEls.push({ p, el, pos: null });
    }
  }

  _labelAnchor(p) {
    const app = this.app;
    let v;
    if (p.id === 'rainbow') v = new THREE.Vector3(app.manifest.rainbow.x, 0, app.manifest.rainbow.z);
    else v = app.ll(p.lon, p.lat);
    v.y = p.h ? p.h + 12 : 45;
    return v;
  }

  showCaption(p, step, i, n) {
    const b = $('capBadge');
    b.replaceWith(Object.assign(badge(p.st), { id: 'capBadge' }));
    $('capStation').textContent = step.intro ? 'TOKYO · 3D TOUR' : `${p.stName}${p.label ? ' · ' : ''}${p.label ? p.label + ' m' : ''}`;
    $('capTitle').textContent = step.intro ? '东京' : step.outro ? '晚安，东京' : p.zh;
    $('capJa').textContent = step.intro ? '東京 — Tokyo' : p.ja;
    $('capText').textContent = step.intro
      ? '一座由 66 万栋真实建筑组成的城市。从黄昏的东京湾出发，穿过都心与新宿涩谷的霓虹，在晴空塔下迎来夜晚。'
      : step.outro ? '都心的高楼渐次亮起，霓虹、车流与航空障碍灯组成了东京的夜。你可以继续自由探索。' : p.text;
    $('caption').classList.add('on');
    $('tourProgress').textContent = `${i + 1} / ${n}`;
    this.setActive(p.id);
  }

  hideCaption() { $('caption').classList.remove('on'); }

  setTourActive(on) {
    document.body.classList.toggle('touring', on);
    if (on && window.innerWidth <= 1100) this.setRail(false);
  }

  _drawSunband() {
    // a 24h strip coloured by the sky at each hour of today
    const app = this.app;
    const stops = [];
    const tmp = { zenith: new THREE.Color(), horizon: new THREE.Color(), glow: new THREE.Color() };
    void tmp;
    for (let h = 0; h <= 24; h += 1) {
      const d = new Date(app.env.date);
      const prev = app.env.date;
      app.env.setHours(h % 24);
      const el = app.env.sunElevation();
      app.env.date = prev;
      void d;
      const c = el < -12 ? '#0b1020' : el < -4 ? '#26305a' : el < 0 ? '#7a4f6a' : el < 6 ? '#e08a4e' : el < 20 ? '#9cc3e6' : '#bcdaf5';
      stops.push(`${c} ${(h / 24 * 100).toFixed(2)}%`);
    }
    $('sunband').style.background = `linear-gradient(90deg, ${stops.join(',')})`;
  }

  update() {
    const app = this.app;
    const cam = app.camera;
    // clock
    const h = jstHours(app.env.date);
    const hh = Math.floor(h), mm = Math.floor((h - hh) * 60);
    $('clock').textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    const jst = new Date(app.env.date.valueOf() + 9 * 3600e3);
    $('dateLine').textContent = `JST · ${jst.getUTCFullYear()}-${String(jst.getUTCMonth() + 1).padStart(2, '0')}-${String(jst.getUTCDate()).padStart(2, '0')}`;
    if (document.activeElement !== $('timeSlider')) $('timeSlider').value = String(h);

    // HUD
    const o = app.manifest.origin;
    const tgt = app.director.mode === 'fly' ? cam.position : app.controls.target;
    const lat = o.lat - tgt.z / o.ky, lon = o.lon + tgt.x / o.kx;
    $('hLat').textContent = `${lat.toFixed(4)}°N`;
    $('hLon').textContent = `${lon.toFixed(4)}°E`;
    $('hAlt').textContent = `${Math.round(cam.position.y)} m`;
    const dir = cam.getWorldDirection(this._v);
    let hdg = Math.atan2(dir.x, -dir.z) * 180 / Math.PI;
    if (hdg < 0) hdg += 360;
    const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    $('hHdg').textContent = `${Math.round(hdg)}° ${names[Math.round(hdg / 45) % 8]}`;
    $('needle').setAttribute('transform', `rotate(${-hdg})`);
    const now = performance.now();
    if (now - this.lastWardCheck > 500) {
      this.lastWardCheck = now;
      let ward = null;
      for (const w of app.manifest.wards) {
        if (w.rings.some((r) => pointInRing(tgt.x, tgt.z, r))) { ward = w; break; }
      }
      const el = $('ward');
      if (ward) el.innerHTML = `${ward.ja}<small>${ward.en.replace(' Ku', '-ku').replace(' Shi', '-shi')}</small>`;
      else el.innerHTML = tgt.z > 3000 && tgt.x > -3000 ? '東京湾<small>Tokyo Bay</small>' : '首都圏<small>Greater Tokyo</small>';
    }

    // labels
    if (!this.labelsOn) return;
    const w = window.innerWidth, hgt = window.innerHeight;
    const camPos = cam.position;
    const placed = [];
    const order = this.labelEls.map((L) => {
      if (!L.pos) L.pos = this._labelAnchor(L.p);
      return [camPos.distanceTo(L.pos), L];
    }).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
    for (const L of order) {
      if (!L.pos) L.pos = this._labelAnchor(L.p);
      const d = camPos.distanceTo(L.pos);
      const maxD = L.p.h > 200 ? 16000 : 5500;
      const v = this._v.copy(L.pos).project(cam);
      const visible = v.z < 1 && v.z > -1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && d < maxD && d > 60 && !app.tour.active;
      if (!visible) {
        if (L.el.style.display !== 'none') L.el.style.display = 'none';
        continue;
      }
      const x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * hgt;
      // declutter: nearer labels win, overlapping farther ones are hidden
      const box = [x - 55, y - 62, x + 55, y - 26];
      if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) {
        if (L.el.style.display !== 'none') L.el.style.display = 'none';
        continue;
      }
      placed.push(box);
      L.el.style.display = '';
      const fade = THREE.MathUtils.clamp((maxD - d) / (maxD * 0.3), 0, 1);
      L.el.style.opacity = String(fade);
      L.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      L.el.style.zIndex = String(100000 - Math.round(d));
    }
  }
}
