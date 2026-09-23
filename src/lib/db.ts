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
  created_at  text not null,                     -- ISO 时间字符串
  status      text not null default 'pending',   -- pending | published | private | rejected
  ip_hash     text                               -- 只存哈希，不存明文 IP
);

create index if not exists idx_entries_feed on entries (status, created_at desc);
create index if not exists idx_entries_rate on entries (ip_hash, created_at);
`;

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
    instance = db;
  }
  return instance;
}
