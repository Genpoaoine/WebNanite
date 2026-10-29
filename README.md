# WebNanite

把一段 Mandelbulb 的 GLSL 内核做成浏览器里的 **WebGPU Nanite 风格概念演示**：GPU 驱动的 Cluster 视锥剔除 + 动态 LOD，最终用**一次 `drawIndexedIndirect`** 画完全部可见几何。

## 目前实现的内容

- **GLSL → WGSL**：`kernal` 内核（`atan(y,x)` → `atan2(y,x)`）作为资产保存在 `src/shaders/mandelbulb-kernel.wgsl`，CPU 侧同款移植在 `src/scene/kernel.ts`。
- **Web Worker 网格化**：对隐式曲面采样 → Naive Surface Nets → **4 级 LOD**（192³ / 112³ / 64³ / 40³）→ 按 14³ 空间划分切成 **2,744 个簇**。
- **Compute 剔除 + LOD**：每个簇一个 workgroup，视锥剔除、按屏幕投影半径选 LOD、把该簇索引压缩写入可见索引缓冲，并累加计数。
- **HZB 遮挡剔除**：每帧把 `depth32float` 归约成 max-Z 金字塔（半分辨率起、2×2 逐级归约），下一帧用“簇投影矩形 × 金字塔最大深度”整簇剔除；暴力模式跳过。
- **单次间接绘制**：第二个 compute 入口写 `drawIndexedIndirect` 参数，渲染端用 vertex pulling + 双面光照一次画完。
- **实时统计**：FPS / 帧时 / 提交三角面 / 可见簇 / **每级 LOD 簇数分布** / **被遮挡剔除的簇数** / **GPU 时间（timestamp-query）**。
- **对比模式**：「GPU 剔除 + LOD」↔「暴力全开（不做剔除、全部 LOD0、6× 转速）」。
- **可切换配色**：两套预设（极光 / 阿尔卑斯糖果）定义在 TS 里、编译进 WGSL，HUD 按钮切换（会重建绘制管线）；`G` 键切换「渐变 / 单色」。

实测数据（Edge 156 / Intel UHD Graphics / 1200×850）：

| 场景 | 提交三角面 | 可见簇（含遮挡剔除数） | LOD 分布 0/1/2/3 | GPU 时间 |
| --- | --- | --- | --- | --- |
| GPU 模式 · 默认视角 | 234,763 / 639,232 | 770（遮挡剔除 77） | 83 / 618 / 69 / 0 | ~2.3 ms |
| 暴力全开 | 639,232 / 639,232 | 913（0） | 913 / 0 / 0 / 0 | 5.8–8.2 ms |
| GPU 模式 · 拉远 | 45,789 / 639,232 | 693（遮挡剔除 39） | 0 / 0 / 603 / 90 | ~1.3 ms |
| GPU 模式 · 拉近 | ~529,000 / 639,232 | ~700 | 590 / 104 / 14 / 0 | 8–10.6 ms |

> 显示器 144 Hz 且 vsync 生效时，两种模式的 FPS 都可能贴着刷新率，**要看 GPU 时间而不是 FPS**。窗口被完全遮挡时浏览器会节流，网格化耗时会翻几倍（实测 3.5 s → 24 s），这属正常现象。

## 快速开始

```bash
npm install
npm run dev        # http://localhost:5173/
npm run typecheck  # 仅类型检查
npm run build      # 类型检查 + 生产构建（Worker 单独打包）
npm run preview
```

环境：Node ≥ 22.12、Chrome/Edge 113+、`localhost` 或 https 访问。

## 交互

