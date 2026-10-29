/**
 * WebGPU 设备初始化（环境脚手架）。
 * 只负责 adapter / device / canvas context 的获取与诊断信息，不包含任何渲染逻辑。
 */
import { t } from '../ui/i18n';

export interface GpuBootstrap {
  readonly adapter: GPUAdapter;
  readonly device: GPUDevice;
  readonly context: GPUCanvasContext;
  readonly format: GPUTextureFormat;
  /** 是否启用了 timestamp-query（用于 GPU 端耗时统计）。 */
  readonly hasTimestampQuery: boolean;
}

/** 环境层面的失败：浏览器不支持、无可用适配器、canvas 上下文创建失败等。 */
export class WebGpuUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebGpuUnavailableError';
  }
}

export interface GpuInitOptions {
  /** 仅作提示，Chromium 在 Windows 上还会受系统「图形首选项」影响。 */
  readonly powerPreference?: GPUPowerPreference;
}

export async function initWebGpu(
  canvas: HTMLCanvasElement,
  options: GpuInitOptions = {},
): Promise<GpuBootstrap> {
  if (!navigator.gpu) {
    throw new WebGpuUnavailableError(t.webgpuMissing);
  }

  const adapter = await navigator.gpu.requestAdapter({
    powerPreference: options.powerPreference ?? 'high-performance',
  });
  if (!adapter) {
    throw new WebGpuUnavailableError(t.adapterMissing);
  }

  const device = await adapter.requestDevice({
    label: 'webnanite-device',
    // 有就启用：vsync 锁帧时用 GPU 时间戳仍能量化真实渲染成本
    requiredFeatures: adapter.features.has('timestamp-query') ? ['timestamp-query'] : [],
  });
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new WebGpuUnavailableError(t.contextMissing);
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });

  return { adapter, device, context, format, hasTimestampQuery: device.features.has('timestamp-query') };
}

/** 汇总 GPUAdapterInfo，用于确认实际使用的 GPU（部分平台字段为空）。 */
export function describeAdapter(adapter: GPUAdapter): string {
  const info: Partial<GPUAdapterInfo> = adapter.info ?? {};
  const parts = [info.vendor, info.architecture, info.device, info.description].filter(
    (part) => typeof part === 'string' && part.length > 0,
  );
  return parts.length > 0 ? parts.join(' · ') : '未提供 GPUAdapterInfo 明细';
}

/**
 * 粗判是否为核显 / 虚拟显示适配器，仅用于 HUD 提示，不是权威结论。
 * 依据是 GPUAdapterInfo 里常见的集成显卡架构标识（如 intel gen-12lp）。
 */
export function isLikelyIntegratedGpu(adapter: GPUAdapter): boolean {
  const info: Partial<GPUAdapterInfo> = adapter.info ?? {};
  const text = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.device ?? ''} ${info.description ?? ''}`
    .toLowerCase();
  return /gen-\d+|uhd graphics|iris|hd graphics|microsoft basic/.test(text);
}

/** 列出一组与后续 Cluster / Compute 方案直接相关的设备上限。 */
export function describeKeyLimits(device: GPUDevice): Array<[label: string, value: string]> {
  const { limits } = device;
  const mib = (bytes: number): string => `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
  return [
    ['maxBufferSize', mib(limits.maxBufferSize)],
    ['maxStorageBufferBindingSize', mib(limits.maxStorageBufferBindingSize)],
    ['maxStorageBuffersPerShaderStage', String(limits.maxStorageBuffersPerShaderStage)],
    ['maxComputeWorkgroupSizeX', String(limits.maxComputeWorkgroupSizeX)],
    ['maxComputeInvocationsPerWorkgroup', String(limits.maxComputeInvocationsPerWorkgroup)],
    ['maxComputeWorkgroupStorageSize', `${limits.maxComputeWorkgroupStorageSize} B`],
  ];
}
