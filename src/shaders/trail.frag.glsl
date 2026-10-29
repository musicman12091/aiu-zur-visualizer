#version 300 es
// ZUR Stage 2 — frame-rate-independent trail fade: dst *= exp(-dt / tau).
precision highp float;
uniform float u_fade; // 1 - exp(-dt / tau)
out vec4 fragColor;
void main() { fragColor = vec4(0.0, 0.0, 0.0, u_fade); }