- **拖拽 / 单指拖动**：旋转相机（松手后恢复缓慢自转）
- **滚轮 / 双指捏合**：缩放（拉近 → LOD0，拉远 → LOD2/LOD3，提交面数实时下降）
- **空格 / 点击按钮**：切换「GPU 剔除 + LOD」与「暴力全开」
- **G / 点击渐变按钮**：切换「渐变：开」与「渐变：关（单色）」
- **点击配色按钮**：切换配色预设「极光（绿→蓝→紫）」↔「阿尔卑斯糖果（陡峭度 → 白/紫/橙红）」
- **面板右上角「详细信息 ▾ / ▸」**：收起 / 展开面板（小屏会自动收起，只保留两个标题和这个按钮）
- **右下角 ⏸ / ▶**：暂停 / 恢复模型自转（暂停时拖拽旋转仍然可用）
- **右下角 GitHub 图标**：新标签打开仓库（地址在 `index.html` 的 `#hud-github` 的 `href`，**请替换成你自己的仓库**）
- **面板滚动**：HUD 高度跟随视口（`max-height: 100dvh - 32px`），内容超出时在面板内部滚动，底部的「网格 / 设备信息」始终可达

## 移动端适配

- **双指捏合缩放**：`OrbitCamera` 用 Pointer Events 跟踪多指（`Map<pointerId, {x,y}>`），
  两指距离变化直接映射为相机距离 `distance *= prev / next`（夹在 1.45–12 之间），双指期间暂停旋转；
  放开一根手指后会用剩下那根继续旋转，不会跳视角。滚轮逻辑保持不变。
- **自动收起面板**：`matchMedia('(max-width: 720px), (max-height: 520px)')` 命中时自动给 `#hud` 加 `.collapsed`，
  只留下「WebNanite」+「Mandelbulb · GPU-driven Cluster Culling / LOD」两个标题和右上角的展开按钮（▸）；媒体查询变化时会自动跟随。
  手动点击按钮可以随时覆盖；`aria-expanded` / `aria-label` 同步更新。
- **触屏滚动/缩放不被浏览器抢走**：canvas 上 `touch-action: none`；面板内部滚动用 `overscroll-behavior: contain`。
- **右下角快捷操作**（暂停自转 / GitHub）放在 `#app` 里、与 `#hud` 平级，**不受面板收起影响**；
  移动端尺寸从 38px 放大到 44px，位置贴边 10px，方便点按。

## 数据流

```
kernal (CPU 移植)
   └─ Web Worker: 4 级分辨率采样 → Surface Nets → 索引网格
        └─ 空间分簇(14³) → 全局顶点/索引缓冲 + 每簇包围球 + 每(簇,LOD)索引区间
             └─ GPU: compute(视锥 + HZB 遮挡 + LOD + 索引压缩) → compute(写 indirect 参数)
                  └─ renderPass: 一次 drawIndexedIndirect（vertex pulling 着色）
                       └─ compute: 本帧深度 → max-Z 金字塔（供下一帧遮挡剔除）
                            └─ 回读 counters + timestamp → HUD
```

## 关键实现点

- **索引即提交单元**：compute 把可见簇该 LOD 的索引**连续压缩**进 `visibleIndices`（先按簇原子预留区间，再全组并行拷贝），渲染时把它直接当 index buffer 用。
- **绝对顶点索引**：所有 LOD 的顶点/索引拼进同一组 buffer，索引里已经加好 LOD 的顶点基址，因此一次绘制可以混用不同 LOD。
- **每簇一个 workgroup**：`thread 0` 做剔除/选 LOD/一次 `atomicAdd` 预留，`workgroupBarrier` 后 64 个线程并行搬运索引 —— 避免逐三角形竞争同一个计数器。
- **vertex pulling**：顶点位置/法线放在 storage buffer（`vec4` 对齐），顶点着色器用 `@builtin(vertex_index)` 拉取。
- **统计回读**：counters（8 个 u32，含每级 LOD 与遮挡剔除计数）与两个 timestamp 拷进同一块 staging，一次 `mapAsync` 拿全，映射期间跳过采样避免冲突。

## 可调参数

