import type { LodMesh } from './meshTypes';

export interface SurfaceNetsBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}

// 单位立方体 8 个角，编号 bit0=x, bit1=y, bit2=z
const CORNER_X = [0, 1, 0, 1, 0, 1, 0, 1] as const;
const CORNER_Y = [0, 0, 1, 1, 0, 0, 1, 1] as const;
const CORNER_Z = [0, 0, 0, 0, 1, 1, 1, 1] as const;

// 12 条棱
const EDGE_A = [0, 2, 4, 6, 0, 1, 4, 5, 0, 1, 2, 3] as const;
const EDGE_B = [1, 3, 5, 7, 2, 3, 6, 7, 4, 5, 6, 7] as const;

/**
 * Naive Surface Nets：对隐式标量场提取四边形（拆成两个三角形）。
 * 相比 Marching Cubes，顶点更均匀、代码更短，且天然共享顶点，非常适合演示 LOD。
 */
export function buildSurfaceNets(
  field: (x: number, y: number, z: number) => number,
  bounds: SurfaceNetsBounds,
  resolution: number,
  onProgress?: (fraction: number) => void,
): LodMesh {
  if (resolution < 4) {
    throw new Error(`resolution 过小：${resolution}`);
  }

  const n = resolution;
  const dims = n - 1;
  const cellCount = dims * dims * dims;

  const [minX, minY, minZ] = bounds.min;
  const [maxX, maxY, maxZ] = bounds.max;
  const stepX = (maxX - minX) / dims;
  const stepY = (maxY - minY) / dims;
  const stepZ = (maxZ - minZ) / dims;

  // ---------- 1. 采样 ----------
  const samples = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++) {
    const z = minZ + stepZ * k;
    for (let j = 0; j < n; j++) {
      const y = minY + stepY * j;
      for (let i = 0; i < n; i++) {
        samples[i + n * (j + n * k)] = field(minX + stepX * i, y, z);
      }
    }
    if ((k & 15) === 0) {
      onProgress?.(0.62 * (k / n));
    }
  }

  // ---------- 2. 每个含零交叉的格子生成一个顶点 ----------
  const cellVerts = new Int32Array(cellCount).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  const values = new Float32Array(8);
  let vertexCount = 0;

  for (let k = 0; k < dims; k++) {
    for (let j = 0; j < dims; j++) {
      for (let i = 0; i < dims; i++) {
        const base = i + n * (j + n * k);
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const value = samples[base + CORNER_X[c] + n * (CORNER_Y[c] + n * CORNER_Z[c])];
          values[c] = value;
          if (value < 0) {
            mask |= 1 << c;
          }
        }
        if (mask === 0 || mask === 0xff) {
          continue;
        }

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let crossings = 0;
        for (let e = 0; e < 12; e++) {
          const a = EDGE_A[e];
          const b = EDGE_B[e];
          const va = values[a];
          const vb = values[b];
          if ((va < 0) === (vb < 0)) {
            continue;
          }
          const t = va / (va - vb);
          sx += CORNER_X[a] + (CORNER_X[b] - CORNER_X[a]) * t;
          sy += CORNER_Y[a] + (CORNER_Y[b] - CORNER_Y[a]) * t;
          sz += CORNER_Z[a] + (CORNER_Z[b] - CORNER_Z[a]) * t;
          crossings++;
        }
        if (crossings === 0) {
          continue;
        }

        positions.push(
          minX + stepX * (i + sx / crossings),
          minY + stepY * (j + sy / crossings),
          minZ + stepZ * (k + sz / crossings),
        );

        // 用格子 8 个角的值做中心差分，直接得到该顶点的外法线（免去每顶点 6 次内核求值）
        const gx =
          values[1] + values[3] + values[5] + values[7] -
          (values[0] + values[2] + values[4] + values[6]);
        const gy =
          values[2] + values[3] + values[6] + values[7] -
          (values[0] + values[1] + values[4] + values[5]);
        const gz =
          values[4] + values[5] + values[6] + values[7] -
          (values[0] + values[1] + values[2] + values[3]);
        const gradientLength = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;
        normals.push(-gx / gradientLength, -gy / gradientLength, -gz / gradientLength);

        cellVerts[i + dims * (j + dims * k)] = vertexCount;
        vertexCount++;
      }
    }
    if ((k & 7) === 0) {
      onProgress?.(0.62 + 0.13 * (k / dims));
    }
  }


  // ---------- 3. 沿三条轴把 4 个相邻格子连成四边形 ----------
  const indices: number[] = [];

  const cellVertexAt = (i: number, j: number, k: number): number =>
    cellVerts[i + dims * (j + dims * k)];

  const pushQuad = (c0: number, c1: number, c2: number, c3: number): void => {
    // 4 个格子都有顶点 → 两个三角形；
    // 只有 3 个（薄壁/边界处）→ 补一个三角形，避免留下小洞
    if (c0 >= 0 && c1 >= 0 && c2 >= 0 && c3 >= 0) {
      indices.push(c0, c1, c2, c0, c2, c3);
      return;
    }

    const valid = [c0, c1, c2, c3].filter((value) => value >= 0);
    if (valid.length === 3) {
      indices.push(valid[0], valid[1], valid[2]);
    }
  };

  const sampleAt = (i: number, j: number, k: number): number => samples[i + n * (j + n * k)];

  // x 方向棱
  for (let k = 1; k < dims; k++) {
    for (let j = 1; j < dims; j++) {
      for (let i = 0; i < dims; i++) {
        const a = sampleAt(i, j, k);
        const b = sampleAt(i + 1, j, k);
        if ((a < 0) === (b < 0)) {
          continue;
        }
        const c0 = cellVertexAt(i, j - 1, k - 1);
        const c1 = cellVertexAt(i, j, k - 1);
        const c2 = cellVertexAt(i, j, k);
        const c3 = cellVertexAt(i, j - 1, k);
        if (a < 0) {
          pushQuad(c0, c1, c2, c3);
        } else {
          pushQuad(c3, c2, c1, c0);
        }
      }
    }
    if ((k & 7) === 0) {
      onProgress?.(0.75 + 0.03 * (k / dims));
    }
  }

  // y 方向棱
  for (let k = 1; k < dims; k++) {
    for (let i = 1; i < dims; i++) {
      for (let j = 0; j < dims; j++) {
        const a = sampleAt(i, j, k);
        const b = sampleAt(i, j + 1, k);
        if ((a < 0) === (b < 0)) {
          continue;
        }
        const c0 = cellVertexAt(i - 1, j, k - 1);
        const c1 = cellVertexAt(i, j, k - 1);
        const c2 = cellVertexAt(i, j, k);
        const c3 = cellVertexAt(i - 1, j, k);
        if (a < 0) {
          pushQuad(c3, c2, c1, c0);
        } else {
          pushQuad(c0, c1, c2, c3);
        }
      }
    }
    if ((k & 7) === 0) {
      onProgress?.(0.78 + 0.03 * (k / dims));
    }
  }

  // z 方向棱
  for (let j = 1; j < dims; j++) {
    for (let i = 1; i < dims; i++) {
      for (let k = 0; k < dims; k++) {
        const a = sampleAt(i, j, k);
        const b = sampleAt(i, j, k + 1);
        if ((a < 0) === (b < 0)) {
          continue;
        }
        const c0 = cellVertexAt(i - 1, j - 1, k);
        const c1 = cellVertexAt(i, j - 1, k);
        const c2 = cellVertexAt(i, j, k);
        const c3 = cellVertexAt(i - 1, j, k);
        if (a < 0) {
          pushQuad(c0, c1, c2, c3);
        } else {
          pushQuad(c3, c2, c1, c0);
        }
      }
    }
    if ((j & 7) === 0) {
      onProgress?.(0.81 + 0.06 * (j / dims));
    }
  }

  // ---------- 4. 收尾 ----------
  onProgress?.(1);

  const indexArray = Uint32Array.from(indices);
  return {
    positions: Float32Array.from(positions),
    normals: Float32Array.from(normals),
    indices: indexArray,
    vertexCount,
    triangleCount: indexArray.length / 3,
  };
}
