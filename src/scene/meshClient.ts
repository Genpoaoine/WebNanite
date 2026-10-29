import type { BuildRequest, BuildResponse } from './meshProtocol';
import type { MeshPayload } from './meshTypes';

/** 启动网格化 Worker，返回可转移的 GPU 就绪数据。 */
export function requestMesh(
  onProgress: (progress: number, label: string) => void,
): Promise<MeshPayload> {
  return new Promise<MeshPayload>((resolve, reject) => {
    const worker = new Worker(new URL('./meshWorker.ts', import.meta.url), { type: 'module' });

    const stop = (): void => {
      worker.terminate();
    };

    worker.onmessage = (event: MessageEvent<BuildResponse>) => {
      const message = event.data;
      if (message.type === 'progress') {
        onProgress(message.progress, message.label);
        return;
      }
      stop();
      if (message.type === 'done') {
        resolve(message.payload);
      } else {
        reject(new Error(message.message));
      }
    };

    worker.onerror = (event) => {
      stop();
      reject(new Error(event.message || '网格化 Worker 异常退出'));
    };

    const request: BuildRequest = { type: 'build' };
    worker.postMessage(request);
  });
}