| 位置 | 参数 | 说明 |
| --- | --- | --- |
| `src/scene/meshTypes.ts` | `LOD_RESOLUTIONS` | 4 级 LOD 的采样分辨率 |
| `src/scene/meshTypes.ts` | `CLUSTER_GRID_DIM` | 空间划分粒度（簇数 = dim³） |
| `src/scene/meshTypes.ts` | `BOUNDS_MIN/MAX` | 分形包围盒（当前 ±1.15） |
| `src/render/naniteRenderer.ts` | `LOD_THRESHOLDS` | 簇屏幕半径的 LOD 阈值（像素） |
| `src/render/camera.ts` | `MIN/MAX_DISTANCE` | 缩放范围 |
| `src/render/*.ts` | `PalettePreset` | **唯一的配色入口**：两套预设（极光 / 阿尔卑斯糖果），每个预设自带渐变函数、单色、边缘光与清屏色 |

## 部署到 GitHub Pages

`vite.config.ts` 里的 `base` 已设为 `'./'`，构建产物是**相对路径**，可以直接放在项目子路径 `https://<user>.github.io/<repo>/` 下：

```bash
npm run build
# 发布 dist/ 的内容（二选一）
# 1) 推到 gh-pages 分支（gh-pages 工具 / actions-gh-pages）
# 2) 把 dist/ 内容复制到仓库根目录，由 Pages 从 main 分支发布
```

路径审计结果：

- `dist/index.html` 引用 `./assets/index-xxx.js` 与 `./assets/index-xxx.css`，不依赖站点根路径；
- Worker 通过 `new URL('./meshWorker-xxx.js', import.meta.url)` 解析，相对于当前页面所在目录；
- 所有 WGSL 都用 `?raw` 在**构建时内联**成字符串，运行时不请求任何 shader 文件；
- 页面无外部 CDN 依赖，唯一外链是右下角 GitHub 按钮；favicon 是内联 `data:` SVG，不会再产生 `/favicon.ico` 404；
- `public/.nojekyll` 会被复制到 `dist/`，避免 Pages 走 Jekyll 处理。

已在 `/WebNanite/` 子路径下用静态服务器实测：页面、CSS、JS、Worker 全部 200，无 404、无加载失败、无控制台异常。

## 界面语言

打开页面时按浏览器语言自动选择 UI 文案：`navigator.languages` 里只要有一条以 `zh` 开头就用**中文**，其余一律**英文**（不需要手动切换）。

- 字典在 `src/ui/i18n.ts`（`ZH` / `EN` 两份 `UiStrings`）；
- 静态文案：HTML 上写 `data-i18n="key"`（属性用 `data-i18n-aria` / `data-i18n-title`），`applyI18n()` 在启动时统一填充，并同步 `<html lang>` 与 `document.title`；
- 动态文案（状态、按钮、mesh 信息、错误前缀）直接读 `t.xxx`；预设名按 id 从字典取（`presetLabel()`），取不到才回退到预设自带的 `label`；
- 底层错误文案也在字典里：`device.ts` 的 `webgpuMissing / adapterMissing / contextMissing`、`shader.ts` 的 `wgslCompileFailed(count, label)`，
  所以「浏览器不支持 WebGPU」「拿不到适配器」「WGSL 编译失败」这些提示同样跟随界面语言；
- 想加第三种语言：复制一份 `UiStrings` 字典、扩展 `Lang` 与 `DICTIONARIES`，再让 `detectLang()` 返回对应语言即可。

## 颜色配置与配色预设

颜色全部集中在 `src/render/` 下的两个 TS 文件里，**不需要碰任何 `.wgsl`**。

| 文件 | 预设 | 驱动量 | 色带 |
| --- | --- | --- | --- |
| `src/render/palette.ts` | `AURORA_PRESET`「极光」（备选） | `heightWeight = 0.8`（80% 竖向高度 + 20% 斜率） | 绿 → 绿蓝 → 蓝 → 紫（四档 + `saturation`） |
| `src/render/paletteRainbow.ts` | `NEON_PRESET`「阿尔卑斯糖果」**（打开页面默认）** | 只看**表面陡峭度**（法线相对径向的偏离） | 浅蓝白 `#c0dbff` → 紫 `#523ea2` → 橙红 `#fa6341` |

