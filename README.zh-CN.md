# WebNanite

[English](README.md) | **简体中文**

**用 WebGPU 实现的 GPU 驱动、Nanite 风格 Mandelbulb 分形渲染器。**

模型在 LOD0 约 63.9 万三角面，按 14³ 空间网格切成 2744 个簇、共 4 级 LOD；网格在 Web Worker 内生成，渲染时由 Compute Shader 做逐簇视锥剔除、HZB 遮挡剔除与屏幕空间 LOD 选择，最终用**一次 `drawIndexedIndirect`** 画完。

**[在线演示](https://genpoaoine.github.io/WebNanite/)** · Chrome / Edge 113+ · 需要 WebGPU

---

## 功能特性

- **隐式曲面 → 网格**：Mandelbulb 内核由 GLSL 移植为 TypeScript，在 Web Worker 里采样并用 Surface Nets 生成四级 LOD（192³ / 112³ / 64³ / 40³）。
- **基于簇的几何组织**：按 14³ 空间网格切成 2744 个簇，每簇带包围球与每级 LOD 的索引区间。
- **GPU 剔除与 LOD**：每簇一个 workgroup，执行视锥测试、对上一帧生成的 max-Z 金字塔做 HZB 遮挡测试，并按屏幕投影尺寸选择 LOD。
- **一次间接绘制**：compute 把可见索引压缩进单一缓冲并写入 `drawIndexedIndirect` 参数；渲染阶段只发一次 draw，顶点通过 storage buffer 拉取。
- **可测量**：`timestamp-query` 输出每帧 GPU 时间，同时显示 FPS、提交面数、可见簇数与 LOD 分布。
- **对照模式**：在「GPU 剔除 + LOD」与「暴力全开（全部簇 LOD0、不剔除、6 倍转速）」之间一键切换。
- **演示层细节**：两套由 TS 定义的可切换配色、按浏览器语言自动切换的中/英文界面、移动端双指缩放与可收起面板。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173/
npm run build      # 类型检查 + 生产构建（输出 dist/）
npm run preview    # 预览生产构建
```

环境要求：Node ≥ 22.12；Chrome / Edge 113+；通过 `localhost` 或 HTTPS 访问（WebGPU 需要安全上下文）。

## 操作

| 输入 | 行为 |
| --- | --- |
| 拖拽 / 单指拖动 | 旋转视角（松手后恢复自转） |
| 滚轮 / 双指捏合 | 缩放 |
| 空格 | 切换「GPU 剔除 + LOD」与「暴力全开」 |
| G | 切换渐变 / 单色着色 |
| 配色按钮 | 在「极光」与「阿尔卑斯糖果」之间切换 |
| 「详细信息 / Detail」 | 收起 / 展开面板 |
| ⏸（右下角） | 暂停 / 恢复自转 |
| GitHub 图标 | 打开仓库 |

## 实现方式

```
Mandelbulb 内核（GLSL 资产 → CPU 移植）
  └─ Web Worker
       ├─ 4 级分辨率采样 → Surface Nets → 索引网格
       └─ 空间分簇（14³）→ 全局顶点/索引缓冲、每簇包围球、
          每（簇, LOD）索引区间
  └─ GPU，每帧
       ├─ compute：视锥 + HZB 遮挡 + LOD 选择 + 索引压缩
       ├─ compute：写入 drawIndexedIndirect 参数
       ├─ render：一次 drawIndexedIndirect，vertex pulling，双面光照
       └─ compute：本帧深度 → max-Z 金字塔（供下一帧遮挡剔除）
```

要点：

- **索引压缩**：每个簇的 workgroup 由线程 0 用一次 `atomicAdd` 预留连续区间，其余 63 个线程并行拷贝，避免逐三角形竞争计数器。
- **绝对索引**：所有 LOD 共用一组顶点/索引缓冲，索引已预加基址，因此一次绘制可以混用不同 LOD。
- **vertex pulling**：位置与法线放在 storage buffer（`vec4` 对齐），顶点着色器用 `@builtin(vertex_index)` 拉取。
- **零运行时资源**：所有 WGSL 通过 Vite 的 `?raw` 在构建时内联为字符串。
- **统计回读**：counters 与两个 timestamp 拷进同一块 staging，用一次 `mapAsync` 读取。

## 性能

在 Intel UHD 核显上实测（Edge 156，1200×850，144 Hz）：

| 场景 | 提交三角面 | 可见簇 | LOD 0/1/2/3 | GPU 时间 |
| --- | --- | --- | --- | --- |
| GPU 剔除 + LOD（默认视角） | 234,763 / 639,232 | 770（其中遮挡剔除 77） | 83 / 618 / 69 / 0 | ≈2.3 ms |
| 暴力全开（全部 LOD0） | 639,232 | 913 | 913 / 0 / 0 / 0 | 5.8–8.2 ms |
| GPU 剔除 + LOD（拉远） | 45,789 | 693（其中遮挡剔除 39） | 0 / 0 / 603 / 90 | ≈1.3 ms |

首屏网格化耗时约 3–4 秒。窗口被完全遮挡时浏览器会节流 Worker（实测 3.5 s → 24 s），属正常现象，不是渲染卡住。

## 设计与限制

这是一个概念演示，不是生产级 Nanite 实现。已知简化：

- LOD 是四级独立分辨率，而不是带误差度量切面的簇 DAG，因此 LOD 切换是按簇跳变。
- 遮挡剔除是单趟（使用上一帧的 HZB）；省略了 Nanite 用当前帧深度复核的第二趟，极快的镜头移动可能出现一帧 pop。
- 簇比 Nanite（约 128 面）大得多（约 900 面），限制了剔除粒度；在这个分形上保守的 HZB 测试只剔掉约 9% 的簇，因为表面存在大量背景像素使最大深度测试失效。
- 法线来自逐格有限差分，极限放大时能看到轻微面片感。
- Surface Nets 的绕序未统一，因此管线使用 `cullMode: 'none'` + 双面光照。
- 网格化在 Worker 里用 CPU 完成；没有流式加载、GPU 端 LOD 构建，也没有按遮挡加载的页驻留。

## 部署

通过 GitHub Actions（`.github/workflows/deploy.yml`）发布到 GitHub Pages：每次 push 到 `main` 都会执行 `npm ci && npm run build` 并部署 `dist`。

`vite.config.ts` 设置了 `base: './'`，所有资源（JS、CSS、Worker）都是相对引用，因此可以部署在任意子路径（如 `/<repo>/`）下。`public/.nojekyll` 用于让 Pages 跳过 Jekyll 处理。

## 目录结构

```
src/
├─ main.ts                 # 启动、HUD、交互、主循环
├─ ui/i18n.ts              # 语言检测 + 中英文文案
├─ gpu/                    # 设备初始化、着色器编译检查
├─ render/                 # 相机、视锥、配色、Nanite 渲染器
├─ scene/                  # CPU 内核、Surface Nets、分簇、Worker
└─ shaders/                # 剔除 / 绘制 / HZB WGSL
```

## 致谢

Mandelbulb 内核是项目起点的那段 GLSL，之后移植为 WGSL（`atan(y, x)` → `atan2(y, x)`）并移植为 TypeScript 用于网格化。使用 [Vite](https://vite.dev)、[gl-matrix](https://glmatrix.net) 与 [`@webgpu/types`](https://www.npmjs.com/package/@webgpu/types) 构建。

## 许可

[MIT](LICENSE) © 2026 Genpoaoine
