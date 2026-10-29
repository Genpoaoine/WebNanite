// HZB 逐级归约：把第 i-1 级的 2x2 最大值写入第 i 级。
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var dst: texture_storage_2d<r32float, write>;

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let dstDims = textureDimensions(dst);
  if (gid.x >= dstDims.x || gid.y >= dstDims.y) {
    return;
  }

  let srcDims = textureDimensions(src);
  let base = vec2<i32>(i32(gid.x) * 2, i32(gid.y) * 2);

  var maxDepth = 0.0;
  for (var y = 0; y < 2; y++) {
    for (var x = 0; x < 2; x++) {
      let p = base + vec2<i32>(x, y);
      if (p.x < i32(srcDims.x) && p.y < i32(srcDims.y)) {
        maxDepth = max(maxDepth, textureLoad(src, p, 0).r);
      }
    }
  }

  textureStore(dst, vec2<i32>(i32(gid.x), i32(gid.y)), vec4<f32>(maxDepth, 0.0, 0.0, 0.0));
}