要点：

- 颜色用 **sRGB hex** 书写，注入 WGSL 前自动转线性空间；着色器末尾统一 tonemap + gamma。
  ⚠️ 只支持 hex：写成 `rgba(255,255,255,0.9)` 会被 `parseInt(..., 16)` 解析成 `NaN`，位运算后变纯黑（这正是之前"模型全黑、只剩边缘发光"的原因）。
- 注入的渐变函数签名是 `paletteGradient(t, worldPosition, normal)`：
  `t` 是着色器算好的渐变参数 `mix(slope, height, heightWeight)`；世界坐标与法线交给预设自由使用（极光只用 `t`，阿尔卑斯糖果只用 `normal`）。
- **阿尔卑斯糖果的陡峭度**：`1 - |dot(normal, radial)|`，`radial` 是"物体中心 → 着色点"的方向。
  宽而平滑的沟谷接近 0（浅蓝白，最平淡），花簇/尖刺接近 1（橙红，最艳）；`pow(steepness, 0.95)` 展宽分布，两个 `smoothstep` 负责过渡。
- 关闭渐变（HUD 渐变按钮 / `G` 键）后走 `flatColor` 单色 × 斜率明暗。当前 `flatColor = '#000000'`、`rimStrength = 0.8`，
  观感是"黑底 + 轮廓发光"的水晶效果。
- 清屏色由预设的 `clearColor()` 提供（阿尔卑斯糖果是纯黑）。
- 颜色常量**编译进 WGSL**：切换预设会重新编译绘制着色器并重建管线（`NaniteRenderer.setPalette()`，异步、约几十毫秒），按钮在编译期间禁用。
- 新增配色：复制一个文件实现 `PalettePreset`（`id / label / heightWeight / toWgsl() / clearColor()`），再加进 `main.ts` 的切换列表即可。

## 目录结构

```
src/
├─ main.ts                 # 启动、HUD、交互、主循环
├─ style.css
├─ gpu/
│  ├─ device.ts            # adapter/device/context、timestamp-query、设备信息
│  └─ shader.ts            # WGSL 编译 + 行号报错
├─ render/
│  ├─ camera.ts            # 轨道相机
│  ├─ frustum.ts           # 从 viewProj 提取 6 个视锥平面
│  ├─ palette.ts           # 配色预设：极光 + PalettePreset 接口 / hex→线性工具
│  ├─ paletteRainbow.ts    # 配色预设：阿尔卑斯糖果（陡峭度 → 白/紫/橙红）
│  └─ naniteRenderer.ts    # GPU 资源、compute 管线、indirect 绘制、统计回读
├─ ui/
│  └─ i18n.ts              # 语言检测 + 中英文字典 + applyI18n()
├─ scene/
│  ├─ kernel.ts            # GLSL kernal 的 CPU 移植
│  ├─ surfaceNets.ts       # 采样 + Surface Nets（法线用格子差分）
│  ├─ clusterize.ts        # 空间分簇 + LOD 区间 + 包围球
│  ├─ buildMesh.ts         # Worker 内的完整流水线
│  ├─ meshWorker.ts        # Worker 入口
│  ├─ meshClient.ts        # 主线程侧 Worker 封装（Transferable）
│  ├─ meshProtocol.ts      # 消息类型
│  └─ meshTypes.ts         # 共享数据类型与分辨率/分簇参数
└─ shaders/
   ├─ cull.wgsl            # 视锥 + HZB 遮挡 + LOD 选择 + 索引压缩 + indirect 参数
   ├─ clusterDraw.wgsl     # vertex pulling + 双面光照
   ├─ hzbDepth.wgsl        # depth32float → 半分辨率 max-Z（mip0）
   ├─ hzbReduce.wgsl       # 2×2 归约生成其余 mip
   └─ mandelbulb-kernel.wgsl  # 题面给的 WGSL 内核（资产，未直接引用）
```

## HZB 遮挡剔除

流程（每帧一个 encoder）：

