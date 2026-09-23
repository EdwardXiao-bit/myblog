import { createHash } from 'node:crypto';
import { getDb } from './db';
import { loadEnvOnce } from './env';

/**
 * 留言板 / 日记的全部业务逻辑。
 * 设计取舍：
 *  - 谁都能留言，昵称留空就是匿名（不要求登录，也不收集邮箱）
 *  - IP 只存哈希，用来限流，不存明文
 *  - 审核开关默认开：留言先进待审核队列，避免匿名留言被垃圾灌满
 */

export type EntryKind = 'message' | 'diary';
export type EntryStatus = 'pending' | 'published' | 'private' | 'rejected';

export interface Entry {
  id: number;
  kind: EntryKind;
  nickname: string | null;
  body: string;
  createdAt: string;
  status: EntryStatus;
}

export const LIMITS = {
  nickname: 24,
  body: 1000,
  /** 同一 IP 每小时最多留言条数 */
  perHour: 5,
  /** 留言墙一次显示多少条 */
  feed: 60,
} as const;

const RATE_WINDOW_MS = 60 * 60 * 1000;

/** 审核开关：.env 里 MODERATION=off 即提交后立刻公开 */
export function moderationOn(): boolean {
  loadEnvOnce();
  return (process.env.MODERATION ?? 'on').toLowerCase() !== 'off';
}

/** IP 单向哈希：只用于限流，无法还原出原始 IP */
export function hashIp(ip: string): string {
  loadEnvOnce();
  const salt = process.env.GUESTBOOK_SALT || 'dev-salt';
  return createHash('sha256').update(`${salt}|${ip}`).digest('hex').slice(0, 32);
}

/** 按字符数截断，避免把 emoji 的代理对切成半个字符 */
function clamp(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

/** 清洗用户输入：统一换行、去掉控制字符、压掉过多空行 */
function cleanText(raw: unknown, max: number): string {
  const text = typeof raw === 'string' ? raw : '';
  return clamp(
    text
      .replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
      .replace(/\n{4,}/g, '\n\n\n')
      .replace(/[ \t]+$/gm, '')
      .trim(),
    max
  );
}

export type FailReason = 'empty' | 'too-long' | 'bad-request';

export interface ValidatedMessage {
  ok: boolean;
  reason?: FailReason;
  nickname: string | null;
  body: string;
}

export function validateMessage(nicknameRaw: unknown, bodyRaw: unknown): ValidatedMessage {
  const nickname = cleanText(nicknameRaw, LIMITS.nickname);
  const body = cleanText(bodyRaw, LIMITS.body + 1);

  if (body.length === 0) return { ok: false, reason: 'empty', nickname: null, body: '' };
  if (Array.from(body).length > LIMITS.body) {
    return { ok: false, reason: 'too-long', nickname: null, body: '' };
  }

  return { ok: true, nickname: nickname.length > 0 ? nickname : null, body };
}

export interface CreateInput {
  kind: EntryKind;
  nickname: string | null;
  body: string;
  status: EntryStatus;
  ipHash?: string | null;
}

export function createEntry(input: CreateInput): number {
  const info = getDb()
    .prepare(
      `insert into entries (kind, nickname, body, created_at, status, ip_hash)
       values (?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.kind,
      input.nickname,
      input.body,
      new Date().toISOString(),
      input.status,
      input.ipHash ?? null
    );

  return Number(info.lastInsertRowid);
}

interface Row {
  id: number | bigint;
  kind: string;
  nickname: string | null;
  body: string;
  created_at: string;
  status: string;
}

function mapRow(row: unknown): Entry {
  const r = row as Row;
  return {
    id: Number(r.id),
    kind: r.kind as EntryKind,
    nickname: r.nickname,
    body: r.body,
    createdAt: r.created_at,
    status: r.status as EntryStatus,
  };
}

/** 留言墙：已公开的留言 + 公开的日记，最新的在前 */
export function listFeed(limit: number = LIMITS.feed): Entry[] {
  const rows = getDb()
    .prepare(
      `select id, kind, nickname, body, created_at, status
         from entries
        where status = 'published'
        order by created_at desc, id desc
        limit ?`
    )
    .all(limit);
  return rows.map(mapRow);
}

/** 待审核队列：先来的先处理 */
export function listPending(): Entry[] {
  const rows = getDb()
    .prepare(
      `select id, kind, nickname, body, created_at, status
         from entries
        where status = 'pending'
        order by created_at asc, id asc`
    )
    .all();
  return rows.map(mapRow);
}

/** 管理页用：最近的全部条目，含私密日记和已拒绝的 */
export function listRecent(limit = 30): Entry[] {
  const rows = getDb()
    .prepare(
      `select id, kind, nickname, body, created_at, status
         from entries
        order by created_at desc, id desc
        limit ?`
    )
    .all(limit);
  return rows.map(mapRow);
}

/** 限流：同一 IP 哈希在最近一小时内是否已超限 */
export function isRateLimited(ipHash: string): boolean {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const row = getDb()
    .prepare(`select count(*) as n from entries where ip_hash = ? and created_at > ?`)
    .get(ipHash, since) as { n: number | bigint } | undefined;

  return Number(row?.n ?? 0) >= LIMITS.perHour;
}

export function setStatus(id: number, status: EntryStatus): void {
  getDb().prepare(`update entries set status = ? where id = ?`).run(status, id);
}

export function removeEntry(id: number): void {
  getDb().prepare(`delete from entries where id = ?`).run(id);
}

export interface Stats {
  published: number;
  pending: number;
  private: number;
  total: number;
}

export function stats(): Stats {
  const rows = getDb().prepare(`select status, count(*) as n from entries group by status`).all() as Array<{
    status: string;
    n: number | bigint;
  }>;

  const out: Stats = { published: 0, pending: 0, private: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    out.total += n;
    if (row.status in out) out[row.status as keyof Stats] = n;
  }
  return out;
}
