// Post-processing chain: [render] -> [N8AO] -> aerial-perspective height fog ->
// bloom + vignette + ACES tone mapping (+ SMAA when MSAA is off).
import * as THREE from 'three';
import {
  EffectComposer, RenderPass, EffectPass, Effect, EffectAttribute, BloomEffect, ToneMappingEffect,
  ToneMappingMode, VignetteEffect, FXAAEffect,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import { U } from './env.js';

const fogFrag = /* glsl */`
uniform mat4 uInvProj;
uniform mat4 uCamWorld;
uniform vec3 uCam;
uniform vec3 uSunDir;
uniform vec3 uHorizon;
uniform vec3 uGlow;
uniform vec3 uZenith;
uniform float uDensity;
uniform float uFalloff;
uniform float uExposure;
uniform float uNight;
uniform float uDusk;

void mainImage(const in vec4 inputColor, const in vec2 uv, const in float depth, out vec4 outputColor) {
  vec3 col = inputColor.rgb;
  // a single NaN would be smeared over huge areas by the mip-chain bloom
  if (any(isnan(col)) || any(isinf(col))) col = vec3(0.0);
  col = min(col, vec3(60.0));
  if (depth < 0.999999) {
    vec4 ndc = vec4(uv * 2.0 - 1.0, depth * 2.0 - 1.0, 1.0);
    vec4 vp = uInvProj * ndc;
    vp /= vp.w;
    vec3 wp = (uCamWorld * vec4(vp.xyz, 1.0)).xyz;
    vec3 rd = wp - uCam;
    float dist = length(rd);
    rd /= dist;
    float b = uFalloff;
    float ry = rd.y;
    float sgn = ry < 0.0 ? -1.0 : 1.0;
    ry = sgn * max(abs(ry), 1e-4);
    float camH = max(uCam.y, 0.0);
    float f = (uDensity / b) * exp(-camH * b) * (1.0 - exp(-dist * ry * b)) / ry;
    float fog = 1.0 - exp(-max(f, 0.0));
    float mu = max(dot(rd, uSunDir), 0.0);
    vec3 fc = mix(uHorizon, uGlow, pow(mu, 6.0) * (0.3 + 0.7 * uDusk) * (1.0 - uNight * 0.85));
    // a hint of zenith colour when looking down from altitude
    fc = mix(fc, mix(uHorizon, uZenith, 0.25), clamp(-rd.y, 0.0, 1.0) * 0.3);
    col = mix(col, fc, fog);
  }
  outputColor = vec4(col * uExposure, inputColor.a);
}
`;

class AerialFogEffect extends Effect {
  constructor(camera) {
    super('AerialFogEffect', fogFrag, {
      attributes: EffectAttribute.DEPTH,
      uniforms: new Map([
        ['uInvProj', new THREE.Uniform(new THREE.Matrix4())],
        ['uCamWorld', new THREE.Uniform(new THREE.Matrix4())],
        ['uCam', new THREE.Uniform(new THREE.Vector3())],
        ['uSunDir', U.uSunDir],
        ['uHorizon', U.uHorizon],
        ['uGlow', U.uGlow],
        ['uZenith', U.uZenith],
        ['uDensity', U.uFogDensity],
        ['uFalloff', U.uFogFalloff],
        ['uExposure', U.uExposure],
        ['uNight', U.uNight],
        ['uDusk', U.uDusk],
      ]),
    });
    this.cam = camera;
  }

  update() {
    this.uniforms.get('uInvProj').value.copy(this.cam.projectionMatrixInverse);
    this.uniforms.get('uCamWorld').value.copy(this.cam.matrixWorld);
    this.uniforms.get('uCam').value.copy(this.cam.position);
  }
}

export class Post {
  constructor(renderer, scene, camera, quality) {
    this.renderer = renderer;
    this.quality = quality;
    const msaa = quality.msaa;
    this.composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: msaa ? Math.min(4, renderer.capabilities.maxSamples) : 0,
    });
    this.composer.addPass(new RenderPass(scene, camera));
    this.ao = null;
    if (quality.ao) {
      try {
        const size = renderer.getSize(new THREE.Vector2());
        this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
        this.ao.configuration.aoRadius = 12;
        this.ao.configuration.distanceFalloff = 2.0;
        this.ao.configuration.intensity = 2.4;
        this.ao.configuration.halfRes = true;
        this.ao.configuration.gammaCorrection = false;
        this.ao.setQualityMode('Low');
        this.composer.addPass(this.ao);
      } catch (e) {
        console.warn('N8AO unavailable', e);
        this.ao = null;
      }
    }
    this.fog = new AerialFogEffect(camera);
    this.composer.addPass(new EffectPass(camera, this.fog));

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: 1.0,
      luminanceSmoothing: 0.35,
      intensity: 0.9,
      radius: 0.7,
      levels: 7,
    });
    this.vignette = new VignetteEffect({ offset: 0.32, darkness: 0.42 });
    this.tone = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    const effects = [this.bloom, this.vignette, this.tone];
    // (SMAA conflicts with the extra reflection render target; MSAA or FXAA instead)
    if (!msaa) effects.push(new FXAAEffect());
    this.composer.addPass(new EffectPass(camera, ...effects));
  }

  setSize(w, h) {
    this.composer.setSize(w, h);
  }

  update(camera, night) {
    if (this.ao) {
      const alt = Math.max(camera.position.y, 2);
      this.ao.configuration.aoRadius = THREE.MathUtils.clamp(alt * 0.03, 2.5, 30);
      this.ao.configuration.intensity = 2.2 * (1 - night * 0.6);
    }
    this.bloom.intensity = 0.35 + 1.25 * night;
  }

  render(dt) {
    this.composer.render(dt);
  }
}
