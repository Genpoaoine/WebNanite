/**
 * 从列主序 viewProj 提取 6 个归一化视锥平面（WebGPU 的 NDC z ∈ [0, 1]）。
 * 输出布局：6 × vec4(nx, ny, nz, d)，满足 平面·p >= -r 表示球体在平面内侧。
 */
export function extractFrustumPlanes(viewProj: Float32Array, out: Float32Array): void {
  // 列主序：m[col * 4 + row]
  const row = (r: number): [number, number, number, number] => [
    viewProj[r],
    viewProj[4 + r],
    viewProj[8 + r],
    viewProj[12 + r],
  ];

  const r0 = row(0);
  const r1 = row(1);
  const r2 = row(2);
  const r3 = row(3);

  const write = (index: number, plane: [number, number, number, number]): void => {
    const length = Math.hypot(plane[0], plane[1], plane[2]) || 1;
    const offset = index * 4;
    out[offset] = plane[0] / length;
    out[offset + 1] = plane[1] / length;
    out[offset + 2] = plane[2] / length;
    out[offset + 3] = plane[3] / length;
  };

  write(0, [r3[0] + r0[0], r3[1] + r0[1], r3[2] + r0[2], r3[3] + r0[3]]); // left
  write(1, [r3[0] - r0[0], r3[1] - r0[1], r3[2] - r0[2], r3[3] - r0[3]]); // right
  write(2, [r3[0] + r1[0], r3[1] + r1[1], r3[2] + r1[2], r3[3] + r1[3]]); // bottom
  write(3, [r3[0] - r1[0], r3[1] - r1[1], r3[2] - r1[2], r3[3] - r1[3]]); // top
  write(4, [r2[0], r2[1], r2[2], r2[3]]); // near (z >= 0)
  write(5, [r3[0] - r2[0], r3[1] - r2[1], r3[2] - r2[2], r3[3] - r2[3]]); // far
}
