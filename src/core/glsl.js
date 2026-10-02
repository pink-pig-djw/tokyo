// Shared shader snippets.
import * as THREE from 'three';

/**
 * three's normal_fragment_begin for flat-shaded materials, with a guard: sub-pixel triangles
 * seen edge-on (the far horizon) have parallel screen-space derivatives, normalize(0) is NaN,
 * and a single NaN pixel is smeared over the screen by the bloom mip chain.
 * Use as `.replace('#include <normal_fragment_begin>', SAFE_NORMAL_BEGIN)`.
 */
export const SAFE_NORMAL_BEGIN = THREE.ShaderChunk.normal_fragment_begin.replace(
  'vec3 normal = normalize( cross( fdx, fdy ) );',
  `vec3 ncr = cross( fdx, fdy );
	float nl2 = dot( ncr, ncr );
	vec3 normal = nl2 > 1e-24 ? ncr * inversesqrt( nl2 ) : normalize( ( viewMatrix * vec4( 0.0, 1.0, 0.0, 0.0 ) ).xyz );`,
);

/** NaN / Inf test on the raw bits: isnan() and isinf() may be compiled away under fast math. */
export const BAD_COLOR_GLSL = /* glsl */`
bool badColor(vec3 c) {
  uvec3 e = floatBitsToUint(c) & uvec3(0x7f800000u);
  return any(equal(e, uvec3(0x7f800000u)));
}
`;
