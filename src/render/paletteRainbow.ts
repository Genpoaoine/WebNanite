import { wgslColor, type PalettePreset } from './palette';

/**
 * 「阿尔卑斯糖果」：只由表面陡峭度决定颜色。
 *
 * 陡峭度定义：局部法线相对"径向包络"（从物体中心指向该点的方向）的偏离程度。
 * - 宽而平滑的沟谷：法线基本朝外，接近径向 → 陡峭度低 → 浅蓝白（最平淡）
 * - 花簇/尖刺：法线方向杂乱，偏离径向 → 陡峭度高 → 紫 → 橙红（最艳）
 *
 * 与 palette.ts 解耦，只暴露一个 preset；切换时渲染器会用它重建绘制管线。
 */
const NEON_WGSL = `// 由 src/render/paletteRainbow.ts 自动生成，请勿手改
const PALETTE_FLAT: vec3<f32> = vec3<f32>(0.85, 0.90, 1.0);
const PALETTE_RIM: vec3<f32> = vec3<f32>(1.0, 1.0, 1.0);
const PALETTE_RIM_STRENGTH: f32 = 0.12;
const PALETTE_SATURATION: f32 = 1.0;

const STEEP_WHITE: vec3<f32> = ${wgslColor('#c0dbff')};
const STEEP_PURPLE: vec3<f32> = ${wgslColor('#523ea2')};
const STEEP_RED: vec3<f32> = ${wgslColor('#fa6341')};

fn paletteGradient(t: f32, worldPosition: vec3<f32>, normal: vec3<f32>) -> vec3<f32> {
  // 径向包络：从物体中心指向当前着色点
  let radial = normalize(worldPosition + vec3<f32>(0.0, 1e-4, 0.0));

  // 1 = 法线与径向垂直（陡峭/杂乱），0 = 法线与径向一致（平滑）
  let steepness = clamp(1.0 - abs(dot(normalize(normal), radial)), 0.0, 1.0);
  let s = pow(steepness, 0.95);

  // 色带：浅蓝白 → 紫 → 橙红
  let m0 = smoothstep(0.05, 0.50, s);
  let m1 = smoothstep(0.45, 0.90, s);

  var color = mix(STEEP_WHITE, STEEP_PURPLE, m0);
  color = mix(color, STEEP_RED, m1);
  return color;
}
`;

export const NEON_PRESET: PalettePreset = {
  id: 'neon',
  label: '阿尔卑斯糖果',
  // 这套配色只看法线斜率，不参与"高度/斜率"混合
  heightWeight: 0.0,
  toWgsl: () => NEON_WGSL,
  clearColor: () => ({ r: 0, g: 0, b: 0, a: 1 }),
};
