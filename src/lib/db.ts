import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvOnce } from './env';

/**
 * 留言板 / 日记的数据库。
 * 用 Node 24 自带的 node:sqlite，不需要任何原生依赖，整个库就是一个文件。
 */

const SCHEMA = `
create table if not exists entries (
  id          integer primary key autoincrement,
  kind        text not null default 'message',   -- message | diary
  nickname    text,                              -- null = 匿名
  body        text not null,
  created_at  text not null,                     -- ISO 时间字符串（UTC）
  status      text not null default 'pending',   -- pending | published | private | rejected
  ip_hash     text,                              -- 只存哈希，不存明文 IP
  reply       text,                              -- 站主回复，null = 还没回
  replied_at  text
);

create index if not exists idx_entries_feed on entries (status, created_at desc);
create index if not exists idx_entries_rate on entries (ip_hash, created_at);

-- 点赞：同一个 IP 对同一条只能点一次（主键去重），不需要登录
create table if not exists likes (
  entry_id    integer not null,
  ip_hash     text not null,
  created_at  text not null,
  primary key (entry_id, ip_hash)
);

-- 留言附带的图片。文件本身放在磁盘上（见 lib/storage.ts），这里只存相对路径。
create table if not exists attachments (
  id          integer primary key autoincrement,
  entry_id    integer not null,
  path        text not null,                     -- 相对 data/uploads 的路径
  width       integer,
  height      integer,
  bytes       integer,
  created_at  text not null
);

create index if not exists idx_attachments_entry on attachments (entry_id);
`;

/**
 * 极简迁移：老库里的表可能缺列，缺什么补什么。
 * 这样已经写过的留言不会因为加功能而丢。
 */
function ensureColumns(db: DatabaseSync, table: string, wanted: Array<[name: string, ddl: string]>): void {
  const rows = db.prepare(`select name from pragma_table_info(?)`).all(table) as Array<{ name: string }>;
  const existing = new Set(rows.map((r) => r.name));

  for (const [name, ddl] of wanted) {
    if (!existing.has(name)) {
      db.exec(`alter table ${table} add column ${name} ${ddl}`);
    }
  }
}

let instance: DatabaseSync | undefined;
let resolvedPath: string | undefined;

export function dbPath(): string {
  if (!resolvedPath) {
    loadEnvOnce();
    resolvedPath = resolve(process.cwd(), process.env.GUESTBOOK_DB || 'data/guestbook.db');
  }
  return resolvedPath;
}

export function getDb(): DatabaseSync {
  if (!instance) {
    const file = dbPath();
    mkdirSync(dirname(file), { recursive: true });
    const db = new DatabaseSync(file);
    db.exec('pragma journal_mode = WAL');
    db.exec(SCHEMA);

    // 建表语句只管新库；老库靠这里补列
    ensureColumns(db, 'entries', [
      ['ip_hash', 'text'],
      ['reply', 'text'],
      ['replied_at', 'text'],
    ]);

    instance = db;
  }
  return instance;
}
