/**
 * 备份留言板数据：SQLite 数据库 + 上传的图片。
 *
 *   node scripts/backup.mjs                    # 备份到 ./backups
 *   BACKUP_DIR=/backups node scripts/backup.mjs
 *   KEEP=30 node scripts/backup.mjs            # 保留最近 30 份（默认 14）
 *
 * 两种跑法都行：
 *   - 容器内：docker compose exec -T app node scripts/backup.mjs   （/backups 是挂载出来的）
 *   - 宿主机：node scripts/backup.mjs                              （需要本机有 node 24+）
 *
 * 为什么用 VACUUM INTO 而不是直接复制文件：
 *   SQLite 开了 WAL，直接 copy 那个 .db 可能拿到「还没合并 WAL」的旧数据；
 *   VACUUM INTO 走的是事务一致的读快照，且产出一个已压实的单文件，恢复时不用带 -wal/-shm。
 */
import { DatabaseSync } from 'node:sqlite';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const DB = process.env.GUESTBOOK_DB || 'data/guestbook.db';
const UPLOADS = process.env.UPLOAD_DIR || 'data/uploads';
const BACKUP_ROOT = resolve(process.env.BACKUP_DIR || 'backups');
const KEEP = Number(process.env.KEEP || 14);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
const dest = join(BACKUP_ROOT, stamp);

if (!existsSync(DB)) {
  console.error(`找不到数据库：${DB}（容器里要先跑起来一次，数据库才会被创建）`);
  process.exit(1);
}

mkdirSync(dest, { recursive: true });

// ---- 1. 数据库：事务一致快照 ----
const db = new DatabaseSync(DB);
const entries = db.prepare('select count(*) as n from entries').get().n;
const likes = db.prepare('select count(*) as n from likes').get().n;
const reactions = db.prepare('select count(*) as n from reactions').get().n;
const attachments = db.prepare('select count(*) as n from attachments').get().n;
const integrity = db.prepare('pragma integrity_check').get();
db.exec(`vacuum into '${join(dest, 'guestbook.db').replace(/\\/g, '/')}'`);
db.close();

// ---- 2. 上传的图片 ----
let uploadFiles = 0;
let uploadBytes = 0;
if (existsSync(UPLOADS)) {
  cpSync(UPLOADS, join(dest, 'uploads'), { recursive: true });
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else {
        uploadFiles++;
        uploadBytes += statSync(p).size;
      }
    }
  };
  walk(join(dest, 'uploads'));
}

// ---- 3. 清单：恢复时要靠它判断这份备份完不完整 ----
const dbBytes = statSync(join(dest, 'guestbook.db')).size;
const manifest = {
  createdAt: new Date().toISOString(),
  source: { db: DB, uploads: UPLOADS },
  counts: { entries, likes, reactions, attachments },
  uploads: { files: uploadFiles, bytes: uploadBytes },
  dbBytes,
  integrityCheck: integrity?.integrity_check ?? 'unknown',
};
writeFileSync(join(dest, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`备份完成：${dest}`);
console.log(`  数据库 ${(dbBytes / 1024).toFixed(0)} KB  条目 ${entries}  点赞 ${likes}  表情 ${reactions}  附件 ${attachments}`);
console.log(`  图片 ${uploadFiles} 个 / ${(uploadBytes / 1024).toFixed(0)} KB`);
console.log(`  完整性检查：${manifest.integrityCheck}`);
if (manifest.integrityCheck !== 'ok') {
  console.error('  !! integrity_check 不是 ok，这份备份不可信');
  process.exit(1);
}

// ---- 4. 清理旧备份 ----
const all = readdirSync(BACKUP_ROOT, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name)
  .sort()
  .reverse();
for (const old of all.slice(KEEP)) {
  rmSync(join(BACKUP_ROOT, old), { recursive: true, force: true });
  console.log(`  清理旧备份 ${old}`);
}
console.log(`保留最近 ${Math.min(KEEP, all.length)} 份于 ${BACKUP_ROOT}`);
