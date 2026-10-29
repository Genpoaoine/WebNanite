import drawShader from '../shaders/clusterDraw.wgsl?raw';
import cullShader from '../shaders/cull.wgsl?raw';
import hzbDepthShader from '../shaders/hzbDepth.wgsl?raw';
import hzbReduceShader from '../shaders/hzbReduce.wgsl?raw';
import { createShaderModuleChecked } from '../gpu/shader';
import type { MeshPayload } from '../scene/meshTypes';
import { BOUNDS_MAX } from '../scene/meshTypes';
import type { OrbitCamera } from './camera';
import { extractFrustumPlanes } from './frustum';
import type { PalettePreset } from './palette';

export type RenderMode = 'gpu' | 'brute';

export interface RendererStats {
  visibleTriangles: number;
  visibleClusters: number;
  /** 每个 LOD 实际提交的簇数量（索引 0 = 最精细）。 */
  visibleLods: number[];
  /** GPU 端一帧耗时（毫秒），需要 timestamp-query。 */
  gpuMs: number;
  /** 被 HZB 遮挡剔除的簇数量。 */
  occludedClusters: number;
}

/** 簇在屏幕上的像素半径阈值（LOD0/1/2），调大 → 更积极地使用低模。 */
const LOD_THRESHOLDS = [60, 26, 10] as const;

const UNIFORM_BYTES = 256;
const SETTINGS_U32_OFFSET = 52;
const OCCLUSION_F32_OFFSET = 56;
const SHADING_F32_OFFSET = 60;
const OCCLUSION_DEPTH_BIAS = 0.0002;
const DEPTH_FORMAT: GPUTextureFormat = 'depth32float';
const HZB_FORMAT: GPUTextureFormat = 'r32float';
const HZB_WORKGROUP = 8;

interface RendererResources {
  readonly cullPipeline: GPUComputePipeline;
  readonly finalizePipeline: GPUComputePipeline;
  drawPipeline: GPURenderPipeline;
  readonly drawPipelineLayout: GPUPipelineLayout;
  readonly computeBindGroup: GPUBindGroup;
  readonly drawBindGroup: GPUBindGroup;
  readonly uniformBuffer: GPUBuffer;
  readonly visibleIndices: GPUBuffer;
  readonly argsBuffer: GPUBuffer;
  readonly counters: GPUBuffer;
  readonly staging: GPUBuffer;
  readonly querySet: GPUQuerySet | null;
  readonly queryResolveBuffer: GPUBuffer | null;
  readonly hzbDepthLayout: GPUBindGroupLayout;
  readonly hzbReduceLayout: GPUBindGroupLayout;
  readonly hzbCullLayout: GPUBindGroupLayout;
  readonly hzbDepthPipeline: GPUComputePipeline;
  readonly hzbReducePipeline: GPUComputePipeline;
}

/** 每帧从深度重建的 max-Z 金字塔（resize 时重建）。 */
interface HzbState {
  readonly texture: GPUTexture;
  readonly maxMip: number;
  readonly mipSizes: ReadonlyArray<readonly [number, number]>;
  readonly buildBindGroups: readonly GPUBindGroup[];
}

export class NaniteRenderer {
  readonly stats: RendererStats = {
    visibleTriangles: 0,
    visibleClusters: 0,
    visibleLods: [0, 0, 0, 0],
    gpuMs: 0,
    occludedClusters: 0,
  };
  readonly clusterCount: number;
  readonly lodCount: number;
  readonly totalTriangles: number;
  readonly triangleCountsPerLod: Uint32Array;
  readonly totalVertices: number;

  /** HUD 开关：true = 绿→蓝→紫渐变，false = 单色。 */
  gradientEnabled = true;

  private readonly device: GPUDevice;
  private readonly format: GPUTextureFormat;
  private readonly drawPipelineLayout: GPUPipelineLayout;
  private readonly resources: RendererResources;
  private preset: PalettePreset;
  private readonly uniformData = new ArrayBuffer(UNIFORM_BYTES);
  private readonly uniformF32 = new Float32Array(this.uniformData);
  private readonly uniformU32 = new Uint32Array(this.uniformData);
  private readonly frustumPlanes = new Float32Array(24);
  private readonly zeroCounters = new Uint32Array(8);
  private readonly indexCapacity: number;

  private depthTexture: GPUTexture | null = null;
  private hzb: HzbState | null = null;
  private cullHzbBindGroup: GPUBindGroup | null = null;
  private hzbValid = false;
  private width = 1;
  private height = 1;
  private statsPending = false;

