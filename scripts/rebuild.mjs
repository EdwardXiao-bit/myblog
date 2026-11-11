// 构建一次，输出到带时间戳的目录，并写交接文件 data/dist-next.txt。
//
// 两种用法：
//   - 后台保存触发（src/lib/rebuild.ts 会 spawn 这个脚本）
//   - 部署后手动补一次（deploy.sh 里 docker compose exec app node scripts/rebuild.mjs）
//
// 不直接输出到 dist：正在运行的服务可能还开着 dist 里的文件（Windows 上尤其），
// 而且 @astrojs/node standalone 启动时就固化了静态资产清单，必须换进程才能看到新页面。
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..+/, '').replace('T', '-');
const stage = resolve(root, `dist-build-${stamp}`);
const astroBin = resolve(root, 'node_modules/astro/bin/astro.mjs');
const nextFile = resolve(root, 'data/dist-next.txt');

const child = spawn(process.execPath, [astroBin, 'build'], {
  cwd: root,
  env: { ...process.env, ASTRO_OUT_DIR: stage },
  stdio: 'inherit',
});

child.on('exit', (code) => {
  if (code !== 0) {
    console.error(`[rebuild] astro build 退出码 ${code}`);
    process.exit(code ?? 1);
  }
  mkdirSync(resolve(root, 'data'), { recursive: true });
  writeFileSync(nextFile, stage);
  console.log(`[rebuild] 完成：${stage}`);
});
