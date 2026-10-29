// 每个可见簇一个 workgroup：
//   thread 0：视锥剔除 + 按投影尺寸选 LOD + 原子预留输出区间
//   全组：把该簇该 LOD 的索引压缩写入 visibleIndices
// 第二个入口 finalize 把总索引数写进 indirect 参数缓冲。

struct Params {
  viewProj: mat4x4<f32>,
  frustum: array<vec4<f32>, 6>,
  cameraPos: vec4<f32>,
  screen: vec4<f32>,        // width, height, tanHalfFov, time
  lodThresholds: vec4<f32>,  // LOD0/1/2 的像素半径阈值
  settings: vec4<u32>,      // clusterCount, lodCount, forceFull, maxVisibleIndices
  occlusion: vec4<f32>,     // hzbMaxMip, depthBias, enabled, unused
  shading: vec4<f32>,       // heightExtent, heightWeight, unused, unused（仅绘制用到）
};

struct ClusterRange {
  offset: u32,
  count: u32,
  lod: u32,
  pad: u32,
};

struct Counters {
  indices: atomic<u32>,
  clusters: atomic<u32>,
  lodCounts: array<atomic<u32>, 4>,
  occluded: atomic<u32>,
};

struct DrawIndexedIndirectArgs {
  indexCount: u32,
  instanceCount: u32,
  firstIndex: u32,
  baseVertex: i32,
  firstInstance: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> clusterBounds: array<vec4<f32>>;
@group(0) @binding(2) var<storage, read> clusterRanges: array<ClusterRange>;
@group(0) @binding(3) var<storage, read> globalIndices: array<u32>;
@group(0) @binding(4) var<storage, read_write> visibleIndices: array<u32>;
@group(0) @binding(5) var<storage, read_write> counters: Counters;
@group(0) @binding(6) var<storage, read_write> drawArgs: DrawIndexedIndirectArgs;

// 上一帧生成的层级深度金字塔（max-Z），用于整簇遮挡剔除
@group(1) @binding(0) var hzb: texture_2d<f32>;

var<workgroup> wgCount: u32;
var<workgroup> wgOffset: u32;
var<workgroup> wgBase: u32;

fn sphereInsideFrustum(center: vec3<f32>, radius: f32) -> bool {
  for (var i = 0; i < 6; i++) {
    let plane = params.frustum[i];
    if (dot(plane.xyz, center) + plane.w < -radius) {
      return false;
    }
  }
  return true;
}

// 用上一帧的 max-Z 金字塔判断整簇是否被遮挡。
// 保守策略：任何不确定的情况（近平面、离屏、矩形过小）都返回“未被遮挡”。
fn isOccluded(center: vec3<f32>, radius: f32) -> bool {
  if (params.occlusion.z < 0.5) {
    return false;
  }

  let clip = params.viewProj * vec4<f32>(center, 1.0);
  if (clip.w <= 0.001) {
    return false;
  }

  let ndc = clip.xyz / clip.w;
  let cameraDistance = max(length(params.cameraPos.xyz - center), 1e-4);
  // 投影半径（多留 5% + 1 像素，保证矩形覆盖整个簇）
  // 只用投影半径的 60% 作测试矩形：分形表面有大量背景穿透，太大几乎剔不掉
  let radiusPx = radius * params.screen.y * 0.5 / (cameraDistance * params.screen.z) * 0.6 + 1.0;

  let centerPx = vec2<f32>(
    (ndc.x * 0.5 + 0.5) * params.screen.x,
    (0.5 - ndc.y * 0.5) * params.screen.y,
  );
  let rectMin = centerPx - vec2<f32>(radiusPx);
  let rectMax = centerPx + vec2<f32>(radiusPx);

  if (rectMax.x < 0.0 || rectMax.y < 0.0 || rectMin.x > params.screen.x || rectMin.y > params.screen.y) {
    return false;
  }

  // 球体最靠近相机的点：它的深度必须严格在遮挡体之后才可能被完全遮挡
  let nearestPoint = center - normalize(center - params.cameraPos.xyz) * radius;
  let nearestClip = params.viewProj * vec4<f32>(nearestPoint, 1.0);
  if (nearestClip.w <= 0.001) {
    return false;
  }
  let nearestDepth = clamp(nearestClip.z / nearestClip.w, 0.0, 1.0);

  let clampedMin = clamp(rectMin, vec2<f32>(0.0), params.screen.xy);
  let clampedMax = clamp(rectMax, vec2<f32>(0.0), params.screen.xy);
  let rectSize = max(clampedMax.x - clampedMin.x, clampedMax.y - clampedMin.y);
  if (rectSize < 2.0) {
    return false;
  }

  // 选一个 mip，使单个纹素不小于矩形（每级纹素覆盖 2^(level+1) 像素）
  let level = u32(clamp(floor(log2(rectSize * 0.5)), 0.0, params.occlusion.x));
  let tilePx = exp2(f32(level) + 1.0);
  let hzbDims = vec2<f32>(textureDimensions(hzb, level));
  let lo = clamp(vec2<f32>(floor(clampedMin / tilePx)), vec2<f32>(0.0), hzbDims - vec2<f32>(1.0));
  let hi = clamp(vec2<f32>(floor(clampedMax / tilePx)), vec2<f32>(0.0), hzbDims - vec2<f32>(1.0));

  var occluderDepth = 0.0;
  for (var y = u32(lo.y); y <= u32(hi.y); y++) {
    for (var x = u32(lo.x); x <= u32(hi.x); x++) {
      occluderDepth = max(occluderDepth, textureLoad(hzb, vec2<i32>(i32(x), i32(y)), level).r);
    }
  }

  return nearestDepth > occluderDepth + params.occlusion.y;
}

@compute @workgroup_size(64)
fn cull(
  @builtin(workgroup_id) workgroupId: vec3<u32>,
  @builtin(local_invocation_index) localIndex: u32,
) {
  let cluster = workgroupId.x;

  if (localIndex == 0u) {
    var count = 0u;
    var offset = 0u;
    var base = 0u;

    if (cluster < params.settings.x) {
      let bounds = clusterBounds[cluster];
      let center = bounds.xyz;
      let radius = bounds.w;
      let lodCount = params.settings.y;
      let forceFull = params.settings.z == 1u;

      let cameraDistance = distance(center, params.cameraPos.xyz);
      let projected =
        radius * params.screen.y * 0.5 / max(cameraDistance * params.screen.z, 1e-4);

      var lod = 3u;
      if (forceFull || projected > params.lodThresholds.x) {
        lod = 0u;
      } else if (projected > params.lodThresholds.y) {
        lod = 1u;
      } else if (projected > params.lodThresholds.z) {
        lod = 2u;
      }

      var visible = forceFull || sphereInsideFrustum(center, radius);
      var occluded = false;
      if (visible && !forceFull) {
        occluded = isOccluded(center, radius);
        if (occluded) {
          visible = false;
        }
      }

      if (occluded) {
        // 只统计本来会真正提交的簇（空簇不参与绘图）
        let occludedRange = clusterRanges[cluster * lodCount + lod];
        if (occludedRange.count > 0u) {
          atomicAdd(&counters.occluded, 1u);
        }
      }

      if (visible) {
        let range = clusterRanges[cluster * lodCount + lod];
        if (range.count > 0u) {
          count = range.count;
          offset = range.offset;
          // 每个可见簇只做一次原子操作，避免逐三角形竞争同一计数器
          base = atomicAdd(&counters.indices, count);
          atomicAdd(&counters.clusters, 1u);
          atomicAdd(&counters.lodCounts[lod], 1u);
        }
      }
    }

    wgCount = count;
    wgOffset = offset;
    wgBase = base;
  }

  workgroupBarrier();

  let count = wgCount;
  let base = wgBase;
  let offset = wgOffset;
  let capacity = params.settings.w;

  for (var i = localIndex; i < count; i += 64u) {
    let destination = base + i;
    if (destination < capacity) {
      visibleIndices[destination] = globalIndices[offset + i];
    }
  }
}

@compute @workgroup_size(1)
fn finalize() {
  let count = min(atomicLoad(&counters.indices), params.settings.w);
  drawArgs.indexCount = count;
  drawArgs.instanceCount = 1u;
  drawArgs.firstIndex = 0u;
  drawArgs.baseVertex = 0;
  drawArgs.firstInstance = 0u;
}
