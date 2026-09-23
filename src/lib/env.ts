import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 把 .env 读进 process.env。
 *
 * 为什么不用 import.meta.env：Astro 只保证 .env 出现在 import.meta.env 里，
 * 而 import.meta.env 的值是在构建时被替换进代码的——那样密码会被烤进产物。
 * 这里用 Node 自带的 process.loadEnvFile 在运行时读取：
 *   - 构建产物里不含任何密码
 *   - 已经存在的真实环境变量优先级更高（部署时用系统环境变量覆盖 .env 即可）
 */

let loaded = false;

export function loadEnvOnce(): void {
  if (loaded) return;
  loaded = true;

  const file = resolve(process.cwd(), '.env');
  if (!existsSync(file)) return;

  try {
    process.loadEnvFile(file);
  } catch {
    // .env 格式有问题时不要崩，缺配置的后果由各自的使用处提示
  }
}
