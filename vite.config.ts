import { defineConfig } from 'vite';

// WebGPU 需要较新的语法（大整数类型、top-level await 等），因此构建目标固定为 esnext。
// base 用相对路径：产物可以直接放到 GitHub Pages 的项目子路径（/repo-name/）下。
export default defineConfig({
  base: './',
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: 'esnext',
    sourcemap: true,
  },
});
