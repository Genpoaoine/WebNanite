import './style.css';
import {
  describeAdapter,
  describeKeyLimits,
  initWebGpu,
  isLikelyIntegratedGpu,
  WebGpuUnavailableError,
} from './gpu/device';
import { OrbitCamera } from './render/camera';
import { NaniteRenderer, type RenderMode } from './render/naniteRenderer';
import { AURORA_PRESET, type PalettePreset } from './render/palette';
import { NEON_PRESET } from './render/paletteRainbow';
import { requestMesh } from './scene/meshClient';
import { CLUSTER_GRID_DIM } from './scene/meshTypes';
import { applyI18n, presetLabel, t } from './ui/i18n';

const MAX_DPR = 2;
const FPS_WINDOW_MS = 500;
const STATS_INTERVAL_MS = 200;
const BRUTE_SPIN_SCALE = 6;

function byId(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`页面缺少 #${id} 元素`);
  }
  return element;
}

function canvasById(id: string): HTMLCanvasElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLCanvasElement)) {
    throw new Error(`页面缺少 <canvas id="${id}"> 元素`);
  }
  return element;
}

function buttonById(id: string): HTMLButtonElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`页面缺少 <button id="${id}"> 元素`);
  }
  return element;
}

const canvas = canvasById('gpu-canvas');
const fpsEl = byId('hud-fps');
const frameTimeEl = byId('hud-frametime');
const trianglesEl = byId('hud-tris');
const clustersEl = byId('hud-clusters');
const lodsEl = byId('hud-lods');
const gpuEl = byId('hud-gpu');
const statusEl = byId('hud-status');
const adapterEl = byId('hud-adapter');
const hintEl = byId('hud-hint');
const toggleEl = byId('hud-toggle');
const shadeEl = byId('hud-shade');
const presetEl = buttonById('hud-preset');
const hudEl = byId('hud');
const collapseEl = buttonById('hud-collapse');
const pauseEl = buttonById('hud-pause');

// 先按浏览器语言填充静态文案（中文 → 中文，其余 → 英文）
applyI18n();
const meshInfoEl = byId('hud-mesh');

let mode: RenderMode = 'gpu';

/** 小屏或矮屏（含手机横屏）时自动收起面板。 */
const COMPACT_QUERY = '(max-width: 720px), (max-height: 520px)';

function setCollapsed(collapsed: boolean): void {
  hudEl.classList.toggle('collapsed', collapsed);
  collapseEl.textContent = `${t.detailLabel} ${collapsed ? '▸' : '▾'}`;
  collapseEl.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
  collapseEl.setAttribute('aria-label', collapsed ? t.expandPanel : t.collapsePanel);
}

const compactQuery = window.matchMedia(COMPACT_QUERY);
setCollapsed(compactQuery.matches);
compactQuery.addEventListener('change', (event) => {
  setCollapsed(event.matches);
});
collapseEl.addEventListener('click', () => {
  setCollapsed(!hudEl.classList.contains('collapsed'));
});

function formatCount(value: number): string {
  return Number.isFinite(value) ? Math.round(value).toLocaleString('en-US') : '—';
}

/** Worker 用语言无关的 token 上报阶段，这里映射成当前语言的文案。 */
function stageLabel(raw: string): string {
  if (raw === 'CLUSTERING') {
    return t.stageCluster;
  }
  if (raw === 'DONE') {
    return t.stageDone;
  }
  return raw; // 例如 "LOD0 · 192³"
}

function setStatus(text: string, kind: 'ok' | 'warn' | 'error'): void {
  statusEl.textContent = text;
  statusEl.dataset['kind'] = kind;
}

/** 启动失败只弹一次窗，避免后续异步失败重复打扰。 */
let fatalAlertShown = false;

/**
 * 环境不支持 WebGPU 这类致命错误：除 HUD 里写明原因外，再弹一个系统弹窗。
 * 旧手机 / 移动端面板往往被收起或看不全，弹窗能保证「为什么是黑屏」被看到。
 * 部分 WebView 禁用了 alert，失败时静默忽略，HUD 与 console 里仍有完整信息。
 */
function showFatalAlert(message: string): void {
  if (fatalAlertShown) {
    return;
  }
  fatalAlertShown = true;
  try {
    window.alert(message);
  } catch (error) {
    console.error('[webnanite] alert 不可用', error);
  }
}

