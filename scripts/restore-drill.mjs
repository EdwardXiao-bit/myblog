/**
 * 恢复演练：把某份备份真的恢复出来并逐项校验。
 *
 *   node scripts/restore-drill.mjs                       # 用 backups/ 里最新的一份
 *   node scripts/restore-drill.mjs backups/2026-09-24_07-30-00
 *
 * 为什么要有这个脚本：
 *   「备份成功」和「备份能恢复」是两件事。定时任务一直成功、但真出事时发现
 *   备份是空的/坏的，是运维里最常见的翻车方式。这个脚本把恢复变成一次演练。
 *
 * 它只往临时目录里恢复，**不碰正在用的 data/**，可以随时放心跑。
 */
import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(process.env.BACKUP_DIR || 'backups');

let src = process.argv[2];
if (!src) {
  if (!existsSync(ROOT)) {
    console.error(`没有备份目录：${ROOT}`);
    process.exit(1);
  }
  const dirs = readdirSync(ROOT, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
  if (!dirs.length) {
    console.error(`${ROOT} 里没有任何备份`);
    process.exit(1);
  }
  src = join(ROOT, dirs[dirs.length - 1]);
  console.log(`未指定备份，使用最新的一份：${src}`);
}
src = resolve(src);

let pass = 0;
let fail = 0;
const check = (cond, label, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`);
  }
};

console.log(`\n恢复演练：${src}`);

// ---- 1. 备份本身是否完整 ----
console.log('\n[1] 备份文件');
const dbFile = join(src, 'guestbook.db');
const manifestFile = join(src, 'manifest.json');
check(existsSync(dbFile), 'guestbook.db 存在');
if (!existsSync(dbFile)) process.exit(1);
check(existsSync(manifestFile), 'manifest.json 存在');
const manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : null;

// ---- 2. 恢复到临时目录（不碰在用的数据）----
console.log('\n[2] 恢复到临时目录');
const work = mkdtempSync(join(tmpdir(), 'guestbook-restore-'));
const restored = join(work, 'guestbook.db');
cpSync(dbFile, restored);
if (existsSync(join(src, 'uploads'))) {
  cpSync(join(src, 'uploads'), join(work, 'uploads'), { recursive: true });
}
console.log(`  ${work}`);

// ---- 3. 数据库可用性与内容 ----
console.log('\n[3] 数据库');
const db = new DatabaseSync(restored, { readOnly: true });
const integrity = db.prepare('pragma integrity_check').get().integrity_check;
check(integrity === 'ok', `integrity_check = ${integrity}`);

const counts = {
  entries: db.prepare('select count(*) as n from entries').get().n,
  likes: db.prepare('select count(*) as n from likes').get().n,
  reactions: db.prepare('select count(*) as n from reactions').get().n,
  attachments: db.prepare('select count(*) as n from attachments').get().n,
};
console.log(`  条目 ${counts.entries} / 点赞 ${counts.likes} / 表情 ${counts.reactions} / 附件 ${counts.attachments}`);

const tables = db.prepare("select name from sqlite_master where type='table'").all().map((r) => r.name);
for (const t of ['entries', 'likes', 'reactions', 'attachments']) {
  check(tables.includes(t), `表 ${t} 存在`);
}

if (manifest) {
  for (const k of Object.keys(manifest.counts)) {
    check(manifest.counts[k] === counts[k],
      `manifest 记录的 ${k} 与实际一致（${manifest.counts[k]}）`,
      `实际 ${counts[k]}`);
  }
}

// 真正跑一次业务查询，而不是只 count —— 表结构坏了 count 也可能通过
try {
  const feed = db.prepare(
    "select id, kind, nickname, body, status from entries where status = 'published' order by id desc limit 5"
  ).all();
  check(true, `能查出公开留言（${feed.length} 条）`);
} catch (e) {
  check(false, '能查出公开留言', e.message);
}

// ---- 4. 附件指向的图片是否真的在 ----
console.log('\n[4] 附件与图片的对应关系');
const atts = db.prepare('select id, path from attachments').all();
const uploadsDir = join(work, 'uploads');
let missing = 0;
for (const a of atts) {
  if (!existsSync(join(uploadsDir, a.path))) {
    missing++;
    console.log(`     缺文件：${a.path}`);
  }
}
check(missing === 0, `附件记录 ${atts.length} 条，图片文件缺失 ${missing} 个`);
db.close();

// ---- 5. 收尾 ----
rmSync(work, { recursive: true, force: true });
check(!existsSync(work), '临时目录已清理');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail === 0) {
  console.log('这份备份是**可恢复**的。');
  console.log(`真正恢复的操作：停掉应用 -> 把 ${join(src, 'guestbook.db')} 覆盖到 data/guestbook.db`);
  console.log(`              把 ${join(src, 'uploads')} 覆盖到 data/uploads -> 启动应用`);
}
process.exit(fail ? 1 : 0);
