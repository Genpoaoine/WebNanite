import { clusterize } from './clusterize';
import { kernal } from './kernel';
import {
  BOUNDS_MAX,
  BOUNDS_MIN,
  CLUSTER_GRID_DIM,
  LOD_RESOLUTIONS,
  type LodMesh,
  type MeshPayload,
} from './meshTypes';
import { buildSurfaceNets } from './surfaceNets';

export type ProgressCallback = (progress: number, label: string) => void;

/**
 * 在 Worker 里跑完整条离线流水线：
 * 采样隐式场 → Surface Nets → 4 级 LOD → 空间分簇 → 打包成 GPU 缓冲布局。
 */
export function buildMeshPayload(onProgress: ProgressCallback): MeshPayload {
  const weights = LOD_RESOLUTIONS.map((resolution) => resolution ** 3);
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  const meshes: LodMesh[] = [];
  let completedWeight = 0;

  for (let lod = 0; lod < LOD_RESOLUTIONS.length; lod++) {
    const resolution = LOD_RESOLUTIONS[lod] ?? 40;
    const weight = weights[lod] ?? 1;
    const baseWeight = completedWeight;

    meshes.push(
      buildSurfaceNets(
        kernal,
        { min: BOUNDS_MIN, max: BOUNDS_MAX },
        resolution,
        (fraction) => {
          const overall = (baseWeight + fraction * weight) / totalWeight;
          onProgress(overall * 0.94, `LOD${lod} · ${resolution}³`);
        },
      ),
    );

    completedWeight += weight;
  }

  onProgress(0.96, 'CLUSTERING');
  const clustered = clusterize(meshes, BOUNDS_MIN, BOUNDS_MAX, CLUSTER_GRID_DIM);
  onProgress(1, 'DONE');

  return clustered;
}
