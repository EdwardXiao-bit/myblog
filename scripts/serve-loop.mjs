// 本地守护：跑 scripts/serve.mjs，进程退出就再拉一次。
// 后台保存触发的重建会主动退出进程，靠这里重新起——线上则是 compose 的
// restart: unless-stopped 干这件事。
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const serve = resolve(process.cwd(), 'scripts/serve.mjs');

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
  process.exit(0);
});
process.on('SIGTERM', () => {
  stopping = true;
  process.exit(0);
});

function start() {
  const child = spawn(process.execPath, [serve], { stdio: 'inherit' });
  child.on('exit', (code, signal) => {
    if (stopping) return;
    console.log(`[serve:loop] 退出（code=${code ?? 'null'} signal=${signal ?? 'null'}），1 秒后重启`);
    setTimeout(start, 1000);
  });
}

start();
