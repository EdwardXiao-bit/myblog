import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * 「保存后重新构建」。
 *
 * 首页 / 项目 / 活动 / sitemap 都是构建期产物，后台改的是数据库里的覆盖行，
 * 所以保存接口在响应发出之后启动一次 astro build，输出到带时间戳的
 * `dist-build-<时间>` 目录，成功后写 data/dist-next.txt 并退出进程。
 *
 * 启动脚本 scripts/serve.mjs 读到 dist-next.txt 就把服务指向那个新目录，
 * 并删掉更旧的构建目录——不 rename 正在用的目录：Windows 上服务进程开着
 * dist 时 rename 会 EPERM，而 Linux 容器里 rename 后旧进程也不会重读静态
 * 资产清单。退出进程是必须的，@astrojs/node standalone 在启动时就把静态
 * 资产清单固定下来了。线上靠 compose 的 restart: unless-stopped 拉起，
 * 本地用 npm run serve:loop。
 *
 * 构建期间继续吃旧目录；构建失败时不退出，后台页显示原因和日志尾巴。
 */

const LOG_FILE = resolve(process.cwd(), 'data/rebuild.log');
const STATE_FILE = resolve(process.cwd(), 'data/rebuild-state.json');
const REBUILD_SCRIPT = resolve(process.cwd(), 'scripts/rebuild.mjs');

export interface RebuildState {
  building: boolean;
  /** 构建成功、等新进程切换目录 —— 这期间后台应该提示「正在重启」 */
  ready: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  ok: boolean | null;
  error: string | null;
  /** 最近一次构建的日志尾巴，方便后台直接看到失败原因 */
  log: string;
}

const IDLE: RebuildState = {
  building: false,
  ready: false,
  startedAt: null,
  finishedAt: null,
  ok: null,
  error: null,
  log: '',
};

let state: RebuildState = loadState();
let child: ChildProcess | null = null;
let pending = false;
let log = '';

function loadState(): RebuildState {
  try {
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf8')) as Partial<RebuildState>;
    // 已经写好 dist-next.txt 的，说明新进程会先切目录再读这个文件，不用在这里处理。
    // 而没写交接文件却还挂着 building=true：上次构建没走完（进程被 kill / 机器重启），
    // 当作失败，别让后台一直转圈。
    const started = raw.startedAt ? Date.parse(raw.startedAt) : NaN;
    const incomplete =
      Boolean(raw.building) && !raw.ready && Number.isFinite(started) && Date.now() - started > 10 * 60 * 1000;
    return { ...IDLE, ...raw, building: incomplete ? false : Boolean(raw.building) };
  } catch {
    return { ...IDLE };
  }
}

function persist() {
  try {
    mkdirSync(dirname(STATE_FILE), { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify({ ...state, log: log.slice(-2000) }));
  } catch {
    // 状态文件写不进去不该影响重建本身
  }
}

export function rebuildState(): RebuildState {
  return { ...state, log: log.slice(-2000) };
}

/** 保存接口调用：正在构建时只记一笔，等这轮成功后再补一轮，避免连点开一堆进程 */
export function requestRebuild(): RebuildState {
  if (child) {
    pending = true;
    return rebuildState();
  }
  run();
  return rebuildState();
}

function run() {
  const startedAt = new Date().toISOString();
  state = { ...IDLE, building: true, startedAt };
  log = '';
  persist();

  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    writeFileSync(LOG_FILE, `[${startedAt}] rebuild start\n`);
  } catch {
    // 日志写不进去不影响构建
  }

  const proc = spawn(process.execPath, [REBUILD_SCRIPT], {
    cwd: process.cwd(),
    env: { ...process.env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child = proc;

  const append = (chunk: Buffer) => {
    const text = chunk.toString();
    log = (log + text).slice(-8000);
    try {
      appendFileSync(LOG_FILE, text);
    } catch {
      // 同上
    }
  };
  proc.stdout?.on('data', append);
  proc.stderr?.on('data', append);

  proc.on('error', (error) => {
    if (child !== proc) return;
    child = null;
    fail(`无法启动构建：${error.message}`);
  });

  proc.on('close', (code) => {
    if (child !== proc) return;
    child = null;

    if (code !== 0) {
      fail(`重建脚本退出码 ${code}`);
      return;
    }

    if (pending) {
      // 构建期间又有人保存了，再来一轮（state 保持 building=true）
      pending = false;
      run();
      return;
    }

    // 交接文件由 scripts/rebuild.mjs 写好，这里只更新状态。

    // 保持 building=true：服务还在跑旧目录，后台要继续等重启。
    state = { ...state, ready: true, ok: null, error: null };
    persist();
    try {
      appendFileSync(LOG_FILE, `rebuild ok -> ${stage}, waiting for restart\n`);
    } catch {
      // 同上
    }

    // 先把保存接口的 303 响应发完，再退出让容器 / 守护脚本重启；
    // 新进程由 scripts/serve.mjs 启动，它会切到新目录。
    setTimeout(() => process.exit(0), 500);
  });
}

function fail(reason: string) {
  state = {
    ...state,
    building: false,
    ready: false,
    finishedAt: new Date().toISOString(),
    ok: false,
    error: reason,
  };
  persist();
  try {
    appendFileSync(LOG_FILE, `rebuild failed: ${reason}\n`);
  } catch {
    // 同上
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
