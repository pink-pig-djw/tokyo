// Camera direction: orbit (OrbitControls), cinematic fly-to between presets,
// guided tour with slow orbits, and a free-flight mode (pointer lock + WASD).
import * as THREE from 'three';

const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const DEG = Math.PI / 180;

export class Director {
  constructor(app) {
    this.app = app;
    this.camera = app.camera;
    this.controls = app.controls;
    this.mode = 'orbit';
    this.anim = null;
    this.hold = null;       // slow orbit around a target while a tour stop is shown
    this.fly = { yaw: 0, pitch: 0, keys: new Set(), speed: 1 };
    this.onModeChange = null;
    this._bindFly();
  }

  /** world target + camera position for a place preset */
  resolve(place) {
    const ll = this.app.ll;
    let base;
    if (place.id === 'rainbow') {
      const rb = this.app.manifest.rainbow;
      base = new THREE.Vector3(rb.x, 0, rb.z);
    } else {
      base = ll(place.lon, place.lat);
    }
    if (place.view) {
      const pos = base.clone();
      pos.y = place.view.y;
      const az = place.view.az * DEG, el = place.view.el * DEG;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
      return { pos, target: pos.clone().addScaledVector(dir, 2000), dist: 2000 };
    }
    const c = place.cam;
    const target = base.clone();
    target.y = c.y;
    const az = c.az * DEG, el = c.el * DEG;
    const pos = target.clone().add(new THREE.Vector3(
      Math.sin(az) * Math.cos(el) * c.dist, Math.sin(el) * c.dist, -Math.cos(az) * Math.cos(el) * c.dist));
    pos.y = Math.max(pos.y, 4);
    return { pos, target, dist: c.dist };
  }

  setMode(mode) {
    if (mode === this.mode) return;
    if (this.mode === 'fly' && document.pointerLockElement) document.exitPointerLock();
    this.mode = mode;
    this.controls.enabled = mode === 'orbit';
    if (mode === 'fly') {
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.fly.yaw = Math.atan2(dir.x, -dir.z);
      this.fly.pitch = Math.asin(THREE.MathUtils.clamp(dir.y, -1, 1));
      this.anim = null;
      this.hold = null;
    }
    if (mode === 'orbit') {
      this.hold = null;
      // re-seat the orbit target in front of the camera
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      const d = this.camera.position.y > 5 && dir.y < -0.05
        ? Math.min(this.camera.position.y / -dir.y, 6000) : 600;
      this.controls.target.copy(this.camera.position).addScaledVector(dir, d);
      this.controls.target.y = Math.max(0, this.controls.target.y);
    }
    this.onModeChange?.(mode);
  }

  flyTo(place, opts = {}) {
    const dest = this.resolve(place);
    const p0 = this.camera.position.clone();
    const t0 = this.controls.target.clone();
    const travel = p0.distanceTo(dest.pos);
    const duration = opts.duration ?? THREE.MathUtils.clamp(2.2 + travel / 3500, 2.5, 8);
    const hump = Math.min(travel * 0.22, 2600);
    if (this.mode === 'fly') this.setMode('orbit');
    this.controls.enabled = false;
    this.hold = null;
    this.anim = {
      t: 0, duration, p0, t0, p1: dest.pos, t1: dest.target, hump,
      done: () => {
        this.anim = null;
        this.controls.target.copy(dest.target);
        if (opts.hold) {
          this.hold = { target: dest.target.clone(), speed: opts.orbitSpeed ?? 2.2 };
        } else if (this.mode === 'orbit' || this.mode === 'tour') {
          this.controls.enabled = this.mode === 'orbit';
        }
        opts.onArrive?.();
      },
    };
  }

