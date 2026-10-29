import { buildMeshPayload } from './buildMesh';
import type { BuildRequest, BuildResponse } from './meshProtocol';

// 不引入 WebWorker lib（会与 DOM lib 冲突），只声明这里用到的两个成员。
const scope = globalThis as unknown as {
  onmessage: ((event: MessageEvent<BuildRequest>) => void) | null;
  postMessage: (message: BuildResponse, transfer?: Transferable[]) => void;
};

let lastReported = -1;

scope.onmessage = (event) => {
  if (event.data.type !== 'build') {
    return;
  }

  lastReported = -1;
  try {
    const payload = buildMeshPayload((progress, label) => {
      // 节流，避免采样期间每 16 层就发一条消息
      if (progress - lastReported < 0.01 && progress < 1) {
        return;
      }
      lastReported = progress;
      scope.postMessage({ type: 'progress', progress, label });
    });

    scope.postMessage({ type: 'done', payload }, [
      payload.positions.buffer as ArrayBuffer,
      payload.normals.buffer as ArrayBuffer,
      payload.indices.buffer as ArrayBuffer,
      payload.clusterBounds.buffer as ArrayBuffer,
      payload.clusterRanges.buffer as ArrayBuffer,
      payload.triangleCountsPerLod.buffer as ArrayBuffer,
      payload.vertexCountsPerLod.buffer as ArrayBuffer,
    ]);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error),
    });
  }
};
