/**
 * 极简 UI 国际化：检测浏览器语言，中文用中文，其余一律英文。
 * - 静态文案：HTML 上加 `data-i18n="key"`（或 `data-i18n-aria` / `data-i18n-title`），由 applyI18n() 统一填充
 * - 动态文案：直接读 `t.xxx`
 */
export type Lang = 'zh' | 'en';

function detectLang(): Lang {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language];
  return list.some((tag) => typeof tag === 'string' && /^zh(-|$)/i.test(tag)) ? 'zh' : 'en';
}

export const LANG: Lang = detectLang();

export interface UiStrings {
  documentTitle: string;
  fps: string;
  frameTime: string;
  triangles: string;
  clusters: string;
  lods: string;
  gpuTime: string;
  modeGpu: string;
  modeBrute: string;
  readyGpu: string;
  readyBrute: string;
  gradientOn: string;
  gradientOff: string;
  palettePrefix: string;
  presetLabels: Record<string, string>;
  statusAdapter: string;
  statusWorker: string;
  statusCompile: string;
  stageCluster: string;
  stageDone: string;
  hintIntegrated: string;
  infoSummary: string;
  meshLod0Triangles: string;
  meshLod0Vertices: string;
  meshAllLods: string;
  meshClusters: string;
  meshBuffers: string;
  meshClusterValue: (clusters: string, dim: number) => string;
  meshBufferValue: (indices: string, vertices: string) => string;
  controls: string;
  pauseRotation: string;
  resumeRotation: string;
  collapsePanel: string;
  expandPanel: string;
  errorPrefix: string;
  webgpuUnavailable: string;
  deviceLost: string;
  progressText: (label: string, percent: number) => string;
  github: string;
  infoSeparator: string;
  /** 面板右上角的展开/收起按钮文字（"详细信息" / "Detail"）。 */
  detailLabel: string;
  /** WebGPU 不可用的具体原因（device.ts 抛出）。 */
  webgpuMissing: string;
  adapterMissing: string;
  contextMissing: string;
  /** WGSL 编译失败（shader.ts 抛出）。 */
  wgslCompileFailed: (count: number, label: string) => string;
}

const ZH: UiStrings = {
  documentTitle: 'WebNanite · Mandelbulb Cluster LOD',
  fps: 'FPS',
  frameTime: '帧时',
  triangles: '可见三角面 / LOD0 全量',
  clusters: '可见簇 / 总簇',
  lods: 'LOD 分布（0 / 1 / 2 / 3 簇数）',
  gpuTime: 'GPU 时间（timestamp）',
  modeGpu: '模式：GPU 剔除 + LOD',
  modeBrute: '模式：暴力全开（无剔除 / LOD0）',
  readyGpu: '就绪 · 逐簇视锥剔除 + 动态 LOD，一次 drawIndexedIndirect',
  readyBrute: '就绪 · 全部簇 × LOD0，高速旋转（对照用）',
  gradientOn: '渐变：开',
  gradientOff: '渐变：关（单色）',
  palettePrefix: '配色：',
  presetLabels: { aurora: '极光（绿→蓝→紫）', neon: '阿尔卑斯糖果' },
  statusAdapter: '正在申请 WebGPU 适配器…',
  statusWorker: 'Worker 正在采样 Mandelbulb 并生成 4 级 LOD…',
  statusCompile: '编译 WGSL / 创建 GPU 管线…',
  stageCluster: '空间分簇 / 打包',
  stageDone: '完成',
  hintIntegrated:
    '当前用的是核显/虚拟显卡。想切到独显：Windows 设置 → 系统 → 显示 → 图形 → 添加浏览器 exe → 高性能；' +
    '或用 --force_high_performance_gpu 启动浏览器（重启浏览器后生效）。',
  infoSummary: '网格 / 设备信息',
  meshLod0Triangles: 'LOD0 三角面',
  meshLod0Vertices: 'LOD0 顶点',
  meshAllLods: '4 级 LOD 合计面数',
  meshClusters: '簇 / 空间划分',
  meshBuffers: 'GPU 缓冲',
  meshClusterValue: (clusters, dim) => `${clusters} 簇 · ${dim}³`,
  meshBufferValue: (indices, vertices) => `${indices} MiB 索引 + ${vertices} MiB 顶点`,
  controls: '拖拽/单指旋转 · 滚轮/双指缩放 · 空格切换模式 · G 切换颜色',
  pauseRotation: '暂停自转',
  resumeRotation: '恢复自转',
  collapsePanel: '收起面板',
  expandPanel: '展开面板',
  errorPrefix: '失败：',
  webgpuUnavailable: 'WebGPU 不可用：',
  deviceLost: '设备丢失：',
  progressText: (label, percent) => `${label} · ${percent}%`,
  github: 'GitHub 仓库',
  infoSeparator: '：',
  detailLabel: '详细信息',
  webgpuMissing:
    '当前浏览器没有暴露 navigator.gpu：请使用 Chrome/Edge 113+，并通过 http://localhost 或 https 访问（非安全上下文不会启用 WebGPU）。',
  adapterMissing:
    'requestAdapter() 返回 null：显卡驱动或浏览器没有提供 WebGPU 适配器，可先访问 chrome://gpu 查看 WebGPU 状态。',
  contextMissing: 'canvas.getContext("webgpu") 返回 null：无法创建 WebGPU 画布上下文。',
  wgslCompileFailed: (count, label) => `WGSL 编译失败（${count} 个错误），详见控制台：${label}`,
};