  private constructor(
    device: GPUDevice,
    format: GPUTextureFormat,
    payload: MeshPayload,
    preset: PalettePreset,
    resources: RendererResources,
  ) {
    this.device = device;
    this.format = format;
    this.preset = preset;
    this.drawPipelineLayout = resources.drawPipelineLayout;
    this.resources = resources;
    this.clusterCount = payload.clusterCount;
    this.lodCount = payload.lodCount;
    this.totalTriangles = payload.totalTriangles;
    this.triangleCountsPerLod = payload.triangleCountsPerLod;
    this.totalVertices = payload.totalVertices;
    this.indexCapacity = payload.indices.length;
  }

  static async create(
    device: GPUDevice,
    format: GPUTextureFormat,
    payload: MeshPayload,
    preset: PalettePreset,
  ): Promise<NaniteRenderer> {
    const cullModule = await createShaderModuleChecked(device, 'cull.wgsl', cullShader);
    const drawModule = await createShaderModuleChecked(
      device,
      `clusterDraw.wgsl#${preset.id}`,
      `${preset.toWgsl()}\n${drawShader}`,
    );

    // ---------- Compute：剔除 + LOD + 压缩 ----------
    const computeLayout = device.createBindGroupLayout({
      label: 'nanite-compute-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
        { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
        { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      ],
    });

    // ---------- HZB：上一帧深度的 max-Z 金字塔 ----------
    const hzbDepthLayout = device.createBindGroupLayout({
      label: 'nanite-hzb-depth-layout',
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'depth' } },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: HZB_FORMAT },
        },
      ],
    });

    const hzbReduceLayout = device.createBindGroupLayout({
      label: 'nanite-hzb-reduce-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: 'write-only', format: HZB_FORMAT },
        },
      ],
    });

    const hzbCullLayout = device.createBindGroupLayout({
      label: 'nanite-hzb-cull-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          texture: { sampleType: 'unfilterable-float' },
        },
      ],
    });

    const hzbDepthModule = await createShaderModuleChecked(
      device,
      'hzbDepth.wgsl',
      hzbDepthShader,
    );
    const hzbReduceModule = await createShaderModuleChecked(
      device,
      'hzbReduce.wgsl',
      hzbReduceShader,
    );

    const hzbDepthPipeline = device.createComputePipeline({
      label: 'nanite-hzb-depth',
      layout: device.createPipelineLayout({ bindGroupLayouts: [hzbDepthLayout] }),
      compute: { module: hzbDepthModule, entryPoint: 'main' },
    });

    const hzbReducePipeline = device.createComputePipeline({
      label: 'nanite-hzb-reduce',
      layout: device.createPipelineLayout({ bindGroupLayouts: [hzbReduceLayout] }),
      compute: { module: hzbReduceModule, entryPoint: 'main' },
    });

    const computePipelineLayout = device.createPipelineLayout({
      label: 'nanite-compute-pipeline-layout',
      bindGroupLayouts: [computeLayout, hzbCullLayout],
    });

    const cullPipeline = device.createComputePipeline({
      label: 'nanite-cull',
      layout: computePipelineLayout,
      compute: { module: cullModule, entryPoint: 'cull' },
    });

    const finalizePipeline = device.createComputePipeline({
      label: 'nanite-finalize',
      layout: computePipelineLayout,
      compute: { module: cullModule, entryPoint: 'finalize' },
    });

    // ---------- Render：vertex pulling + 双面光照 ----------
    const drawLayout = device.createBindGroupLayout({
      label: 'nanite-draw-layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer: { type: 'uniform' },
        },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
        { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
      ],
    });

    const drawPipelineLayout = device.createPipelineLayout({
      label: 'nanite-draw-pipeline-layout',
      bindGroupLayouts: [drawLayout],
    });

    const drawPipeline = device.createRenderPipeline({
      label: `nanite-draw-${preset.id}`,
      layout: drawPipelineLayout,
      vertex: { module: drawModule, entryPoint: 'vs_main' },
      fragment: { module: drawModule, entryPoint: 'fs_main', targets: [{ format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    // ---------- 缓冲 ----------
    const createStorage = (label: string, data: ArrayBufferView): GPUBuffer => {
      const buffer = device.createBuffer({
        label,
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      });
      // 这里的数组都来自 new Float32Array/Uint32Array，一定不是 SharedArrayBuffer
      device.queue.writeBuffer(buffer, 0, data as ArrayBufferView<ArrayBuffer>);
      return buffer;
    };

    const positions = createStorage('nanite-positions', payload.positions);
    const normals = createStorage('nanite-normals', payload.normals);
    const globalIndices = createStorage('nanite-indices', payload.indices);
    const clusterBounds = createStorage('nanite-cluster-bounds', payload.clusterBounds);
    const clusterRanges = createStorage('nanite-cluster-ranges', payload.clusterRanges);

    const visibleIndices = device.createBuffer({
      label: 'nanite-visible-indices',
      size: Math.max(4, payload.indices.byteLength),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE,
    });

    const counters = device.createBuffer({
      label: 'nanite-counters',
      size: 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });

    const argsBuffer = device.createBuffer({
      label: 'nanite-indirect-args',
      size: 20,
      usage: GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(argsBuffer, 0, new Uint32Array(5));

    const uniformBuffer = device.createBuffer({
      label: 'nanite-uniforms',
      size: UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const staging = device.createBuffer({
      label: 'nanite-stats-staging',
      size: 48,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    const supportsTimestamps = device.features.has('timestamp-query');
    const querySet = supportsTimestamps
      ? device.createQuerySet({ label: 'nanite-timestamps', type: 'timestamp', count: 2 })
      : null;
    const queryResolveBuffer = supportsTimestamps
      ? device.createBuffer({
          label: 'nanite-timestamps-resolve',
          size: 16,
          usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
        })
      : null;

    const computeBindGroup = device.createBindGroup({
      label: 'nanite-compute-bind-group',
      layout: computeLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: clusterBounds } },
        { binding: 2, resource: { buffer: clusterRanges } },
        { binding: 3, resource: { buffer: globalIndices } },
        { binding: 4, resource: { buffer: visibleIndices } },
        { binding: 5, resource: { buffer: counters } },
        { binding: 6, resource: { buffer: argsBuffer } },
      ],
    });

    const drawBindGroup = device.createBindGroup({
      label: 'nanite-draw-bind-group',
      layout: drawLayout,
      entries: [
        { binding: 0, resource: { buffer: uniformBuffer } },
        { binding: 1, resource: { buffer: positions } },
        { binding: 2, resource: { buffer: normals } },
      ],
    });

    return new NaniteRenderer(device, format, payload, preset, {
      cullPipeline,
      finalizePipeline,
      drawPipeline,
      drawPipelineLayout,
      computeBindGroup,
      drawBindGroup,
      uniformBuffer,
      visibleIndices,
      argsBuffer,
      counters,
      staging,
      querySet,
      queryResolveBuffer,
      hzbDepthLayout,
      hzbReduceLayout,
      hzbCullLayout,
      hzbDepthPipeline,
      hzbReducePipeline,
    });
  }

  /**
   * 切换配色预设。颜色常量编译在 WGSL 里，所以需要重新编译绘制着色器并重建管线。
   * 用 await 等编译完成后再更新 UI，避免按钮先变、画面后变的割裂感。
   */
  async setPalette(preset: PalettePreset): Promise<void> {
    if (preset.id === this.preset.id) {
      return;
    }

    const module = await createShaderModuleChecked(
      this.device,
      `clusterDraw.wgsl#${preset.id}`,
      `${preset.toWgsl()}\n${drawShader}`,
    );

    this.resources.drawPipeline = this.device.createRenderPipeline({
      label: `nanite-draw-${preset.id}`,
      layout: this.drawPipelineLayout,
      vertex: { module, entryPoint: 'vs_main' },
      fragment: { module, entryPoint: 'fs_main', targets: [{ format: this.format }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
    });

    this.preset = preset;
  }

  get paletteId(): string {
    return this.preset.id;
  }

  resize(width: number, height: number): void {
    const nextWidth = Math.max(1, Math.floor(width));
    const nextHeight = Math.max(1, Math.floor(height));
    if (nextWidth === this.width && nextHeight === this.height && this.depthTexture) {
      return;
    }

    this.width = nextWidth;
    this.height = nextHeight;
    this.depthTexture?.destroy();
    this.depthTexture = this.device.createTexture({
      label: 'nanite-depth',
      size: [this.width, this.height],
      format: DEPTH_FORMAT,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
    });

    this.rebuildHzb();
  }

  /** 依当前分辨率重建 HZB 纹理、各级拷贝绑定组与 cull 用的采样绑定组。 */
  private rebuildHzb(): void {
    const depthTexture = this.depthTexture;
    if (!depthTexture) {
      return;
    }

    const { device, resources } = this;

    const width = Math.max(1, Math.ceil(this.width / 2));
    const height = Math.max(1, Math.ceil(this.height / 2));
    const levels = Math.max(1, Math.floor(Math.log2(Math.max(width, height))) + 1);

    const texture = device.createTexture({
      label: 'nanite-hzb',
      size: [width, height],
      format: HZB_FORMAT,
      mipLevelCount: levels,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.STORAGE_BINDING,
    });

    const mipSizes: Array<[number, number]> = [];
    const storageViews: GPUTextureView[] = [];
    for (let level = 0; level < levels; level++) {
      mipSizes.push([
        Math.max(1, Math.ceil(width / 2 ** level)),
        Math.max(1, Math.ceil(height / 2 ** level)),
      ]);
      storageViews.push(
        texture.createView({ dimension: '2d', baseMipLevel: level, mipLevelCount: 1 }),
      );
    }

    const buildBindGroups: GPUBindGroup[] = [
      device.createBindGroup({
        label: 'nanite-hzb-from-depth',
        layout: resources.hzbDepthLayout,
        entries: [
          { binding: 0, resource: depthTexture.createView() },
          { binding: 1, resource: storageViews[0] },
        ],
      }),
    ];

    for (let level = 1; level < levels; level++) {
      buildBindGroups.push(
        device.createBindGroup({
          label: `nanite-hzb-reduce-${level}`,
          layout: resources.hzbReduceLayout,
          entries: [
            {
              binding: 0,
              resource: texture.createView({
                dimension: '2d',
                baseMipLevel: level - 1,
                mipLevelCount: 1,
              }),
            },
            { binding: 1, resource: storageViews[level] },
          ],
        }),
      );
    }

    this.hzb?.texture.destroy();
    this.hzb = { texture, maxMip: levels - 1, mipSizes, buildBindGroups };
    this.cullHzbBindGroup = device.createBindGroup({
      label: 'nanite-hzb-cull',
      layout: resources.hzbCullLayout,
      entries: [{ binding: 0, resource: texture.createView({ dimension: '2d' }) }],
    });
    // 新金字塔的内容要在本帧结束才写入，先关闭遮挡一帧
    this.hzbValid = false;
  }

  render(
    camera: OrbitCamera,
    mode: RenderMode,
    timeSeconds: number,
    target: GPUTextureView,
  ): void {
    const depthTexture = this.depthTexture;
    const cullHzbBindGroup = this.cullHzbBindGroup;
    if (!depthTexture || !cullHzbBindGroup) {
      return;
    }

    const { device, resources } = this;
    this.updateUniforms(camera, mode, timeSeconds);

    device.queue.writeBuffer(resources.uniformBuffer, 0, this.uniformData);
    device.queue.writeBuffer(resources.counters, 0, this.zeroCounters);

    const encoder = device.createCommandEncoder({ label: 'nanite-frame' });

    // 1) 剔除 + LOD 选择 + 索引压缩（同一 compute pass 内两次 dispatch，天然有序）
    const computePass = resources.querySet
      ? encoder.beginComputePass({
          label: 'nanite-cull-pass',
          timestampWrites: { querySet: resources.querySet, beginningOfPassWriteIndex: 0 },
        })
      : encoder.beginComputePass({ label: 'nanite-cull-pass' });
    computePass.setPipeline(resources.cullPipeline);
    computePass.setBindGroup(0, resources.computeBindGroup);
    computePass.setBindGroup(1, cullHzbBindGroup);
    computePass.dispatchWorkgroups(this.clusterCount);
    computePass.setPipeline(resources.finalizePipeline);
    computePass.dispatchWorkgroups(1);
    computePass.end();

    const sampleStats = !this.statsPending;
    if (sampleStats) {
      encoder.copyBufferToBuffer(resources.counters, 0, resources.staging, 0, 32);
    }

    // 2) 一次 drawIndexedIndirect 画完全部可见簇
    const pass = encoder.beginRenderPass({
      label: 'nanite-draw-pass',
      colorAttachments: [
        {
          view: target,
          clearValue: this.preset.clearColor(),
          loadOp: 'clear',
          storeOp: 'store',
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
      ...(resources.querySet && !this.hzb
        ? { timestampWrites: { querySet: resources.querySet, endOfPassWriteIndex: 1 } }
        : {}),
    });
    pass.setPipeline(resources.drawPipeline);
    pass.setBindGroup(0, resources.drawBindGroup);
    pass.setIndexBuffer(resources.visibleIndices, 'uint32');
    pass.drawIndexedIndirect(resources.argsBuffer, 0);
    pass.end();

    // 3) 用本帧深度重建 max-Z 金字塔，供下一帧遮挡剔除使用
    const hzb = this.hzb;
    if (hzb) {
      const hzbPass = resources.querySet
        ? encoder.beginComputePass({
            label: 'nanite-hzb-pass',
            timestampWrites: { querySet: resources.querySet, endOfPassWriteIndex: 1 },
          })
        : encoder.beginComputePass({ label: 'nanite-hzb-pass' });

      for (let level = 0; level < hzb.buildBindGroups.length; level++) {
        const size = hzb.mipSizes[level];
        hzbPass.setPipeline(
          level === 0 ? resources.hzbDepthPipeline : resources.hzbReducePipeline,
        );
        hzbPass.setBindGroup(0, hzb.buildBindGroups[level]);
        hzbPass.dispatchWorkgroups(
          Math.ceil(size[0] / HZB_WORKGROUP),
          Math.ceil(size[1] / HZB_WORKGROUP),
        );
      }
      hzbPass.end();
      this.hzbValid = true;
    }

    if (resources.querySet && resources.queryResolveBuffer) {
      encoder.resolveQuerySet(resources.querySet, 0, 2, resources.queryResolveBuffer, 0);
      if (sampleStats) {
        encoder.copyBufferToBuffer(resources.queryResolveBuffer, 0, resources.staging, 32, 16);
      }
    }

    device.queue.submit([encoder.finish()]);

    if (sampleStats) {
      this.readStats();
    }
  }

  private updateUniforms(camera: OrbitCamera, mode: RenderMode, timeSeconds: number): void {
    extractFrustumPlanes(camera.viewProj, this.frustumPlanes);

    this.uniformF32.set(camera.viewProj, 0);
    this.uniformF32.set(this.frustumPlanes, 16);

    this.uniformF32[40] = camera.position[0];
    this.uniformF32[41] = camera.position[1];
    this.uniformF32[42] = camera.position[2];
    this.uniformF32[43] = 0;

    this.uniformF32[44] = this.width;
    this.uniformF32[45] = this.height;
    this.uniformF32[46] = camera.tanHalfFov;
    this.uniformF32[47] = timeSeconds;

    this.uniformF32[48] = LOD_THRESHOLDS[0];
    this.uniformF32[49] = LOD_THRESHOLDS[1];
    this.uniformF32[50] = LOD_THRESHOLDS[2];
    this.uniformF32[51] = 0;

    this.uniformU32[SETTINGS_U32_OFFSET] = this.clusterCount;
    this.uniformU32[SETTINGS_U32_OFFSET + 1] = this.lodCount;
    this.uniformU32[SETTINGS_U32_OFFSET + 2] = mode === 'brute' ? 1 : 0;
    this.uniformU32[SETTINGS_U32_OFFSET + 3] = this.indexCapacity;

    this.uniformF32[OCCLUSION_F32_OFFSET] = this.hzb ? this.hzb.maxMip : 0;
    this.uniformF32[OCCLUSION_F32_OFFSET + 1] = OCCLUSION_DEPTH_BIAS;
    this.uniformF32[OCCLUSION_F32_OFFSET + 2] = this.hzbValid && mode === 'gpu' ? 1 : 0;
    this.uniformF32[OCCLUSION_F32_OFFSET + 3] = 0;

    // 高度渐变的驱动参数：物体半高 + palette 里的高度权重
    this.uniformF32[SHADING_F32_OFFSET] = BOUNDS_MAX[1];
    this.uniformF32[SHADING_F32_OFFSET + 1] = this.preset.heightWeight;
    this.uniformF32[SHADING_F32_OFFSET + 2] = this.gradientEnabled ? 1 : 0;
    this.uniformF32[SHADING_F32_OFFSET + 3] = 0;
  }

  /** 异步回读 GPU 计数（最多滞后一帧）。 */
  private readStats(): void {
    this.statsPending = true;
    const { staging } = this.resources;

    staging
      .mapAsync(GPUMapMode.READ)
      .then(() => {
        const range = staging.getMappedRange();
        const counters = new Uint32Array(range, 0, 8);
        this.stats.visibleTriangles = Math.floor(counters[0] / 3);
        this.stats.visibleClusters = counters[1];
        const lods = this.stats.visibleLods;
        lods[0] = counters[2];
        lods[1] = counters[3];
        lods[2] = counters[4];
        lods[3] = counters[5];
        this.stats.occludedClusters = counters[6];

        if (this.resources.querySet) {
          const times = new BigUint64Array(range, 32, 2);
          const deltaNs = Number(times[1] - times[0]);
          this.stats.gpuMs = deltaNs > 0 ? deltaNs / 1e6 : 0;
        }

        staging.unmap();
      })
      .catch((error: unknown) => {
        console.warn('[nanite] 统计回读失败', error);
      })
      .finally(() => {
        this.statsPending = false;
      });
  }
}