  update(dt) {
    const cam = this.camera;
    if (this.anim) {
      const a = this.anim;
      a.t += dt / a.duration;
      const t = Math.min(a.t, 1);
      const e = ease(t);
      const tgt = a.t0.clone().lerp(a.t1, e);
      const pos = a.p0.clone().lerp(a.p1, e);
      pos.y += Math.sin(Math.PI * e) * a.hump;
      cam.position.copy(pos);
      cam.lookAt(tgt);
      this.controls.target.copy(tgt);
      if (t >= 1) a.done();
      return true;
    }
    if (this.hold) {
      // slow orbit: rotate the camera around the target
      const h = this.hold;
      const off = cam.position.clone().sub(h.target);
      off.applyAxisAngle(new THREE.Vector3(0, 1, 0), h.speed * DEG * dt);
      cam.position.copy(h.target).add(off);
      cam.lookAt(h.target);
      return true;
    }
    if (this.mode === 'fly') {
      this._updateFly(dt);
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- free flight
  _bindFly() {
    const el = this.app.renderer.domElement;
    window.addEventListener('keydown', (e) => {
      if (e.target && /input|textarea|select/i.test(e.target.tagName)) return;
      this.fly.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.fly.keys.delete(e.code));
    window.addEventListener('blur', () => this.fly.keys.clear());
    el.addEventListener('mousedown', () => {
      if (this.mode === 'fly' && !document.pointerLockElement) {
        el.requestPointerLock?.()?.catch?.(() => {});
      }
    });
    document.addEventListener('mousemove', (e) => {
      if (this.mode !== 'fly') return;
      if (!document.pointerLockElement && !(e.buttons & 1)) return;
      this.fly.yaw += e.movementX * 0.0022;
      this.fly.pitch = THREE.MathUtils.clamp(this.fly.pitch - e.movementY * 0.0022, -1.45, 1.45);
    });
    // touch: one finger looks around, two fingers move forward
    let last = null;
    el.addEventListener('touchstart', (e) => { if (this.mode === 'fly') last = e.touches[0]; }, { passive: true });
    el.addEventListener('touchmove', (e) => {
      if (this.mode !== 'fly' || !last) return;
      const t = e.touches[0];
      this.fly.yaw += (t.clientX - last.clientX) * 0.004;
      this.fly.pitch = THREE.MathUtils.clamp(this.fly.pitch - (t.clientY - last.clientY) * 0.004, -1.45, 1.45);
      this.fly.touchForward = e.touches.length >= 2;
      last = t;
    }, { passive: true });
    el.addEventListener('touchend', () => { last = null; this.fly.touchForward = false; }, { passive: true });
  }

  _updateFly(dt) {
    const cam = this.camera;
    const f = this.fly;
    const dir = new THREE.Vector3(Math.sin(f.yaw) * Math.cos(f.pitch), Math.sin(f.pitch), -Math.cos(f.yaw) * Math.cos(f.pitch));
    const right = new THREE.Vector3(Math.cos(f.yaw), 0, Math.sin(f.yaw));
    const alt = Math.max(cam.position.y, 2);
    let speed = THREE.MathUtils.clamp(alt * 0.9, 25, 900);
    if (f.keys.has('ShiftLeft') || f.keys.has('ShiftRight')) speed *= 4;
    const mv = new THREE.Vector3();
    if (f.keys.has('KeyW') || f.keys.has('ArrowUp') || f.touchForward) mv.add(dir);
    if (f.keys.has('KeyS') || f.keys.has('ArrowDown')) mv.sub(dir);
    if (f.keys.has('KeyD') || f.keys.has('ArrowRight')) mv.add(right);
    if (f.keys.has('KeyA') || f.keys.has('ArrowLeft')) mv.sub(right);
    if (f.keys.has('KeyE') || f.keys.has('Space')) mv.y += 1;
    if (f.keys.has('KeyQ') || f.keys.has('KeyC')) mv.y -= 1;
    if (mv.lengthSq() > 0) cam.position.addScaledVector(mv.normalize(), speed * dt);
    cam.position.y = THREE.MathUtils.clamp(cam.position.y, 1.7, 9000);
    const lim = 40000;
    cam.position.x = THREE.MathUtils.clamp(cam.position.x, -lim, lim);
    cam.position.z = THREE.MathUtils.clamp(cam.position.z, -lim, lim);
    cam.lookAt(cam.position.clone().add(dir));
  }
}