const EN: UiStrings = {
  documentTitle: 'WebNanite · Mandelbulb Cluster LOD',
  fps: 'FPS',
  frameTime: 'Frame',
  triangles: 'Triangles drawn / LOD0 total',
  clusters: 'Clusters visible / total',
  lods: 'LOD distribution (clusters 0/1/2/3)',
  gpuTime: 'GPU time (timestamp)',
  modeGpu: 'Mode: GPU culling + LOD',
  modeBrute: 'Mode: brute force (no culling / LOD0)',
  readyGpu: 'Ready · per-cluster frustum culling + dynamic LOD, one drawIndexedIndirect',
  readyBrute: 'Ready · every cluster × LOD0, fast spin (for comparison)',
  gradientOn: 'Gradient: on',
  gradientOff: 'Gradient: off (flat)',
  palettePrefix: 'Palette: ',
  presetLabels: { aurora: 'Aurora (green→blue→purple)', neon: 'Alpine Candy' },
  statusAdapter: 'Requesting WebGPU adapter…',
  statusWorker: 'Worker is sampling the Mandelbulb and building 4 LODs…',
  statusCompile: 'Compiling WGSL / creating GPU pipelines…',
  stageCluster: 'Clustering / packing',
  stageDone: 'Done',
  hintIntegrated:
    'Running on an integrated or virtual GPU. To use the discrete GPU: Windows Settings → System → Display → ' +
    'Graphics → add your browser executable → High performance; or launch the browser with ' +
    '--force_high_performance_gpu (restart required).',
  infoSummary: 'Mesh / device info',
  meshLod0Triangles: 'LOD0 triangles',
  meshLod0Vertices: 'LOD0 vertices',
  meshAllLods: 'Triangles across all LODs',
  meshClusters: 'Clusters / grid',
  meshBuffers: 'GPU buffers',
  meshClusterValue: (clusters, dim) => `${clusters} clusters · ${dim}³`,
  meshBufferValue: (indices, vertices) => `${indices} MiB indices + ${vertices} MiB vertices`,
  controls: 'Drag to orbit · wheel / pinch to zoom · Space to switch mode · G to toggle colors',
  pauseRotation: 'Pause rotation',
  resumeRotation: 'Resume rotation',
  collapsePanel: 'Collapse panel',
  expandPanel: 'Expand panel',
  errorPrefix: 'Error: ',
  webgpuUnavailable: 'WebGPU unavailable: ',
  deviceLost: 'Device lost: ',
  progressText: (label, percent) => `${label} · ${percent}%`,
  github: 'GitHub repository',
  infoSeparator: ': ',
  detailLabel: 'Detail',
  webgpuMissing:
    'This browser does not expose navigator.gpu: use Chrome/Edge 113+ over http://localhost or https ' +
    '(WebGPU is disabled in insecure contexts).',
  adapterMissing:
    'requestAdapter() returned null: the driver or browser provides no WebGPU adapter. ' +
    'Check chrome://gpu for the WebGPU status.',
  contextMissing: 'canvas.getContext("webgpu") returned null: could not create a WebGPU canvas context.',
  wgslCompileFailed: (count, label) =>
    `WGSL compilation failed (${count} error${count === 1 ? '' : 's'}), see the console: ${label}`,
};

const DICTIONARIES: Record<Lang, UiStrings> = { zh: ZH, en: EN };

/** 当前语言的文案表。 */
export const t: UiStrings = DICTIONARIES[LANG];

/** 把 HTML 里带 data-i18n* 的静态文案替换成当前语言。 */
export function applyI18n(): void {
  const values = t as unknown as Record<string, unknown>;

  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = element.dataset['i18n'];
    const value = key ? values[key] : undefined;
    if (typeof value === 'string') {
      element.textContent = value;
    }
  }

  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-aria]')) {
    const key = element.dataset['i18nAria'];
    const value = key ? values[key] : undefined;
    if (typeof value === 'string') {
      element.setAttribute('aria-label', value);
    }
  }

  for (const element of document.querySelectorAll<HTMLElement>('[data-i18n-title]')) {
    const key = element.dataset['i18nTitle'];
    const value = key ? values[key] : undefined;
    if (typeof value === 'string') {
      element.title = value;
    }
  }

  document.documentElement.lang = LANG === 'zh' ? 'zh-CN' : 'en';
  document.title = t.documentTitle;
}

/** 预设按钮上显示的名字（按 id 取当前语言，取不到就用预设自带的 label）。 */
export function presetLabel(id: string, fallback: string): string {
  return t.presetLabels[id] ?? fallback;
}
