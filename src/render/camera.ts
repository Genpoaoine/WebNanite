import { mat4, vec3 } from 'gl-matrix';

const FOV_Y = (50 * Math.PI) / 180;
const NEAR = 0.05;
const FAR = 40;
const ORIGIN = vec3.fromValues(0, 0, 0);
const UP = vec3.fromValues(0, 1, 0);

const MIN_DISTANCE = 1.45;
const MAX_DISTANCE = 12;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** 轨道相机：拖拽/单指旋转、滚轮/双指捏合缩放，空闲时缓慢自转。 */
export class OrbitCamera {
  readonly viewProj = new Float32Array(16);
  readonly position = new Float32Array(3);
  readonly tanHalfFov = Math.tan(FOV_Y / 2);

  private yaw = 0.85;
  private pitch = 0.32;
  private distance = 3.3;
  private autoRotateSpeed = 0.35;

  /** 右下角按钮可暂停/恢复自动旋转。 */
  autoRotateEnabled = true;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;

  /** 当前按下的指针（触屏多指时会 >1）。 */
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;

  private readonly view = mat4.create();
  private readonly projection = mat4.create();

  /** 供调试/自动化检查用。 */
  get currentDistance(): number {
    return this.distance;
  }

  get currentYaw(): number {
    return this.yaw;
  }

  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.pointers.size >= 2) {
        // 第二根手指落下：进入双指缩放，暂停旋转
        this.dragging = false;
        this.pinchDistance = this.measurePinch();
        return;
      }

      this.dragging = true;
      this.lastX = event.clientX;
      this.lastY = event.clientY;
    });

    canvas.addEventListener('pointermove', (event) => {
      const tracked = this.pointers.get(event.pointerId);
      if (tracked) {
        tracked.x = event.clientX;
        tracked.y = event.clientY;
      }

      if (this.pointers.size >= 2) {
        const next = this.measurePinch();
        if (this.pinchDistance > 0 && next > 0) {
          // 两指张开（next 变大）→ 距离变小 → 拉近
          this.distance = clamp(
            this.distance * (this.pinchDistance / next),
            MIN_DISTANCE,
            MAX_DISTANCE,
          );
        }
        this.pinchDistance = next;
        return;
      }

      if (!this.dragging) {
        return;
      }
      const dx = event.clientX - this.lastX;
      const dy = event.clientY - this.lastY;
      this.lastX = event.clientX;
      this.lastY = event.clientY;

      this.yaw -= dx * 0.006;
      this.pitch = clamp(this.pitch + dy * 0.006, -1.35, 1.35);
    });

    const endPointer = (event: PointerEvent): void => {
      this.pointers.delete(event.pointerId);
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }

      if (this.pointers.size >= 2) {
        // 仍是双指：重算基准距离
        this.pinchDistance = this.measurePinch();
        return;
      }

      this.pinchDistance = 0;

      if (this.pointers.size === 1) {
        // 双指放开一根：用剩下的那根继续旋转，避免视角跳变
        const remaining = this.pointers.values().next().value;
        if (remaining) {
          this.dragging = true;
          this.lastX = remaining.x;
          this.lastY = remaining.y;
        }
        return;
      }

      this.dragging = false;
    };
    canvas.addEventListener('pointerup', endPointer);
    canvas.addEventListener('pointercancel', endPointer);

    canvas.addEventListener(
      'wheel',
      (event) => {
        event.preventDefault();
        this.distance = clamp(
          this.distance * Math.exp(event.deltaY * 0.0012),
          MIN_DISTANCE,
          MAX_DISTANCE,
        );
      },
      { passive: false },
    );
  }

  /** 两个指针之间的像素距离（不足两指返回 0）。 */
  private measurePinch(): number {
    if (this.pointers.size < 2) {
      return 0;
    }
    const [a, b] = Array.from(this.pointers.values());
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /** spinScale 用于「暴力全开」模式下的疯狂旋转。 */
  update(deltaSeconds: number, aspect: number, spinScale: number): void {
    if (!this.dragging && this.autoRotateEnabled) {
      this.yaw += this.autoRotateSpeed * spinScale * deltaSeconds;
    }

    const cosPitch = Math.cos(this.pitch);
    const sinPitch = Math.sin(this.pitch);
    vec3.set(
      this.position,
      this.distance * cosPitch * Math.sin(this.yaw),
      this.distance * sinPitch,
      this.distance * cosPitch * Math.cos(this.yaw),
    );

    mat4.lookAt(this.view, this.position, ORIGIN, UP);
    mat4.perspective(this.projection, FOV_Y, Math.max(aspect, 1e-4), NEAR, FAR);
    mat4.multiply(this.viewProj, this.projection, this.view);
  }
}
