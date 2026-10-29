/**
 * 创建着色器模块并检查编译诊断。
 * WGSL 编译错误在浏览器里默认只打印在控制台，这里提前拦截并带上行号，便于脚手架阶段定位问题。
 */
import { t } from '../ui/i18n';

export async function createShaderModuleChecked(
  device: GPUDevice,
  label: string,
  code: string,
): Promise<GPUShaderModule> {
  const module = device.createShaderModule({ label, code });
  const info = await module.getCompilationInfo();

  let errors = 0;
  for (const message of info.messages) {
    const where = `${label} ${message.lineNum}:${message.linePos}`;
    if (message.type === 'error') {
      errors += 1;
      console.error(`[wgsl] ${where} ${message.message}`);
    } else {
      console.warn(`[wgsl] ${where} ${message.message}`);
    }
  }

  if (errors > 0) {
    throw new Error(t.wgslCompileFailed(errors, label));
  }

  return module;
}
