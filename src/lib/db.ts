import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { loadEnvOnce } from './env';

/**
 * 留言板 / 日记的数据库。
 * 用 Node 24 自带的 node:sqlite，不需要任何原生依赖，整个库就是一个文件。
 *
 * 关于「回复」：回复不再是 entries 上的一个文本列，而是**另一条 entry**
 * （kind='reply' + parent_id 指向被回复的留言）。
 * 这样配图、点赞、时间戳这些机制全都直接复用，不用为回复再写一套。
 */

const SCHEMA_TABLES = `
create table if not exists entries (
  id          integer primary key autoincrement,
  kind        text not null default 'message',   -- message | diary | reply
  parent_id   integer,                           -- 回复所属的留言；顶层内容为 null
  nickname    text,                              -- null = 匿名
  body        text not null,
  created_at  text not null,                     -- ISO 时间字符串（UTC）
  status      text not null default 'pending',   -- pending | published | private | rejected
  ip_hash     text                               -- 只存哈希，不存明文 IP
);

-- 点赞：同一个 IP 对同一条只能点一次（主键去重），不需要登录。
-- 留言和回复都走这张表，因为回复也是一条 entry。
create table if not exists likes (
  entry_id    integer not null,
  ip_hash     text not null,
  created_at  text not null,
  primary key (entry_id, ip_hash)
);

-- 留言/回复附带的图片。文件本身放在磁盘上（见 lib/storage.ts），这里只存相对路径。
create table if not exists attachments (
  id          integer primary key autoincrement,
  entry_id    integer not null,
  path        text not null,
  width       integer,
  height      integer,
  bytes       integer,
  created_at  text not null
);
`;

/**
 * 索引单独一步、放在补列之后执行。
 * 索引会引用 parent_id 这类新列，而老库还没这列——
 * 如果不分两步，老库会在「建索引」这里直接报 no such column，整个站起不来。
 */
const SCHEMA_INDEXES = `
create index if not exists idx_entries_feed on entries (status, created_at desc);
create index if not exists idx_entries_rate on entries (ip_hash, created_at);
create index if not exists idx_entries_parent on entries (parent_id, created_at);
create index if not exists idx_attachments_entry on attachments (entry_id);
`;

function columnNames(db: DatabaseSync, table: string): Set<string> {
  const rows = db.prepare(`select name from pragma_table_info(?)`).all(table) as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

/** 极简迁移：老库里的表可能缺列，缺什么补什么 */
function ensureColumns(db: DatabaseSync, table: string, wanted: Array<[name: string, ddl: string]>): void {
  const existing = columnNames(db, table);
  for (const [name, ddl] of wanted) {
    if (!existing.has(name)) db.exec(`alter table ${table} add column ${name} ${ddl}`);
  }
}

/**
 * 把老库里的 entries.reply 文本列搬成真正的回复记录。
 * 搬完就清空原列，所以重复执行是安全的（第二次没有可搬的行）。
 */
function migrateReplies(db: DatabaseSync): void {
  if (!columnNames(db, 'entries').has('reply')) return;

  const rows = db
    .prepare(`select id, reply, replied_at from entries where reply is not null and reply <> ''`)
    .all() as Array<{ id: number | bigint; reply: string; replied_at: string | null }>;

  if (rows.length === 0) return;

  const insert = db.prepare(
    `insert into entries (kind, parent_id, nickname, body, created_at, status)
     values ('reply', ?, null, ?, ?, 'published')`
  );
  const clear = db.prepare(`update entries set reply = null, replied_at = null where id = ?`);

  for (const row of rows) {
    insert.run(Number(row.id), row.reply, row.replied_at ?? new Date().toISOString());
    clear.run(Number(row.id));
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

    // 顺序很重要：先建表 → 再补老库缺的列 → 最后建索引
    // （索引引用了新列，必须等列补完）
    db.exec(SCHEMA_TABLES);

    ensureColumns(db, 'entries', [
      ['ip_hash', 'text'],
      ['parent_id', 'integer'],
    ]);

    migrateReplies(db);

    db.exec(SCHEMA_INDEXES);

    instance = db;
  }
  return instance;
}
