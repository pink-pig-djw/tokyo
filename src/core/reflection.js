// Planar reflection of the city on the water plane (y = 0), rendered at reduced
// resolution with an oblique near plane (Lengyel) so nothing below the water leaks in.
import * as THREE from 'three';

export class PlanarReflection {
  constructor(renderer, scale) {
    this.renderer = renderer;
    this.scale = scale;
    this.rt = new THREE.WebGLRenderTarget(16, 16, { type: THREE.HalfFloatType, samples: 0 });
    this.rt.texture.generateMipmaps = false;
    this.camera = new THREE.PerspectiveCamera();
    this.camera.layers.enableAll();
    this.textureMatrix = new THREE.Matrix4();
    this.uniforms = {
      tReflect: { value: this.rt.texture },
      uReflMatrix: { value: this.textureMatrix },
      uReflStrength: { value: scale > 0 ? 1 : 0 },
    };
    this.hidden = [];
    this._plane = new THREE.Plane();
    this._clip = new THREE.Vector4();
    this._q = new THREE.Vector4();
  }

  setSize(w, h) {
    if (!this.scale) return;
    this.rt.setSize(Math.max(64, Math.floor(w * this.scale)), Math.max(64, Math.floor(h * this.scale)));
  }

  /** objects that should not appear in the reflection (ground, small detail) */
  exclude(objs) { this.hidden.push(...objs.filter(Boolean)); }

  render(scene, camera, sky) {
    if (!this.scale) return;
    const rc = this.camera;
    const cp = camera.position;
    // mirror position and orientation about y = 0
    rc.position.set(cp.x, -cp.y, cp.z);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
    fwd.y = -fwd.y;
    up.y = -up.y;
    rc.up.copy(up);
    rc.lookAt(rc.position.clone().add(fwd));
    rc.near = camera.near;
    rc.far = camera.far;
    rc.fov = camera.fov;
    rc.aspect = camera.aspect;
    rc.updateMatrixWorld();
    rc.updateProjectionMatrix();

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix).multiply(rc.matrixWorldInverse);

    // oblique near plane at the water surface
    this._plane.set(new THREE.Vector3(0, 1, 0), -0.4).applyMatrix4(rc.matrixWorldInverse);
    const c = this._clip.set(this._plane.normal.x, this._plane.normal.y, this._plane.normal.z, this._plane.constant);
    const pm = rc.projectionMatrix.elements;
    const q = this._q;
    q.x = (Math.sign(c.x) + pm[8]) / pm[0];
    q.y = (Math.sign(c.y) + pm[9]) / pm[5];
    q.z = -1;
    q.w = (1 + pm[10]) / pm[14];
    c.multiplyScalar(2 / c.dot(q));
    pm[2] = c.x; pm[6] = c.y; pm[10] = c.z + 1; pm[14] = c.w;

    const r = this.renderer;
    const vis = this.hidden.map((o) => o.visible);
    this.hidden.forEach((o) => { o.visible = false; });
    const skyPos = sky.position.clone();
    sky.position.copy(rc.position);
    const prevAuto = r.shadowMap.autoUpdate;
    r.shadowMap.autoUpdate = false;
    const prevTarget = r.getRenderTarget();
    r.setRenderTarget(this.rt);
    r.clear();
    r.render(scene, rc);
    r.setRenderTarget(prevTarget);
    r.shadowMap.autoUpdate = prevAuto;
    sky.position.copy(skyPos);
    this.hidden.forEach((o, i) => { o.visible = vis[i]; });
  }
}
