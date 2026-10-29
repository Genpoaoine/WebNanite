# WebNanite

**A GPU-driven, Nanite-style renderer for a Mandelbulb fractal — built with WebGPU.**

The model (≈639k triangles at LOD0, split into 2,744 clusters across 4 LOD levels) is meshed in a Web Worker and rendered by compute-driven cluster culling — frustum + HZB occlusion + screen-space LOD — with a **single `drawIndexedIndirect`** call.

**[Live demo](https://genpoaoine.github.io/WebNanite/)** · Chrome / Edge 113+ · WebGPU required

---

## Features

- **Implicit surface → mesh** — the Mandelbulb kernel is ported from GLSL to TypeScript, sampled in a Web Worker and meshed with Surface Nets into four LOD levels (192³ / 112³ / 64³ / 40³).
- **Cluster-based geometry** — the mesh is split on a 14³ spatial grid (2,744 clusters); each cluster carries a bounding sphere and one index range per LOD.
- **GPU culling and LOD** — one workgroup per cluster runs the frustum test, an HZB occlusion test against a max-Z pyramid built from the previous frame, and screen-space LOD selection.
- **One indirect draw** — the compute pass compacts visible indices into a single buffer and writes the `drawIndexedIndirect` arguments; the render pass issues exactly one draw and pulls vertices from storage buffers.
- **Measured, not guessed** — `timestamp-query` reports per-frame GPU time next to FPS, submitted triangles, visible clusters and per-LOD cluster counts.
- **A/B comparison** — toggle between GPU-driven culling/LOD and a brute-force mode (all clusters at LOD0, no culling, 6× spin).
- **Presentation extras** — two color palettes defined in TypeScript, zh/en UI auto-detected from the browser, pinch-zoom and a collapsible HUD for mobile.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173/
npm run build      # typecheck + production build into dist/
npm run preview    # serve the production build
```

Requirements: Node ≥ 22.12, Chrome/Edge 113+, served over `localhost` or HTTPS (WebGPU needs a secure context).

## Controls

| Input | Action |
| --- | --- |
| Drag / one finger | Orbit the camera (auto-rotation resumes on release) |
| Wheel / two-finger pinch | Zoom |
| Space | Switch GPU culling + LOD ↔ brute force |
| G | Switch gradient ↔ flat shading |
| Palette button | Cycle Aurora ↔ Alpine Candy |
| “详细信息 / Detail” | Collapse / expand the HUD |
| ⏸ button (bottom right) | Pause / resume auto-rotation |
| GitHub icon | Open the repository |

## How it works

```
Mandelbulb kernel (CPU port of the GLSL asset)
  └─ Web Worker
       ├─ sample 4 resolutions → Surface Nets → indexed meshes
       └─ spatial clustering (14³) → global vertex/index buffers,
          per-cluster spheres, per-(cluster, LOD) index ranges
  └─ GPU, every frame
       ├─ compute: frustum + HZB occlusion + LOD select + index compaction
       ├─ compute: write drawIndexedIndirect arguments
       ├─ render: one drawIndexedIndirect, vertex pulling, double-sided shading
       └─ compute: current depth → max-Z pyramid (HZB) for the next frame
```

Implementation notes:

- **Index compaction** — thread 0 of each cluster workgroup reserves a contiguous output range with a single `atomicAdd`; the other 63 threads copy indices, so no per-triangle contention.
- **Absolute indices** — all LODs share one vertex/index buffer and indices are pre-offset, which lets a single draw mix LOD levels.
- **Vertex pulling** — positions and normals live in storage buffers (`vec4`-aligned); the vertex shader fetches them by `@builtin(vertex_index)`.
- **Zero runtime assets** — every WGSL module is imported through Vite's `?raw` and inlined at build time.
- **Stats** — counters and two timestamps are copied into one staging buffer and read with a single `mapAsync`.

## Performance

Measured on an Intel UHD iGPU (Edge 156, 1200×850, 144 Hz display):

| Scene | Triangles submitted | Visible clusters | LOD 0/1/2/3 | GPU time |
| --- | --- | --- | --- | --- |
| GPU culling + LOD, default view | 234,763 / 639,232 | 770 (77 occluded) | 83 / 618 / 69 / 0 | ≈2.3 ms |
| Brute force, everything at LOD0 | 639,232 | 913 | 913 / 0 / 0 / 0 | 5.8–8.2 ms |
| GPU culling + LOD, zoomed out | 45,789 | 693 (39 occluded) | 0 / 0 / 603 / 90 | ≈1.3 ms |

Startup meshing takes roughly 3–4 s inside the worker. When the window is fully occluded the browser throttles the worker (measured 3.5 s → 24 s), which is expected behaviour, not a renderer stall.

## Design notes and limitations

This is a concept demo, not a production Nanite implementation. Known simplifications:

- LODs are four independent resolutions rather than a merged cluster DAG with error-metric cuts, so LOD changes are per-cluster steps.
- Occlusion culling is single-pass (previous-frame HZB); Nanite's second pass that re-tests against current depth is omitted, so very fast camera moves can pop for a frame.
- Clusters are much larger than Nanite's (~900 vs ~128 triangles), which limits culling granularity. On this fractal the conservative HZB test removes only ~9 % of clusters, because the surface has many background pixels that defeat the max-depth test.
- Normals come from per-cell finite differences; some faceting is visible at maximum zoom.
- Surface Nets winding is not unified, so the pipeline uses `cullMode: 'none'` with two-sided lighting.
- Meshing runs on the CPU in a worker; there is no streaming, GPU-side LOD build or occlusion-driven page residency.

## Deployment

The site is published to GitHub Pages by GitHub Actions (`.github/workflows/deploy.yml`). Every push to `main` runs `npm ci && npm run build` and deploys `dist`.

`vite.config.ts` sets `base: './'`, and all assets (JS, CSS, worker) are referenced relatively, so the build works from any sub-path such as `/<repo>/`. `public/.nojekyll` is included so Pages skips Jekyll processing.

## Project layout

```
src/
├─ main.ts                 # bootstrap, HUD, input, frame loop
├─ ui/i18n.ts              # language detection + zh/en strings
├─ gpu/                    # device init, shader compile checks
├─ render/                 # camera, frustum, palettes, Nanite renderer
├─ scene/                  # CPU kernel, Surface Nets, clustering, worker
└─ shaders/                # cull / draw / HZB WGSL
```

## Credits

The Mandelbulb kernel is the GLSL snippet that started this project, ported to WGSL (`atan(y, x)` → `atan2(y, x)`) and to TypeScript for meshing. Built with [Vite](https://vite.dev), [gl-matrix](https://glmatrix.net) and [`@webgpu/types`](https://www.npmjs.com/package/@webgpu/types).

## License

No license has been chosen yet. All rights reserved by the author.

---

## 中文简介

WebGPU 版的 Nanite 风格概念演示：把 Mandelbulb 隐式曲面在 Web Worker 里网格化成 4 级 LOD（LOD0 约 63.9 万面、2744 个簇），再用 Compute Shader 做逐簇视锥剔除、HZB 遮挡剔除与屏幕空间 LOD 选择，最终用**一次 `drawIndexedIndirect`** 画完整个模型。HUD 实时显示 FPS、提交面数、可见簇、LOD 分布与 GPU 时间，并提供「暴力全开」对照模式。

在线体验：<https://genpoaoine.github.io/WebNanite/>
