// 启动入口：把服务指向后台最新构建好的目录，再起 Astro。
//
// 后台保存会触发一次重建，产物落在 dist-build-<时间>，同时写 data/dist-next.txt。
// 这里启动时读交接文件：切到新目录、更新 current 指针、删掉旧构建目录。
//
// 为什么不 rename dist：Windows 上服务进程开着 dist 时 rename 会 EPERM；
// 为什么不原地重建：@astrojs/node standalone 启动时固化了静态资产清单，
// 不换进程看不到新页面。所以顺序是「构建到新目录 → 写交接 → 退出 → 本脚本切换」。
//
// 线上：Dockerfile 的 CMD 是 node scripts/serve.mjs，compose 的
// restart: unless-stopped 负责进程退出后再拉起。
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const NEXT_FILE = resolve(root, 'data/dist-next.txt');
const CURRENT_FILE = resolve(root, 'data/dist-current.txt');
const STATE_FILE = resolve(root, 'data/rebuild-state.json');
const LOG_FILE = resolve(root, 'data/rebuild.log');

const entryOf = (dir) => resolve(dir, 'server/entry.mjs');
const exists = (dir) => Boolean(dir) && existsSync(entryOf(dir));

function readText(file) {
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    return '';
  }
}

let live = '';

// 1) 有新构建就看交接文件
const next = readText(NEXT_FILE);
if (next && exists(next)) {
  live = next;
  try {
    mkdirSync(resolve(root, 'data'), { recursive: true });
    writeFileSync(CURRENT_FILE, live);
    rmSync(NEXT_FILE, { force: true });
  } catch {
    // 指针写不进去也能继续服务，只是下次还会切一次
  }
  try {
    const state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    Object.assign(state, { building: false, ready: false, ok: true, error: null, finishedAt: new Date().toISOString() });
    writeFileSync(STATE_FILE, JSON.stringify(state));
    appendFileSync(LOG_FILE, `serving ${live} at ${new Date().toISOString()}\n`);
  } catch {
    // 状态文件写不进去不影响服务启动
  }
  console.log(`[serve] 已切到新构建 ${live}`);
}

// 2) 没有新构建：在「上次切换的目录」和 dist 之间按构建时间取新者。
//    本地 npm run build 会刷新 dist；后台重建有交接文件，走不到这里。
if (!live) {
  const current = readText(CURRENT_FILE);
  const candidates = [current, resolve(root, 'dist')].filter((dir) => dir && exists(dir));
  let best = '';
  let bestTime = -1;
  for (const dir of candidates) {
    try {
      const time = statSync(entryOf(dir)).mtimeMs;
      if (time > bestTime) {
        best = dir;
        bestTime = time;
      }
    } catch {
      // 拿不到时间就当不存在
    }
  }
  live = best || resolve(root, 'dist');
}
if (!exists(live)) {
  console.error(`[serve] 找不到可用的构建产物（${live}），退出等重启`);
  process.exit(1);
}

// 3) 清理更旧的构建目录（删不掉就留着，下次启动再试）
try {
  for (const name of readdirSync(root)) {
    if (!/^dist-build-/.test(name)) continue;
    const dir = resolve(root, name);
    if (dir === live) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 旧进程可能还占着文件，忽略
    }
  }
} catch {
  // 清理失败不影响启动
}

await import(pathToFileURL(entryOf(live)).href);