1. 渲染用 `depth32float` 深度附件（`RENDER_ATTACHMENT | TEXTURE_BINDING`）。
2. 渲染结束后，compute 把深度按 2×2 取 **max** 归约成半分辨率 mip0，再逐级 2×2 归约到 1×1（`r32float` 金字塔）。
3. 下一帧的剔除 compute 里，对每个簇：
   - 包围球 → 屏幕矩形（NDC → 像素，y 轴翻转对齐纹理行序）；
   - 按矩形大小选 mip（保证一个纹素 ≥ 矩形），取覆盖瓦片的最大深度；
   - `簇最近深度 > 遮挡深度 + bias` → 整簇剔除；
   - 近平面、离屏、矩形过小、锥退化等情况一律**保守放行**。

几个取舍（都是为这个资产实测调的）：

- 测试矩形用**投影半径的 60%**：分形的表面有大量背景穿透（深度=远平面 1.0），用 100% 矩形时 max 几乎总是 1.0，剔除率只有 ~1%；60% 时约为 9% 的簇、4% 的三角面，且看不出破洞。再激进（只测中心像素）能剔 45%，但会在轮廓处露出明显破洞。
- **单趟 HZB**（用上一帧深度）：省掉 Nanite 的第二趟复核，代价是相机快速运动时理论上可能有一帧的错剔；bias `0.0002` 缓解。
- HZB 的内存/带宽开销很小（半分辨率 + 10 级 mip），构建包含在 GPU 时间戳里。

结论：这套机制在**实体遮挡**场景（岩石、建筑、多层物体）能剔掉成片的背面簇；对这个“表面布满细小穿透的分形”，受限于保守判定只能省一部分 —— 与之前的分析一致。

## 已知限制（有意保留的“极简”）

- **遮挡剔除是单趟 HZB**：没有第二趟用当前帧深度复核，快速推拉镜头时可能出现瞬时错剔。
- **LOD 是 4 个独立分辨率**，不是 Nanite 的簇 DAG 合并；切换是按簇离散跳变，未做边界缝合。
- **法线来自格子差分**：近距离拉满时会看到轻微面片感；换回逐顶点解析梯度只需改 `surfaceNets.ts`。
- **绕序不统一**：Surface Nets 输出未统一环绕方向，因此 `cullMode: 'none'` + 双面光照。
- **CPU 预生成**：首次加载约 3.5 s（Worker 内），未做分块流式上传或 GPU 端建网格。
- **单 draw 依赖索引压缩**：没有使用（也不依赖）multi-draw 扩展。
- **GPU 时间需要 `timestamp-query`**：不支持时 HUD 显示「不可用」，其余功能不受影响。

## 为什么默认可能跑在核显上

Chromium 在 Windows 上按系统级 GPU 偏好挑选适配器，`powerPreference: 'high-performance'` 只是提示。
HUD 的「网格 / 设备信息」里能看到实际适配器；若显示核显，可任选：

1. Windows 设置 → 系统 → 显示 → 图形 → 添加 `msedge.exe` / `chrome.exe` → **高性能** → 重启浏览器。
2. NVIDIA 控制面板 → 管理 3D 设置 → 程序设置 → 添加浏览器 → 高性能 NVIDIA 处理器。
3. 用 `msedge.exe --force_high_performance_gpu` 启动（实测可切到 `nvidia · lovelace`）。

## 排错

- **HUD 显示 `navigator.gpu 不存在`**：确认浏览器版本与访问地址（需 `localhost`/https）。
- **`requestAdapter() 返回 null`**：显卡/驱动被禁用或运行在远程桌面、虚拟机里，先看 `chrome://gpu`。
- **WGSL 编译失败**：HUD 与控制台会给出 `文件 行:列`，可直接定位。
- **加载很久**：窗口被遮挡/最小化时浏览器会节流 Worker（实测 3.5 s → 24 s），保持窗口可见即可。
- **无头截图里 FPS 是 0 或 “—”**：无头模式或窗口不可见时 rAF 不跑，属正常。
