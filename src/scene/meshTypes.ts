/** 单级 LOD 的索引网格（顶点位置/法线为 xyz 紧密排列）。 */
export interface LodMesh {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  vertexCount: number;
  triangleCount: number;
}

/** Worker 交给主线程的 GPU 就绪数据（可转移）。 */
export interface MeshPayload {
  /** 每个顶点 vec4(x, y, z, 1)，所有 LOD 依次拼接。 */
  positions: Float32Array;
  /** 每个顶点 vec4(nx, ny, nz, 0)，与 positions 对齐。 */
  normals: Float32Array;
  /** 全局索引（已加上该 LOD 的顶点基址，按簇连续排列）。 */
  indices: Uint32Array;
  /** 每个簇 vec4(center.xyz, radius)。 */
  clusterBounds: Float32Array;
  /** 每个 (cluster, lod) 4 个 u32：indexOffset, indexCount, lod, pad。 */
  clusterRanges: Uint32Array;
  clusterCount: number;
  lodCount: number;
  triangleCountsPerLod: Uint32Array;
  vertexCountsPerLod: Uint32Array;
  totalTriangles: number;
  totalVertices: number;
}

export const CLUSTER_GRID_DIM = 14;
export const LOD_RESOLUTIONS: readonly number[] = [192, 112, 64, 40];
export const BOUNDS_MIN: readonly [number, number, number] = [-1.15, -1.15, -1.15];
export const BOUNDS_MAX: readonly [number, number, number] = [1.15, 1.15, 1.15];
