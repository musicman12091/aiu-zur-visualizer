#version 300 es
precision highp float;

uniform vec2 u_resolution;
uniform vec3 u_eye;
uniform vec3 u_forward;
uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_palette[5];
uniform float u_time;
uniform float u_bass;
uniform int u_steps;
// ZUR-GH-007: same viewport-shifted optical centre (0.0, u_viewportYOffset) as kaleido.frag.glsl and
// render.vert.glsl (gl_Position.y += u_viewportYOffset * w), so N-fold mirrors fold AROUND the core.
uniform float u_viewportYOffset;
uniform float u_cameraZoom;   // ZUR-GH-009: pinch / wheel zoom 0.35..3.50 (scales the raymarch FOV)
uniform int u_colorPalette;   // ZUR-GH-009: 0 true-neon, 1 full-spectrum, 2 white-static, 3 blood-red
uniform float u_spectralCentroid;

out vec4 fragColor;

float mandelbulbDistance(vec3 p) {
  vec3 z = p;
  float derivative = 1.0;
  float radius = 0.0;
  for (int i = 0; i < 8; i++) {
    radius = length(z);
    if (radius > 1.35) break;
    float theta = acos(clamp(z.z / max(radius, 1e-5), -1.0, 1.0));
    float phi = atan(z.y, z.x);
    derivative = pow(radius, 7.0) * 8.0 * derivative + 1.0;
    float raised = pow(radius, 8.0);
    theta *= 8.0;
    phi *= 8.0;
    z = raised * vec3(sin(theta) * cos(phi), sin(theta) * sin(phi), cos(theta)) + p;
  }
  return 0.5 * log(max(radius, 1e-5)) * radius / max(derivative, 1e-5);
}

vec3 coreNormal(vec3 p) {
  const float e = 0.0015;
  return normalize(vec3(
    mandelbulbDistance(p + vec3(e, 0.0, 0.0)) - mandelbulbDistance(p - vec3(e, 0.0, 0.0)),
    mandelbulbDistance(p + vec3(0.0, e, 0.0)) - mandelbulbDistance(p - vec3(0.0, e, 0.0)),
    mandelbulbDistance(p + vec3(0.0, 0.0, e)) - mandelbulbDistance(p - vec3(0.0, 0.0, e))
  ));
}

void main() {
  // NDC centre of the swarm is (0.0, u_viewportYOffset) -> uv centre (0.5, 0.5 + 0.5 * u_viewportYOffset).
  vec2 opticalCenter = vec2(0.5, 0.5 + 0.5 * u_viewportYOffset);
  vec2 screen = (gl_FragCoord.xy / u_resolution - opticalCenter) * vec2(u_resolution.x / u_resolution.y, 1.0);
  float zoomFov = 0.72 / max(u_cameraZoom, 0.1);
  vec3 ray = normalize(u_forward + u_right * screen.x * zoomFov + u_up * screen.y * zoomFov);
  float nearBound = max(0.0, -dot(u_eye, ray) - 1.35);
  float travel = nearBound;
  float distanceToCore = 100.0;
  vec3 point = u_eye;
  for (int stepIndex = 0; stepIndex < 24; stepIndex++) {
    if (stepIndex >= u_steps) break;
    point = u_eye + ray * travel;
    if (length(point) > 1.35) {
      distanceToCore = length(point) - 1.35;
      if (travel > nearBound + 2.7) break;
    }
    distanceToCore = mandelbulbDistance(point);
    if (distanceToCore < 0.003 || travel > 20.0) break;
    travel += max(distanceToCore * 0.72, 0.008);
  }
  if (travel > 20.0 || distanceToCore > 0.025 || length(point) > 1.5) {
    fragColor = vec4(0.0);
    return;
  }
  vec3 normal = coreNormal(point);
  vec3 light = normalize(vec3(0.45, 0.7, -0.4));
  float diffuse = max(dot(normal, light), 0.0);
  float rim = pow(1.0 - max(dot(normal, -ray), 0.0), 2.2);
  float band = fract(length(point) * 1.7 + atan(point.y, point.x) / 6.28318 + u_time * 0.025);
  int index = int(floor(band * 4.0));
  vec3 color = mix(u_palette[index], u_palette[index + 1], fract(band * 4.0));
  if (u_colorPalette == 1) {
    vec3 k = abs(fract(vec3(band + u_spectralCentroid * 0.5 + u_time * 0.12) + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    color = mix(vec3(1.0), clamp(k - 1.0, 0.0, 1.0), 0.95);
  } else if (u_colorPalette == 2) {
    color = mix(vec3(1.0), vec3(0.6867, 0.8388, 1.0), rim) * 0.7;
  } else if (u_colorPalette == 3) {
    // blood-red #2B0005 -> #D90416 -> #FF2A38 (linear)
    color = band < 0.5 ? mix(vec3(0.0242, 0.0, 0.0015), vec3(0.6939, 0.0012, 0.0080), band * 2.0)
                       : mix(vec3(0.6939, 0.0012, 0.0080), vec3(1.0, 0.0232, 0.0395), band * 2.0 - 1.0);
  } else {
    // true-neon #00F5FF #FF007F #00FF66 #8A2BE2 (linear), sampled by band
    vec3 neon[4] = vec3[4](vec3(0.0, 0.9131, 1.0), vec3(1.0, 0.0, 0.2122), vec3(0.0, 1.0, 0.1329), vec3(0.2542, 0.0242, 0.7605));
    color = mix(neon[index], neon[(index + 1) % 4], smoothstep(0.35, 0.65, fract(band * 4.0)));
  }
  color *= 0.35 + 0.8 * diffuse + 0.4 * u_bass;
  color += u_palette[4] * (rim * (0.25 + 0.5 * u_bass));
  float alpha = clamp(0.55 + rim * 0.35 + u_bass * 0.1, 0.0, 1.0);
  fragColor = vec4(color * alpha, alpha);
}
