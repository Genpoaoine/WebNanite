/**
 * 颜色配置：整个演示唯一需要改颜色的地方。
 *
 * 颜色用 sRGB hex 书写，注入 WGSL 前会自动转到线性空间，
 * 着色器最后统一做 tonemap + gamma，因此这里只需要挑"看起来对"的色值。
 *
 * 想换风格：改下面的 PALETTE 即可，不需要碰任何 .wgsl。
 */
export interface Palette {
  /** 页面/清屏背景色（按 sRGB 值直接写入 bgra8unorm 目标）。 */
  readonly background: string;
  /** 斜率最低（背光、陡坡背面）的颜色：绿。 */
  readonly shadow: string;
  /** 中间调：绿 → 蓝过渡。 */
  readonly mid: string;
  /** 斜率较高（迎光面）的颜色：蓝。 */
  readonly highlight: string;
  /** 斜率最高处的强调色：紫。 */
  readonly accent: string;
  /** 关闭渐变时使用的单色（配合斜率做明暗）。 */
  readonly flatColor: string;
  /** 边缘光颜色。 */
  readonly rim: string;
  /** 边缘光强度（0 = 关闭）。 */
  readonly rimStrength: number;
  /** 渐变整体饱和度倍率（1 = 原始，>1 更鲜艳）。 */
  readonly saturation: number;
  /** 渐变驱动权重的“高度”占比：0 = 纯斜率（细节碎），1 = 纯高度（大范围平滑）。 */
  readonly heightWeight: number;
}

export const PALETTE: Palette = {
  background: '#06060f',
  shadow: '#0d3327',
  mid: '#1d9e63',
  highlight: '#2f6fe0',
  accent: '#8a3ff0',
  flatColor: '#000000',
  rim: '#8f8cff',
  rimStrength: 0.8,
  saturation: 1.18,
  heightWeight: 0.8,
};

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace('#', '');
  const value = Number.parseInt(normalized, 16);
  return [
    ((value >> 16) & 0xff) / 255,
    ((value >> 8) & 0xff) / 255,
    (value & 0xff) / 255,
  ];
}

/** sRGB → 线性光。 */
function srgbToLinear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function vec3(hex: string): string {
  const [r, g, b] = hexToRgb(hex).map(srgbToLinear);
  return `vec3<f32>(${r.toFixed(6)}, ${g.toFixed(6)}, ${b.toFixed(6)})`;
}

/** 把 sRGB hex 转成线性空间的 WGSL `vec3<f32>` 字面量（供各配色文件复用）。 */
export function wgslColor(hex: string): string {
  return vec3(hex);
}

/** 生成注入到 clusterDraw.wgsl 前面的常量与渐变函数。 */
export function paletteToWgsl(palette: Palette = PALETTE): string {
  return `// 由 src/render/palette.ts 自动生成，请勿手改
const PALETTE_SHADOW: vec3<f32> = ${vec3(palette.shadow)};
const PALETTE_MID: vec3<f32> = ${vec3(palette.mid)};
const PALETTE_HIGHLIGHT: vec3<f32> = ${vec3(palette.highlight)};
const PALETTE_ACCENT: vec3<f32> = ${vec3(palette.accent)};
const PALETTE_FLAT: vec3<f32> = ${vec3(palette.flatColor)};
const PALETTE_RIM: vec3<f32> = ${vec3(palette.rim)};
const PALETTE_RIM_STRENGTH: f32 = ${palette.rimStrength.toFixed(4)};
const PALETTE_SATURATION: f32 = ${palette.saturation.toFixed(4)};

fn paletteSaturate(color: vec3<f32>, amount: f32) -> vec3<f32> {
  let luma = dot(color, vec3<f32>(0.2126, 0.7152, 0.0722));
  return mix(vec3<f32>(luma), color, amount);
}

// t: 0 = 背光/陡坡背面，1 = 正对光源。三段 smoothstep 形成柔和的多色过渡。
fn paletteGradient(t: f32, worldPosition: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  let t0 = smoothstep(0.0, 0.45, t);
  let t1 = smoothstep(0.35, 0.78, t);
  let t2 = smoothstep(0.82, 1.0, t);

  var color = mix(PALETTE_SHADOW, PALETTE_MID, t0);
  color = mix(color, PALETTE_HIGHLIGHT, t1);
  color = mix(color, PALETTE_ACCENT, t2);
  return paletteSaturate(color, PALETTE_SATURATION);
}
`;
}

/** 清屏色（bgra8unorm 目标按 sRGB 值直接写入）。 */
export function backgroundClearColor(palette: Palette = PALETTE): {
  r: number;
  g: number;
  b: number;
  a: number;
} {
  const [r, g, b] = hexToRgb(palette.background);
  return { r, g, b, a: 1 };
}

/**
 * 一套可切换的配色预设。
 * 颜色常量是编译进 WGSL 的，因此切换预设需要重建绘制管线（由渲染器负责）。
 */
export interface PalettePreset {
  readonly id: string;
  readonly label: string;
  /** 渐变驱动量里“高度”的占比（0 = 纯斜率，1 = 纯高度）。 */
  readonly heightWeight: number;
  /** 注入到 clusterDraw.wgsl 前面的 WGSL 片段。 */
  readonly toWgsl: () => string;
  readonly clearColor: () => { r: number; g: number; b: number; a: number };
}

/** 备用配色：绿 → 蓝 → 紫 的竖向渐变（打开页面默认是 paletteRainbow 的「阿尔卑斯糖果」）。 */
export const AURORA_PRESET: PalettePreset = {
  id: 'aurora',
  label: '极光（绿→蓝→紫）',
  heightWeight: PALETTE.heightWeight,
  toWgsl: () => paletteToWgsl(PALETTE),
  clearColor: () => backgroundClearColor(PALETTE),
};
