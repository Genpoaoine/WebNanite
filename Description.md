> **任务背景**：我手里有一段计算 3D Mandelbulb 分形的核心 GLSL 着色器函数，我想用它作为资产，在浏览器里用 **WebGPU** 做一个单体模型的 Nanite 风格极简概念演示（展示 GPU 驱动的 Cluster 动态 LOD / 视锥剔除）。
>
> **核心资产源码（GLSL 形式，后续需要转成 WGSL）**：
>
> C
>
> ```
> float kernal(vec3 ver){
>     vec3 a;
>     float b,c,d,e;
>     a=ver;
>     for(int i=0;i<5;i++){
>         b=length(a);
>         c=atan(a.y,a.x)*8.0;
>         e=1.0/b;
>         d=acos(a.z/b)*8.0;
>         b=pow(b,8.0);
>         a=vec3(b*sin(d)*cos(c),b*sin(d)*sin(c),b*cos(d))+ver;
>         if(b>6.0){
>             break;
>         }
>     }   
>     return 4.0-a.x*a.x-a.y*a.y-a.z*a.z;
> }
> ```
>
> **给 Cline 的具体要求**：
>
> 1. **代码转换与适配**：帮我把这段 GLSL 代码改写成 **WGSL（WebGPU Shading Language）** 格式。
> 2. **顶点生成/网格化**：由于分形是隐式曲面，我们需要在 CPU 端（或通过 Web Worker / 初始 Compute Shader）基于这个公式采样并生成由多个微小 Cluster 组成的超高面数网格数据（或者用 Ray Marching / 实例化网格方案呈现）。
> 3. **Nanite 概念框架搭建**：实现一个简单的 WebGPU 渲染管线，包含一个 Compute Shader 用于做视锥剔除与 LOD 动态选择，然后通过 `drawIndexedIndirect` 渲染这个分形模型。
> 4. **对比与互动**：提供一个开关，对比“暴力全开（不裁剪，疯狂旋转）”与“GPU 驱动剔除/LOD”的流畅度，并在画面上显示实时 FPS 和面数。

这段 GLSL 的 Mandelbulb 分形核心内核转换成 **WGSL（WebGPU Shading Language）** 如下。



需要注意的一点是：在 GLSL 中双参数的 `atan(y, x)`，在 WGSL 中对应的是 **`atan2(y, x)`**，同时 WGSL 要求显式指定类型（如 `vec3<f32>`）。



转换后的 WGSL 代码如下：

代码段

```
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
```

