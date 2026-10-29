import type { LodMesh } from './meshTypes';

export interface ClusterizeResult {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  clusterBounds: Float32Array;
  clusterRanges: Uint32Array;
  clusterCount: number;
  lodCount: number;
  triangleCountsPerLod: Uint32Array;
  vertexCountsPerLod: Uint32Array;
  totalTriangles: number;
  totalVertices: number;
}

/**
 * 把多级 LOD 网格切成空间簇，并拼成 GPU 可直接消费的布局：
 * - positions / normals：所有 LOD 依次拼接（vec4，满足 storage 对齐）
 * - indices：绝对索引，同一 LOD 内按簇连续，因此每个 (簇, LOD) 就是一个连续区间
 * - clusterBounds：每簇一个包围球（跨所有 LOD 合并，切换 LOD 时不会抖动）
 * - clusterRanges：每个 (簇, LOD) 的 indexOffset / indexCount
 */
export function clusterize(
  lodMeshes: readonly LodMesh[],
  boundsMin: readonly [number, number, number],
  boundsMax: readonly [number, number, number],
  clusterDim: number,
): ClusterizeResult {
  const lodCount = lodMeshes.length;
  const clusterCount = clusterDim * clusterDim * clusterDim;

  const [minX] = boundsMin;
  const cellSize = (boundsMax[0] - boundsMin[0]) / clusterDim;
  const cellCenterOrigin = minX + cellSize * 0.5;

  let totalVertices = 0;
  let totalTriangles = 0;
  const vertexCountsPerLod = new Uint32Array(lodCount);
  const triangleCountsPerLod = new Uint32Array(lodCount);

  for (let l = 0; l < lodCount; l++) {
    const mesh = lodMeshes[l];
    if (!mesh) {
      continue;
    }
    vertexCountsPerLod[l] = mesh.vertexCount;
    triangleCountsPerLod[l] = mesh.triangleCount;
    totalVertices += mesh.vertexCount;
    totalTriangles += mesh.triangleCount;
  }

  // ---------- 顶点拼接 ----------
  const positions = new Float32Array(totalVertices * 4);
  const normals = new Float32Array(totalVertices * 4);
  const vertexBase = new Uint32Array(lodCount + 1);

  let vertexOffset = 0;
  for (let l = 0; l < lodCount; l++) {
    const mesh = lodMeshes[l];
    if (!mesh) {
      continue;
    }
    vertexBase[l] = vertexOffset;
    for (let v = 0; v < mesh.vertexCount; v++) {
      const dst = (vertexOffset + v) * 4;
      positions[dst] = mesh.positions[v * 3];
      positions[dst + 1] = mesh.positions[v * 3 + 1];
      positions[dst + 2] = mesh.positions[v * 3 + 2];
      positions[dst + 3] = 1;
      normals[dst] = mesh.normals[v * 3];
      normals[dst + 1] = mesh.normals[v * 3 + 1];
      normals[dst + 2] = mesh.normals[v * 3 + 2];
      normals[dst + 3] = 0;
    }
    vertexOffset += mesh.vertexCount;
  }
  vertexBase[lodCount] = vertexOffset;

  // ---------- 索引按簇分组 ----------
  const indices = new Uint32Array(totalTriangles * 3);
  const clusterRanges = new Uint32Array(clusterCount * lodCount * 4);

  // 每簇合并 AABB（跨全部 LOD）
  const aabbMin = new Float32Array(clusterCount * 3).fill(Number.POSITIVE_INFINITY);
  const aabbMax = new Float32Array(clusterCount * 3).fill(Number.NEGATIVE_INFINITY);

  let maxTrianglesPerLod = 0;
  for (const count of triangleCountsPerLod) {
    maxTrianglesPerLod = Math.max(maxTrianglesPerLod, count);
  }

  const triangleClusters = new Uint32Array(maxTrianglesPerLod);
  const clusterCounts = new Uint32Array(clusterCount);
  const clusterOffsets = new Uint32Array(clusterCount + 1);
  const writeCursor = new Uint32Array(clusterCount);

  const minBoundX = boundsMin[0];
  const minBoundY = boundsMin[1];
  const minBoundZ = boundsMin[2];

  const clusterIndexOf = (x: number, y: number, z: number): number => {
    const ix = Math.min(clusterDim - 1, Math.max(0, Math.floor((x - minBoundX) / cellSize)));
    const iy = Math.min(clusterDim - 1, Math.max(0, Math.floor((y - minBoundY) / cellSize)));
    const iz = Math.min(clusterDim - 1, Math.max(0, Math.floor((z - minBoundZ) / cellSize)));
    return ix + clusterDim * (iy + clusterDim * iz);
  };

  let indexCursor = 0;
  for (let l = 0; l < lodCount; l++) {
    const mesh = lodMeshes[l];
    if (!mesh) {
      continue;
    }

    clusterCounts.fill(0);
    writeCursor.fill(0);
    const base = vertexBase[l];
    const triangleCount = mesh.triangleCount;

    // 第一遍：按三角形重心归类，并累计簇 AABB
    for (let t = 0; t < triangleCount; t++) {
      const ia = mesh.indices[t * 3] * 3;
      const ib = mesh.indices[t * 3 + 1] * 3;
      const ic = mesh.indices[t * 3 + 2] * 3;
      const cx = (mesh.positions[ia] + mesh.positions[ib] + mesh.positions[ic]) / 3;
      const cy = (mesh.positions[ia + 1] + mesh.positions[ib + 1] + mesh.positions[ic + 1]) / 3;
      const cz = (mesh.positions[ia + 2] + mesh.positions[ib + 2] + mesh.positions[ic + 2]) / 3;
      const cluster = clusterIndexOf(cx, cy, cz);

      triangleClusters[t] = cluster;
      clusterCounts[cluster]++;

      const c3 = cluster * 3;
      for (let corner = 0; corner < 3; corner++) {
        const index = mesh.indices[t * 3 + corner] * 3;
        const px = mesh.positions[index];
        const py = mesh.positions[index + 1];
        const pz = mesh.positions[index + 2];
        if (px < aabbMin[c3]) aabbMin[c3] = px;
        if (py < aabbMin[c3 + 1]) aabbMin[c3 + 1] = py;
        if (pz < aabbMin[c3 + 2]) aabbMin[c3 + 2] = pz;
        if (px > aabbMax[c3]) aabbMax[c3] = px;
        if (py > aabbMax[c3 + 1]) aabbMax[c3 + 1] = py;
        if (pz > aabbMax[c3 + 2]) aabbMax[c3 + 2] = pz;
      }
    }

    // 前缀和：本 LOD 内每个簇的起始位置
    clusterOffsets[0] = 0;
    for (let c = 0; c < clusterCount; c++) {
      clusterOffsets[c + 1] = clusterOffsets[c] + clusterCounts[c] * 3;
    }

    const lodIndexStart = indexCursor;
    for (let c = 0; c < clusterCount; c++) {
      const rangeIndex = (c * lodCount + l) * 4;
      clusterRanges[rangeIndex] = lodIndexStart + clusterOffsets[c];
      clusterRanges[rangeIndex + 1] = clusterCounts[c] * 3;
      clusterRanges[rangeIndex + 2] = l;
      clusterRanges[rangeIndex + 3] = 0;
    }

    // 第二遍：写入全局索引（绝对顶点索引）
    for (let t = 0; t < triangleCount; t++) {
      const cluster = triangleClusters[t];
      const target = lodIndexStart + clusterOffsets[cluster] + writeCursor[cluster];
      writeCursor[cluster] += 3;
      indices[target] = base + mesh.indices[t * 3];
      indices[target + 1] = base + mesh.indices[t * 3 + 1];
      indices[target + 2] = base + mesh.indices[t * 3 + 2];
    }

    indexCursor += triangleCount * 3;
  }

  // ---------- 簇包围球 ----------
  const clusterBounds = new Float32Array(clusterCount * 4);
  const cellRadius = cellSize * 0.5 * Math.sqrt(3);

  for (let c = 0; c < clusterCount; c++) {
    const c3 = c * 3;
    const dst = c * 4;
    if (!Number.isFinite(aabbMin[c3]) || !Number.isFinite(aabbMax[c3])) {
      const ix = c % clusterDim;
      const iy = Math.floor(c / clusterDim) % clusterDim;
      const iz = Math.floor(c / (clusterDim * clusterDim));
      clusterBounds[dst] = cellCenterOrigin + ix * cellSize;
      clusterBounds[dst + 1] = cellCenterOrigin + iy * cellSize;
      clusterBounds[dst + 2] = cellCenterOrigin + iz * cellSize;
      clusterBounds[dst + 3] = 0;
      continue;
    }

    const cx = (aabbMin[c3] + aabbMax[c3]) * 0.5;
    const cy = (aabbMin[c3 + 1] + aabbMax[c3 + 1]) * 0.5;
    const cz = (aabbMin[c3 + 2] + aabbMax[c3 + 2]) * 0.5;
    const hx = (aabbMax[c3] - aabbMin[c3]) * 0.5;
    const hy = (aabbMax[c3 + 1] - aabbMin[c3 + 1]) * 0.5;
    const hz = (aabbMax[c3 + 2] - aabbMin[c3 + 2]) * 0.5;

    clusterBounds[dst] = cx;
    clusterBounds[dst + 1] = cy;
    clusterBounds[dst + 2] = cz;
    // AABB 半对角线是保守半径；再加 1mm 余量，避免顶点恰好落在球外
    clusterBounds[dst + 3] = Math.max(Math.sqrt(hx * hx + hy * hy + hz * hz), cellRadius * 0.25) + 1e-3;
  }

  return {
    positions,
    normals,
    indices,
    clusterBounds,
    clusterRanges,
    clusterCount,
    lodCount,
    triangleCountsPerLod,
    vertexCountsPerLod,
    totalTriangles,
    totalVertices,
  };
}
