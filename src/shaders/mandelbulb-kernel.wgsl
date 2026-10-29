// Mandelbulb 距离/命中内核（资产，暂时未被任何管线引用）。
//
// 来源：Description.md 中由 GLSL 转换得到的 WGSL 版本。
// 约定：该函数可直接被后续的 Ray Marching / Compute Shader 复用；
//       GLSL 的 atan(y, x) 在 WGSL 中写作 atan2(y, x)。
//
// 注意：本文件不会被 vite build 打包，只有被 import 时才会进入构建产物。

fn kernal(ver: vec3<f32>) -> f32 {
    var a: vec3<f32> = ver;
    var b: f32 = 0.0;
    var c: f32 = 0.0;
    var d: f32 = 0.0;
    var e: f32 = 0.0;

    for (var i = 0; i < 5; i++) {
        b = length(a);
        c = atan2(a.y, a.x) * 8.0;
        e = 1.0 / b;
        d = acos(a.z / b) * 8.0;
        b = pow(b, 8.0);
        a = vec3<f32>(b * sin(d) * cos(c), b * sin(d) * sin(c), b * cos(d)) + ver;

        if (b > 6.0) {
            break;
        }
    }

    return 4.0 - a.x * a.x - a.y * a.y - a.z * a.z;
}
