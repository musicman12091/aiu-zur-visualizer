#version 300 es
// ZUR Stage 3 — frame-rate-independent trail fade: dst *= (1 - a), with per-type character.
precision highp float;
uniform float u_fade;        // 1 - keep, keep = keepFactor^(dt * 60)
uniform int u_trailType;     // 0 comet, 1 electric, 2 strobe, 3 ribbon, 4 none
uniform float u_trailLength; // 0..1
uniform float u_time;
out vec4 fragColor;

float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

void main() {
  float keep = 1.0 - u_fade;
  if (u_trailType == 4 || keep <= 0.0) {
    fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  if (u_trailType == 1) {
    // electric: crackling per-pixel decay, some pixels persist longer and some die fast
    float n = hash21(floor(gl_FragCoord.xy * 0.5) + floor(u_time * 24.0));
    keep *= mix(0.55, 1.04, n);
  } else if (u_trailType == 2) {
    // strobe: trail alternates between near-instant fade and full persistence
    float gate = step(0.5, fract(u_time * (3.0 + 5.0 * u_trailLength)));
    keep *= mix(0.2, 1.0, gate);
  } else if (u_trailType == 3) {
    // ribbon: long smooth persistence
    keep = pow(keep, 0.6);
  }
  fragColor = vec4(0.0, 0.0, 0.0, 1.0 - clamp(keep, 0.0, 1.0));
}
