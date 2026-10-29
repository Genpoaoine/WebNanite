/**
 * Description.md 中 GLSL `kernal` 的 CPU 移植，用于 Worker 内的隐式曲面采样。
 *
 * 与 GLSL 的差异（均为必要修正）：
 * - atan(y, x) → Math.atan2(y, x)
 * - acos(a.z / b) 的入参做 clamp：浮点舍入使 |z/b| 略大于 1 时 GLSL 版会得到 NaN
 * - 原代码里的 `e = 1.0 / b` 从未被使用，这里省略（不影响结果）
 */

const ITERATIONS = 5;
const ESCAPE_RADIUS = 6.0;
/** 曲面上 IFS 的奇点（b → 0），直接返回外部值避免除零。 */
const MIN_RADIUS = 1e-9;

export function kernal(x: number, y: number, z: number): number {
  const px = x;
  const py = y;
  const pz = z;

  let ax = x;
  let ay = y;
  let az = z;
  let b = 0;

  for (let i = 0; i < ITERATIONS; i++) {
    b = Math.sqrt(ax * ax + ay * ay + az * az);
    if (b < MIN_RADIUS) {
      return 4.0;
    }

    const c = Math.atan2(ay, ax) * 8.0;
    const d = Math.acos(Math.min(1, Math.max(-1, az / b))) * 8.0;
    // pow(b, 8) → 三次乘法：数值等价，但避免 libm pow 的开销
    const b2 = b * b;
    b = b2 * b2 * b2 * b2;

    ax = b * Math.sin(d) * Math.cos(c) + px;
    ay = b * Math.sin(d) * Math.sin(c) + py;
    az = b * Math.cos(d) + pz;

    if (b > ESCAPE_RADIUS) {
      break;
    }
  }

  return 4.0 - (ax * ax + ay * ay + az * az);
}

/** 场值向内部增大，因此外法线取梯度的反方向（法线在 surfaceNets 里用格子差分直接算出）。 */
