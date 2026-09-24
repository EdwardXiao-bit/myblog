import { createHash } from 'node:crypto';
import { getDb } from './db';
import { loadEnvOnce } from './env';

/**
 * 留言板 / 日记 / 回复的全部业务逻辑。
 *
 * 设计取舍：
 *  - 谁都能留言，昵称留空就是匿名（不要求登录，也不收集邮箱）
 *  - IP 只存哈希，用来限流与点赞去重，不存明文
 *  - 审核开关默认开：留言先进待审核队列
 *  - 点赞不需要登录，同一来源对同一条只能点一次
 *  - **回复也是一条 entry**（kind='reply' + parent_id），所以配图、点赞、时间全都复用
 */

export type EntryKind = 'message' | 'diary' | 'reply';
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
  /** 回复才有：指向被回复的那条内容 */
  parentId: number | null;
  nickname: string | null;
  body: string;
  createdAt: string;
  status: EntryStatus;
  attachments: Attachment[];
  likeCount: number;
  /** 只有在查询时传了 ipHash 才有意义 */
  likedByMe: boolean;
  /** 挂在它下面的回复（回复自身不再嵌套） */
  replies: Entry[];
}

export const LIMITS = {
  nickname: 24,
  body: 1000,
  /** 站主回复的长度上限 */
  reply: 1000,
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

  if (Array.from(body).length > LIMITS.body) {
    return { ok: false, reason: 'too-long', nickname: null, body: '' };
  }

  return { ok: true, nickname: nickname.length > 0 ? nickname : null, body };
}

/** 站主回复的正文清洗（不需要昵称） */
export function validateReply(raw: unknown): string {
  return cleanText(raw, LIMITS.reply);
}

/** 正文和附件都为空才算无效 */
export function isEmptyMessage(body: string, attachmentCount: number): boolean {
  return body.trim().length === 0 && attachmentCount === 0;
}

export interface CreateInput {
  kind: EntryKind;
  parentId?: number | null;
  nickname: string | null;
  body: string;
  status: EntryStatus;
  ipHash?: string | null;
}

