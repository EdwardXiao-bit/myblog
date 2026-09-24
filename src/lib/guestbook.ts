import { createHash } from 'node:crypto';
import { getDb } from './db';
import { loadEnvOnce } from './env';

/**
 * 留言板 / 日记的全部业务逻辑。
 * 设计取舍：
 *  - 谁都能留言，昵称留空就是匿名（不要求登录，也不收集邮箱）
 *  - IP 只存哈希，用来限流与点赞去重，不存明文
 *  - 审核开关默认开：留言先进待审核队列，避免匿名留言被垃圾灌满
 *  - 点赞不需要登录，同一来源对同一条只能点一次
 */

export type EntryKind = 'message' | 'diary';
export type EntryStatus = 'pending' | 'published' | 'private' | 'rejected';

export interface Attachment {
  id: number;
  path: string;
  width: number | null;
  height: number | null;
}

export interface Entry {
  id: number;
  kind: EntryKind;
  nickname: string | null;
  body: string;
  createdAt: string;
  status: EntryStatus;
  /** 站主回复 */
  reply: string | null;
  repliedAt: string | null;
  attachments: Attachment[];
  likeCount: number;
  /** 只有在查询时传了 ipHash 才有意义 */
  likedByMe: boolean;
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

/** IP 单向哈希：用于限流与点赞去重，无法还原出原始 IP */
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

  // 只有图片没有文字的留言也允许，所以「空」的判断交给调用方结合附件一起看
  if (Array.from(body).length > LIMITS.body) {
    return { ok: false, reason: 'too-long', nickname: null, body: '' };
  }

  return { ok: true, nickname: nickname.length > 0 ? nickname : null, body };
}

/** 正文和附件都为空才算无效 */
export function isEmptyMessage(body: string, attachmentCount: number): boolean {
  return body.trim().length === 0 && attachmentCount === 0;
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
  reply: string | null;
  replied_at: string | null;
}

const SELECT_COLUMNS = `id, kind, nickname, body, created_at, status, reply, replied_at`;

/** 把一组 id 交给 sql 的 in (...) 用 */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * 批量补齐附件、点赞数、我点过没。
 * 一次查完，避免每条留言各查一次库（N+1）。
 */
function hydrate(rows: unknown[], ipHash?: string | null): Entry[] {
  const entries: Entry[] = rows.map((raw) => {
    const r = raw as Row;
    return {
      id: Number(r.id),
      kind: r.kind as EntryKind,
      nickname: r.nickname,
      body: r.body,
      createdAt: r.created_at,
      status: r.status as EntryStatus,
      reply: r.reply,
      repliedAt: r.replied_at,
      attachments: [],
      likeCount: 0,
      likedByMe: false,
    };
  });

  if (entries.length === 0) return entries;

  const db = getDb();
  const ids = entries.map((e) => e.id);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const marks = placeholders(ids.length);

  const attachments = db
    .prepare(
      `select id, entry_id, path, width, height from attachments where entry_id in (${marks}) order by id`
    )
    .all(...ids) as Array<{
    id: number | bigint;
    entry_id: number | bigint;
    path: string;
    width: number | bigint | null;
    height: number | bigint | null;
  }>;

  for (const a of attachments) {
    byId.get(Number(a.entry_id))?.attachments.push({
      id: Number(a.id),
      path: a.path,
      width: a.width === null ? null : Number(a.width),
      height: a.height === null ? null : Number(a.height),
    });
  }

  const counts = db
    .prepare(`select entry_id, count(*) as n from likes where entry_id in (${marks}) group by entry_id`)
    .all(...ids) as Array<{ entry_id: number | bigint; n: number | bigint }>;

  for (const c of counts) {
    const entry = byId.get(Number(c.entry_id));
    if (entry) entry.likeCount = Number(c.n);
  }

  if (ipHash) {
    const mine = db
      .prepare(`select entry_id from likes where entry_id in (${marks}) and ip_hash = ?`)
      .all(...ids, ipHash) as Array<{ entry_id: number | bigint }>;

    for (const m of mine) {
      const entry = byId.get(Number(m.entry_id));
      if (entry) entry.likedByMe = true;
    }
  }

  return entries;
}

/** 留言墙：已公开的留言 + 公开的日记，最新的在前 */
export function listFeed(limit: number = LIMITS.feed, ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(
      `select ${SELECT_COLUMNS} from entries
        where status = 'published'
        order by created_at desc, id desc
        limit ?`
    )
    .all(limit);
  return hydrate(rows, ipHash);
}

/** 待审核队列：先来的先处理 */
export function listPending(ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(
      `select ${SELECT_COLUMNS} from entries
        where status = 'pending'
        order by created_at asc, id asc`
    )
    .all();
  return hydrate(rows, ipHash);
}

/** 管理页用：最近的全部条目，含私密日记和已拒绝的 */
export function listRecent(limit = 30, ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(
      `select ${SELECT_COLUMNS} from entries
        order by created_at desc, id desc
        limit ?`
    )
    .all(limit);
  return hydrate(rows, ipHash);
}

export function getEntry(id: number, ipHash?: string | null): Entry | null {
  const rows = getDb()
    .prepare(`select ${SELECT_COLUMNS} from entries where id = ?`)
    .all(id);
  return hydrate(rows, ipHash)[0] ?? null;
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

/** 删除条目，返回它名下附件的路径（调用方负责把磁盘文件也删掉） */
export function removeEntry(id: number): string[] {
  const db = getDb();
  const paths = (
    db.prepare(`select path from attachments where entry_id = ?`).all(id) as Array<{ path: string }>
  ).map((r) => r.path);

  db.prepare(`delete from attachments where entry_id = ?`).run(id);
  db.prepare(`delete from likes where entry_id = ?`).run(id);
  db.prepare(`delete from entries where id = ?`).run(id);

  return paths;
}

// ---------- 点赞 ----------

/** 点一个赞；已经点过则返回 false（不重复计数） */
export function addLike(entryId: number, ipHash: string): boolean {
  const info = getDb()
    .prepare(`insert or ignore into likes (entry_id, ip_hash, created_at) values (?, ?, ?)`)
    .run(entryId, ipHash, new Date().toISOString());

  return Number(info.changes) > 0;
}

// ---------- 站主回复 ----------

export function setReply(entryId: number, text: string): void {
  const reply = clamp(text.replace(/\r\n?/g, '\n').trim(), 500);
  getDb()
    .prepare(`update entries set reply = ?, replied_at = ? where id = ?`)
    .run(reply.length > 0 ? reply : null, reply.length > 0 ? new Date().toISOString() : null, entryId);
}

export function clearReply(entryId: number): void {
  getDb().prepare(`update entries set reply = null, replied_at = null where id = ?`).run(entryId);
}

// ---------- 附件 ----------

export function addAttachment(
  entryId: number,
  file: { path: string; width: number; height: number; bytes: number }
): void {
  getDb()
    .prepare(
      `insert into attachments (entry_id, path, width, height, bytes, created_at)
       values (?, ?, ?, ?, ?, ?)`
    )
    .run(entryId, file.path, file.width, file.height, file.bytes, new Date().toISOString());
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
