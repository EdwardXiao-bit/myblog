// 数据库迁移测试：拿「老版本的库」起服务，确认能平滑升级。
//
// 为什么单独做这个：其他测试都用全新建的库，所以「新库能跑、老库直接报错」
// 这类问题永远测不到。这个脚本专门造两个历史版本的库来跑。
//
// 用法：node scripts/test-migration.mjs   （需要先 npm run build）

import { spawn } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const PORT = 4360;
const HOST = '127.0.0.1';
const BASE = `http://${HOST}:${PORT}`;

let passed = 0;
let failed = 0;
const check = (label, ok, detail = '') => {
  if (ok) {
    passed++;
    console.log(`  ok   ${label}${detail ? '  — ' + detail : ''}`);
  } else {
    failed++;
    console.log(`  FAIL ${label}${detail ? '  — ' + detail : ''}`);
  }
};

/** 造一个历史版本的库 */
function makeLegacyDb(file, shape) {
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(file + suffix)) rmSync(file + suffix, { force: true });
  }

  const db = new DatabaseSync(file);
  db.exec(`
    create table entries (
      id          integer primary key autoincrement,
      kind        text not null default 'message',
      nickname    text,
      body        text not null,
      created_at  text not null,
      status      text not null default 'pending'
      ${shape === 'with-ip' ? ', ip_hash text' : ''}
      ${shape === 'with-reply' ? ', ip_hash text, reply text, replied_at text' : ''}
    );
  `);

  const insert = db.prepare(
    `insert into entries (kind, nickname, body, created_at, status) values (?, ?, ?, ?, ?)`
  );
  insert.run('message', '老王', '这是一条老留言', '2026-01-02T03:04:05.000Z', 'published');
  insert.run('message', null, '匿名的老留言', '2026-01-03T03:04:05.000Z', 'pending');
  insert.run('diary', null, '一篇老日记', '2026-01-04T03:04:05.000Z', 'published');

  // 上一个版本把回复存在 entries.reply 这一列里，迁移时要能搬成回复记录
  if (shape === 'with-reply') {
    db.prepare(`update entries set reply = ?, replied_at = ? where id = 1`).run(
      '老版本写在这列里的回复',
      '2026-02-02T03:04:05.000Z'
    );
  }

  db.close();
}

/** 起一个服务，等它就绪 */
async function startServer(dbFile) {
  const proc = spawn(process.execPath, ['dist/server/entry.mjs'], {
    env: { ...process.env, GUESTBOOK_DB: dbFile, PORT: String(PORT), HOST },
    stdio: 'ignore',
  });

  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      await fetch(BASE + '/robots.txt', { signal: AbortSignal.timeout(1500) });
      return proc;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  throw new Error('服务启动超时');
}

async function stopServer(proc) {
  proc.kill();
  await new Promise((r) => setTimeout(r, 500));
}

// ============================================================

const cases = [
  { file: 'data/test-legacy-1.db', shape: 'minimal', what: '最早的库（没有 ip_hash / reply / parent_id）' },
  { file: 'data/test-legacy-2.db', shape: 'with-reply', what: '上一版的库（回复还是文本列）' },
];

for (const c of cases) {
  console.log(`\n${c.what}`);
  makeLegacyDb(c.file, c.shape);

  const proc = await startServer(c.file);
  try {
    for (const path of ['/guestbook', '/admin', '/rss.xml']) {
      const res = await fetch(BASE + path);
      check(`${path} 能正常打开`, res.status === 200, `status=${res.status}`);
    }

    const html = await (await fetch(BASE + '/guestbook')).text();

    // 老数据必须还在
    check('老留言还在', html.includes('这是一条老留言'));
    check('老日记还在', html.includes('一篇老日记'));
    check('日记已署站主名', html.includes('站主日记'));

    // 结构升级到位
    const db = new DatabaseSync(c.file, { readOnly: true });
    const columns = new Set(
      db.prepare('select name from pragma_table_info(?)').all('entries').map((r) => r.name)
    );
    check('补上了 parent_id 列', columns.has('parent_id'));
    check('补上了 ip_hash 列', columns.has('ip_hash'));

    const tables = db
      .prepare(`select name from sqlite_master where type = 'table'`)
      .all()
      .map((t) => t.name);
    check('建好了 likes 表', tables.includes('likes'));
    check('建好了 attachments 表', tables.includes('attachments'));

    // 回复迁移：老库的 reply 文本列应该变成一条 kind='reply' 的记录
    if (c.shape === 'with-reply') {
      const migrated = db
        .prepare(`select * from entries where kind = 'reply'`)
        .all();
      check('旧文本回复搬成了回复记录', migrated.length === 1, `找到 ${migrated.length} 条`);
      check('回复挂在正确的父级上', Number(migrated[0]?.parent_id) === 1);
      check('回复内容没丢', migrated[0]?.body === '老版本写在这列里的回复');
      check('回复时间保留', migrated[0]?.created_at === '2026-02-02T03:04:05.000Z');

      const parent = db.prepare('select reply from entries where id = 1').get();
      check('旧列已清空（迁移幂等）', parent?.reply === null);
    }
    db.close();
  } finally {
    await stopServer(proc);
    for (const suffix of ['', '-wal', '-shm']) {
      if (existsSync(c.file + suffix)) rmSync(c.file + suffix, { force: true });
    }
  }
}

console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
