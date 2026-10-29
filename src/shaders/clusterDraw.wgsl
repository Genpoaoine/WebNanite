// GPU-driven 几何提交的渲染端：
// 索引来自 compute 压缩后的 visibleIndices（bind 为 index buffer），
// 顶点通过 storage buffer 拉取（vertex pulling），因此一次 drawIndexedIndirect 就能画完全部可见簇。

struct Params {
  viewProj: mat4x4<f32>,
  frustum: array<vec4<f32>, 6>,
  cameraPos: vec4<f32>,
  screen: vec4<f32>,
  lodThresholds: vec4<f32>,
  settings: vec4<u32>,
  occlusion: vec4<f32>,
  shading: vec4<f32>, // heightExtent, heightWeight, unused, unused
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> positions: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> normals: array<vec4<f32>>;

struct VertexOut {
  @builtin(position) clipPosition: vec4<f32>,
  @location(0) worldPosition: vec3<f32>,
  @location(1) normal: vec3<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> VertexOut {
  let position = positions[vertexIndex].xyz;

  var out: VertexOut;
  out.clipPosition = params.viewProj * vec4<f32>(position, 1.0);
  out.worldPosition = position;
  out.normal = normals[vertexIndex].xyz;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  var n = normalize(in.normal);
  let viewDirection = normalize(params.cameraPos.xyz - in.worldPosition);
  // 双面光照：Surface Nets 的绕序不保证统一，这里靠法线朝向修正
  if (dot(n, viewDirection) < 0.0) {
    n = -n;
  }

  let lightDirection = normalize(vec3<f32>(0.45, 0.85, 0.35));

  // 斜率（0 = 背光，1 = 正对光源）驱动的柔和渐变；
  // 所有颜色常量来自 src/render/palette.ts，改色只需改那一个文件。
  let slope = clamp(dot(n, lightDirection) * 0.5 + 0.5, 0.0, 1.0);
  // 低频高度（物体上下方向）+ 斜率调制：
  // 分形法线太碎，纯斜率采样会变成"迷彩噪点"，这里让大范围渐变占主导。
  let extent = max(params.shading.x, 1e-3);
  let height = clamp((in.worldPosition.y + extent) / (2.0 * extent), 0.0, 1.0);
  let heightWeight = clamp(params.shading.y, 0.0, 1.0);
  let gradientT = clamp(mix(slope, height, heightWeight), 0.0, 1.0);

  var color: vec3<f32>;
  if (params.shading.z > 0.5) {
    color = paletteGradient(gradientT, in.worldPosition, n);
  } else {
    // 单色模式：仍用斜率做明暗，保留体积感
    color = PALETTE_FLAT * (0.3 + 0.7 * slope);
  }

  // 极轻的天地环境项，避免暗部死黑
  color *= 0.92 + 0.08 * (0.5 + 0.5 * n.y);

  // 边缘光只在轮廓附近轻微提亮，强度完全由 palette.ts 的 rimStrength 控制
  let rim = pow(1.0 - max(dot(n, viewDirection), 0.0), 3.0);
  color += PALETTE_RIM * rim * PALETTE_RIM_STRENGTH;

  // 极轻的轴向条纹，用于观察 LOD 切换后的表面粗糙度
  color *= 0.99 + 0.01 * sin(in.worldPosition.y * 160.0);

  // 柔和 tonemap + gamma
  color = color / (color + vec3<f32>(1.0));
  color = pow(color, vec3<f32>(1.0 / 2.2));
  return vec4<f32>(color, 1.0);
}