export function createEntry(input: CreateInput): number {
  const info = getDb()
    .prepare(
      `insert into entries (kind, parent_id, nickname, body, created_at, status, ip_hash)
       values (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      input.kind,
      input.parentId ?? null,
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
  parent_id: number | bigint | null;
  nickname: string | null;
  body: string;
  created_at: string;
  status: string;
}

const SELECT_COLUMNS = `id, kind, parent_id, nickname, body, created_at, status`;

/** 把一组 id 交给 sql 的 in (...) 用 */
function placeholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * 批量补齐附件、点赞数、我点过没，以及（顶层内容）挂在下面的回复。
 * 一次查完，避免每条留言各查一次库（N+1）。
 */
function hydrate(rows: unknown[], ipHash?: string | null, withReplies = false): Entry[] {
  const entries: Entry[] = rows.map((raw) => {
    const r = raw as Row;
    return {
      id: Number(r.id),
      kind: r.kind as EntryKind,
      parentId: r.parent_id === null ? null : Number(r.parent_id),
      nickname: r.nickname,
      body: r.body,
      createdAt: r.created_at,
      status: r.status as EntryStatus,
      attachments: [],
      likeCount: 0,
      likedByMe: false,
      replies: [],
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

  if (withReplies) {
    const childRows = db
      .prepare(
        `select ${SELECT_COLUMNS} from entries where parent_id in (${marks}) order by created_at asc, id asc`
      )
      .all(...ids);

    for (const child of hydrate(childRows, ipHash, false)) {
      if (child.parentId === null) continue;
      byId.get(child.parentId)?.replies.push(child);
    }
  }

  return entries;
}

/** 留言墙：已公开的留言 + 公开的日记，最新的在前 */
export function listFeed(limit: number = LIMITS.feed, ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(
      `select ${SELECT_COLUMNS} from entries
        where status = 'published' and parent_id is null
        order by created_at desc, id desc
        limit ?`
    )
    .all(limit);
  return hydrate(rows, ipHash, true);
}

/** 待审核队列：先来的先处理 */
export function listPending(ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(
      `select ${SELECT_COLUMNS} from entries
        where status = 'pending' and parent_id is null
        order by created_at asc, id asc`
    )
    .all();
  return hydrate(rows, ipHash, true);
}

/** 管理页用：最近的全部顶层内容（含私密日记和已拒绝的），回复挂在各自父级下面 */
export function listRecent(limit = 30, ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(
      `select ${SELECT_COLUMNS} from entries
        where parent_id is null
        order by created_at desc, id desc
        limit ?`
    )
    .all(limit);
  return hydrate(rows, ipHash, true);
}

export function getEntry(id: number, ipHash?: string | null): Entry | null {
  const rows = getDb().prepare(`select ${SELECT_COLUMNS} from entries where id = ?`).all(id);
  return hydrate(rows, ipHash, true)[0] ?? null;
}

/** 限流：同一 IP 哈希在最近一小时内是否已超限（只算访客留言） */
export function isRateLimited(ipHash: string): boolean {
  const since = new Date(Date.now() - RATE_WINDOW_MS).toISOString();
  const row = getDb()
    .prepare(
      `select count(*) as n from entries
        where ip_hash = ? and created_at > ? and parent_id is null`
    )
    .get(ipHash, since) as { n: number | bigint } | undefined;

  return Number(row?.n ?? 0) >= LIMITS.perHour;
}

export function setStatus(id: number, status: EntryStatus): void {
  getDb().prepare(`update entries set status = ? where id = ?`).run(status, id);
}

/** 收集一条内容及其回复名下的附件路径 */
function attachmentPathsOf(ids: number[]): string[] {
  if (ids.length === 0) return [];
  const db = getDb();
  const marks = placeholders(ids.length);
  return (
    db.prepare(`select path from attachments where entry_id in (${marks})`).all(...ids) as Array<{
      path: string;
    }>
  ).map((r) => r.path);
}

/**
 * 删除内容，连同它的回复。
 * 返回需要从磁盘删掉的附件路径（调用方负责删文件）。
 */
export function removeEntry(id: number): string[] {
  const db = getDb();

  const childIds = (
    db.prepare(`select id from entries where parent_id = ?`).all(id) as Array<{ id: number | bigint }>
  ).map((r) => Number(r.id));

  const allIds = [id, ...childIds];
  const paths = attachmentPathsOf(allIds);
  const marks = placeholders(allIds.length);

  db.prepare(`delete from attachments where entry_id in (${marks})`).run(...allIds);
  db.prepare(`delete from likes where entry_id in (${marks})`).run(...allIds);
  db.prepare(`delete from entries where id = ?`).run(id); // 回复靠外键语义手删，见下

  if (childIds.length > 0) {
    db.prepare(`delete from entries where parent_id = ?`).run(id);
  }

  return paths;
}

// ---------- 回复 ----------

/** 一条内容已有的回复（按时间正序） */
export function listRepliesOf(parentId: number, ipHash?: string | null): Entry[] {
  const rows = getDb()
    .prepare(`select ${SELECT_COLUMNS} from entries where parent_id = ? order by created_at asc, id asc`)
    .all(parentId);
  return hydrate(rows, ipHash, false);
}

/**
 * 给某条内容**追加**一条回复，返回新回复的 id。
 * 每次提交都是一条新回复（像对话一样可以连着回几条），不是覆盖。
 */
export function addReply(parentId: number, body: string): number {
  return createEntry({
    kind: 'reply',
    parentId,
    nickname: null,
    body: validateReply(body),
    status: 'published',
  });
}

/** 删除一条回复，返回它的附件路径 */
export function removeReply(replyId: number): string[] {
  return removeEntry(replyId);
}

// ---------- 点赞 ----------

/** 点一个赞；已经点过则返回 false（不重复计数） */
export function addLike(entryId: number, ipHash: string): boolean {
  const info = getDb()
    .prepare(`insert or ignore into likes (entry_id, ip_hash, created_at) values (?, ?, ?)`)
    .run(entryId, ipHash, new Date().toISOString());

  return Number(info.changes) > 0;
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

export function countAttachments(entryId: number): number {
  const row = getDb()
    .prepare(`select count(*) as n from attachments where entry_id = ?`)
    .get(entryId) as { n: number | bigint } | undefined;
  return Number(row?.n ?? 0);
}

export interface Stats {
  published: number;
  pending: number;
  private: number;
  total: number;
}

/** 统计只算留言与日记，回复不算一条「内容」 */
export function stats(): Stats {
  const rows = getDb()
    .prepare(`select status, count(*) as n from entries where kind <> 'reply' group by status`)
    .all() as Array<{ status: string; n: number | bigint }>;

  const out: Stats = { published: 0, pending: 0, private: 0, total: 0 };
  for (const row of rows) {
    const n = Number(row.n);
    out.total += n;
    if (row.status in out) out[row.status as keyof Stats] = n;
  }
  return out;
}