function syncCanvasSize(): boolean {
  const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const width = Math.max(1, Math.floor(canvas.clientWidth * dpr));
  const height = Math.max(1, Math.floor(canvas.clientHeight * dpr));
  if (canvas.width === width && canvas.height === height) {
    return false;
  }
  canvas.width = width;
  canvas.height = height;
  return true;
}

function applyMode(next: RenderMode): void {
  mode = next;
  if (next === 'gpu') {
    toggleEl.textContent = t.modeGpu;
    setStatus(t.readyGpu, 'ok');
  } else {
    toggleEl.textContent = t.modeBrute;
    setStatus(t.readyBrute, 'ok');
  }
  toggleEl.dataset['mode'] = next;
}

function infoRow(label: string, value: string): HTMLLIElement {
  const item = document.createElement('li');
  item.textContent = `${label}${t.infoSeparator}${value}`;
  return item;
}

async function main(): Promise<void> {
  setStatus(t.statusAdapter, 'warn');
  const gpu = await initWebGpu(canvas);
  const { device, context } = gpu;

  adapterEl.textContent = describeAdapter(gpu.adapter);
  if (isLikelyIntegratedGpu(gpu.adapter)) {
    hintEl.textContent = t.hintIntegrated;
    hintEl.hidden = false;
  }

  setStatus(t.statusWorker, 'warn');
  const payload = await requestMesh((progress, label) => {
    setStatus(t.progressText(stageLabel(label), Math.round(progress * 100)), 'warn');
  });

  setStatus(t.statusCompile, 'warn');
  const renderer = await NaniteRenderer.create(device, gpu.format, payload, NEON_PRESET);

  const vertexMiB = (payload.positions.byteLength + payload.normals.byteLength) / 1048576;
  const indexMiB = payload.indices.byteLength / 1048576;
  meshInfoEl.replaceChildren(
    infoRow(t.meshLod0Triangles, formatCount(payload.triangleCountsPerLod[0])),
    infoRow(t.meshLod0Vertices, formatCount(payload.vertexCountsPerLod[0])),
    infoRow(t.meshAllLods, formatCount(payload.totalTriangles)),
    infoRow(
      t.meshClusters,
      t.meshClusterValue(formatCount(payload.clusterCount), CLUSTER_GRID_DIM),
    ),
    infoRow(t.meshBuffers, t.meshBufferValue(indexMiB.toFixed(1), vertexMiB.toFixed(1))),
    ...describeKeyLimits(device)
      .slice(0, 2)
      .map(([label, value]) => infoRow(label, value)),
  );

  const camera = new OrbitCamera();
  camera.attach(canvas);

  // 右下角：暂停 / 恢复自转
  let rotating = true;
  const applyRotation = (enabled: boolean): void => {
    rotating = enabled;
    camera.autoRotateEnabled = enabled;
    pauseEl.textContent = enabled ? '⏸' : '▶';
    pauseEl.setAttribute('aria-pressed', enabled ? 'false' : 'true');
    pauseEl.setAttribute('aria-label', enabled ? t.pauseRotation : t.resumeRotation);
    pauseEl.title = enabled ? t.pauseRotation : t.resumeRotation;
  };
  pauseEl.addEventListener('click', () => {
    applyRotation(!rotating);
  });
  applyRotation(true);

  const toggleMode = (): void => {
    applyMode(mode === 'gpu' ? 'brute' : 'gpu');
  };
  toggleEl.addEventListener('click', toggleMode);

  let gradient = true;
  const applyShading = (enabled: boolean): void => {
    gradient = enabled;
    renderer.gradientEnabled = enabled;
    shadeEl.textContent = enabled ? t.gradientOn : t.gradientOff;
    shadeEl.dataset['mode'] = enabled ? 'gradient' : 'flat';
  };
  shadeEl.addEventListener('click', () => {
    applyShading(!gradient);
  });
  applyShading(true);

  let preset: PalettePreset = NEON_PRESET;
  // 打开页面默认就是阿尔卑斯糖果：先把按钮文案与状态对齐
  presetEl.textContent = `${t.palettePrefix}${presetLabel(preset.id, preset.label)}`;
  presetEl.dataset['preset'] = preset.id;
  const applyPreset = async (next: PalettePreset): Promise<void> => {
    presetEl.disabled = true;
    try {
      // 颜色常量编译在 WGSL 里：等新管线就绪后再更新按钮文字
      await renderer.setPalette(next);
      preset = next;
      presetEl.textContent = `${t.palettePrefix}${presetLabel(next.id, next.label)}`;
      presetEl.dataset['preset'] = next.id;
    } catch (error) {
      console.error('[webnanite] 切换配色失败', error);
    } finally {
      presetEl.disabled = false;
    }
  };
  presetEl.addEventListener('click', () => {
    void applyPreset(preset.id === NEON_PRESET.id ? AURORA_PRESET : NEON_PRESET);
  });

  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') {
      event.preventDefault();
      toggleMode();
    } else if (event.code === 'KeyG') {
      applyShading(!gradient);
    }
  });

  let running = true;
  void device.lost.then((info) => {
    running = false;
    setStatus(`${t.deviceLost}${info.reason}｜${info.message}`, 'error');
  });

  syncCanvasSize();
  new ResizeObserver(() => {
    syncCanvasSize();
  }).observe(canvas);

  applyMode('gpu');

  // 自动化验证用的调试入口（仅开发模式）
  if (import.meta.env.DEV) {
    (globalThis as unknown as Record<string, unknown>)['__webnanite'] = {
      getStats: () => ({
        mode,
        fps: fpsEl.textContent,
        frameTime: frameTimeEl.textContent,
        visibleTriangles: renderer.stats.visibleTriangles,
        visibleClusters: renderer.stats.visibleClusters,
        visibleLods: renderer.stats.visibleLods,
        gpuMs: renderer.stats.gpuMs,
        occludedClusters: renderer.stats.occludedClusters,
        gradient: renderer.gradientEnabled,
        palette: renderer.paletteId,
        cameraDistance: camera.currentDistance,
        cameraYaw: camera.currentYaw,
        rotating,
        totalTriangles: payload.triangleCountsPerLod[0],
        clusterCount: payload.clusterCount,
        status: statusEl.textContent,
      }),
      setMode: applyMode,
      setGradient: applyShading,
      setPreset: (id: string) => {
        void applyPreset(id === NEON_PRESET.id ? NEON_PRESET : AURORA_PRESET);
      },
    };
  }

  let lastTime = performance.now();
  let fpsFrames = 0;
  let fpsWindowStart = lastTime;
  let nextStatsTime = 0;

  const frame = (now: number): void => {
    if (!running) {
      return;
    }

    const deltaSeconds = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;

    syncCanvasSize();
    const aspect = canvas.width / Math.max(canvas.height, 1);
    camera.update(deltaSeconds, aspect, mode === 'brute' ? BRUTE_SPIN_SCALE : 1);

    renderer.resize(canvas.width, canvas.height);
    renderer.render(camera, mode, now / 1000, context.getCurrentTexture().createView());

    fpsFrames++;
    const windowElapsed = now - fpsWindowStart;
    if (windowElapsed >= FPS_WINDOW_MS) {
      const fps = (fpsFrames * 1000) / windowElapsed;
      fpsEl.textContent = fps.toFixed(0);
      frameTimeEl.textContent = `${(1000 / fps).toFixed(2)} ms`;
      fpsFrames = 0;
      fpsWindowStart = now;
    }

    if (now >= nextStatsTime) {
      nextStatsTime = now + STATS_INTERVAL_MS;
      const { visibleTriangles, visibleClusters, visibleLods, gpuMs, occludedClusters } =
        renderer.stats;
      trianglesEl.textContent = `${formatCount(visibleTriangles)} / ${formatCount(payload.triangleCountsPerLod[0])}`;
      clustersEl.textContent = `${formatCount(visibleClusters)} / ${formatCount(payload.clusterCount)}（遮挡剔除 ${formatCount(occludedClusters)}）`;
      lodsEl.textContent = visibleLods.map((value) => formatCount(value)).join(' / ');
      gpuEl.textContent = gpuMs > 0 ? `${gpuMs.toFixed(2)} ms` : '不可用';
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

main().catch((error: unknown) => {
  if (error instanceof WebGpuUnavailableError) {
    setStatus(`${t.webgpuUnavailable}${error.message}`, 'error');
    showFatalAlert(t.webgpuAlert(error.message));
    console.error(error);
    return;
  }
  setStatus(
    error instanceof Error
      ? `${t.errorPrefix}${error.message}`
      : `${t.errorPrefix}${String(error)}`,
    'error',
  );
  console.error(error);
});
