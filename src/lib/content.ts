import type { ImageMetadata } from 'astro';
import { getDb } from './db';

/**
 * 站点内容的运行时覆盖层。
 *
 * 项目 / 活动本来是从 src/content 的 Markdown 里构建出来的静态内容，
 * 运行镜像里没有 src，也没有构建器，所以在后台改不动它们。
 * 这里用一张 SQLite 表存三样东西：
 *
 *   - kind='project' / 'activity' 且 slug 指向现有 Markdown 的 id → 覆盖那一条
 *   - kind='project' / 'activity' 且 slug 为 null → 后台新建的条目
 *   - kind='deck' → 首屏相片堆（默认那几张写在 index.astro 里，后台一加就整组替换）
 *
 * 页面在请求时读这张表，和构建期的静态内容合并渲染；删掉覆盖行就回到静态版本。
 */

export type ContentKind = 'project' | 'activity' | 'deck';
export type ContentStatus = 'published' | 'hidden';
export type CoverFit = 'cover' | 'contain';

export interface ContentRow {
  id: number;
  kind: ContentKind;
  slug: string | null;
  title: string;
  summary: string | null;
  body: string | null;
  href: string | null;
  tags: string[];
  period: string | null;
  date: string | null;
  location: string | null;
  cover: string | null;
  coverAlt: string | null;
  coverFit: CoverFit;
  photos: string[];
  captions: string[];
  order: number;
  status: ContentStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SaveInput {
  id?: number;
  kind: ContentKind;
  slug?: string | null;
  title: string;
  summary?: string | null;
  body?: string | null;
  href?: string | null;
  tags?: string[];
  period?: string | null;
  date?: string | null;
  location?: string | null;
  cover?: string | null;
  coverAlt?: string | null;
  coverFit?: CoverFit;
  photos?: string[];
  captions?: string[];
  order?: number;
  status?: ContentStatus;
}

const SCHEMA = `
create table if not exists content_items (
  id          integer primary key autoincrement,
  kind        text not null,                      -- project | activity | deck
  slug        text,                               -- 覆盖现有 Markdown 时填它的 id；新建条目为 null
  title       text not null default '',
  summary     text,
  body        text,
  href        text,
  tags        text not null default '[]',
  period      text,
  date        text,                               -- YYYY-MM-DD
  location    text,
  cover       text,                               -- 图片路径：/uploads/... 或 /_astro/...
  cover_alt   text,
  cover_fit   text not null default 'cover',      -- cover | contain
  photos      text not null default '[]',
  captions    text not null default '[]',
  sort        integer not null default 100,
  status      text not null default 'published',  -- published | hidden
  created_at  text not null,
  updated_at  text not null
);
create unique index if not exists idx_content_slug on content_items (kind, slug) where slug is not null;
create index if not exists idx_content_kind on content_items (kind, sort);
`;

let ready = false;

function db() {
  const handle = getDb();
  if (!ready) {
    handle.exec(SCHEMA);
    ready = true;
  }
  return handle;
}

const jsonList = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  // 保留空串：相册题注要和图片按下标对应，中间那张没写题注也不能把后面的往前挪
  return value
    .filter((item) => item !== null && item !== undefined)
    .map((item) => String(item));
};

const parseList = (raw: unknown): string[] => {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [];
  } catch {
    return [];
  }
};

type Row = Record<string, unknown>;

function toRow(raw: Row): ContentRow {
  const kind = String(raw.kind);
  return {
    id: Number(raw.id),
    kind: (kind === 'project' || kind === 'activity' || kind === 'deck' ? kind : 'project') as ContentKind,
    slug: raw.slug === null || raw.slug === undefined ? null : String(raw.slug),
    title: String(raw.title ?? ''),
    summary: raw.summary === null ? null : String(raw.summary),
    body: raw.body === null ? null : String(raw.body),
    href: raw.href === null ? null : String(raw.href),
    tags: parseList(raw.tags),
    period: raw.period === null ? null : String(raw.period),
    date: raw.date === null ? null : String(raw.date),
    location: raw.location === null ? null : String(raw.location),
    cover: raw.cover === null ? null : String(raw.cover),
    coverAlt: raw.cover_alt === null ? null : String(raw.cover_alt),
    coverFit: raw.cover_fit === 'contain' ? 'contain' : 'cover',
    photos: parseList(raw.photos),
    captions: parseList(raw.captions),
    order: Number(raw.sort ?? 100),
    status: raw.status === 'hidden' ? 'hidden' : 'published',
    createdAt: String(raw.created_at ?? ''),
    updatedAt: String(raw.updated_at ?? ''),
  };
}

export function listContent(kind: ContentKind, options: { includeHidden?: boolean } = {}): ContentRow[] {
  const where = options.includeHidden ? 'kind = ?' : "kind = ? and status = 'published'";
  const rows = db()
    .prepare(`select * from content_items where ${where} order by sort asc, id asc`)
    .all(kind) as Row[];
  return rows.map(toRow);
}

export function getContent(id: number): ContentRow | null {
  const row = db().prepare('select * from content_items where id = ?').get(id) as Row | undefined;
  return row ? toRow(row) : null;
}

export function getOverride(kind: ContentKind, slug: string): ContentRow | null {
  const row = db()
    .prepare('select * from content_items where kind = ? and slug = ? limit 1')
    .get(kind, slug) as Row | undefined;
  return row ? toRow(row) : null;
}

/** 三张表的覆盖行按 slug 建索引，页面合并时直接用 */
export function overridesBySlug(kind: ContentKind): Map<string, ContentRow> {
  const map = new Map<string, ContentRow>();
  for (const row of listContent(kind, { includeHidden: true })) {
    if (row.slug) map.set(row.slug, row);
  }
  return map;
}

export function saveContent(input: SaveInput): number {
  const now = new Date().toISOString();
  const values = {
    kind: input.kind,
    slug: input.slug?.trim() ? input.slug.trim() : null,
    title: input.title.trim(),
    summary: input.summary?.trim() ? input.summary.trim() : null,
    body: input.body?.trim() ? input.body.trim() : null,
    href: input.href?.trim() ? input.href.trim() : null,
    tags: JSON.stringify(jsonList(input.tags ?? [])),
    period: input.period?.trim() ? input.period.trim() : null,
    date: input.date?.trim() ? input.date.trim() : null,
    location: input.location?.trim() ? input.location.trim() : null,
    cover: input.cover?.trim() ? input.cover.trim() : null,
    cover_alt: input.coverAlt?.trim() ? input.coverAlt.trim() : null,
    cover_fit: input.coverFit === 'contain' ? 'contain' : 'cover',
    photos: JSON.stringify(jsonList(input.photos ?? [])),
    captions: JSON.stringify(jsonList(input.captions ?? [])),
    sort: Number.isFinite(input.order) ? Number(input.order) : 100,
    status: input.status === 'hidden' ? 'hidden' : 'published',
    updated_at: now,
  };

  const handle = db();

  if (input.id) {
    handle
      .prepare(
        `update content_items set kind=?, slug=?, title=?, summary=?, body=?, href=?, tags=?, period=?,
           date=?, location=?, cover=?, cover_alt=?, cover_fit=?, photos=?, captions=?, sort=?, status=?, updated_at=?
         where id = ?`,
      )
      .run(
        values.kind,
        values.slug,
        values.title,
        values.summary,
        values.body,
        values.href,
        values.tags,
        values.period,
        values.date,
        values.location,
        values.cover,
        values.cover_alt,
        values.cover_fit,
        values.photos,
        values.captions,
        values.sort,
        values.status,
        values.updated_at,
        input.id,
      );
    return input.id;
  }

  // 同一个 (kind, slug) 只允许一条：覆盖现有条目时直接改那一行
  if (values.slug) {
    const existing = getOverride(input.kind, values.slug);
    if (existing) return saveContent({ ...input, id: existing.id });
  }

  const info = handle
    .prepare(
      `insert into content_items
        (kind, slug, title, summary, body, href, tags, period, date, location, cover, cover_alt, cover_fit, photos, captions, sort, status, created_at, updated_at)
       values (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      values.kind,
      values.slug,
      values.title,
      values.summary,
      values.body,
      values.href,
      values.tags,
      values.period,
      values.date,
      values.location,
      values.cover,
      values.cover_alt,
      values.cover_fit,
      values.photos,
      values.captions,
      values.sort,
      values.status,
      now,
      values.updated_at,
    );
  return Number(info.lastInsertRowid);
}

export function deleteContent(id: number): void {
  db().prepare('delete from content_items where id = ?').run(id);
}

export function contentCounts(): { projects: number; activities: number; deck: number } {
  const counts = { projects: 0, activities: 0, deck: 0 };
  const rows = db()
    .prepare('select kind, count(*) as n from content_items group by kind')
    .all() as Array<{ kind: string; n: number }>;
  for (const row of rows) {
    if (row.kind === 'project') counts.projects = Number(row.n);
    if (row.kind === 'activity') counts.activities = Number(row.n);
    if (row.kind === 'deck') counts.deck = Number(row.n);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// 合并：页面把 Markdown 条目映射成下面这些「视图」，再套用覆盖行
// ---------------------------------------------------------------------------

export interface ProjectView {
  id: string;
  title: string;
  summary: string;
  href?: string;
  tags: string[];
  period?: string;
  cover: ImageMetadata | string | null;
  coverAlt?: string;
  coverFit: CoverFit;
  order: number;
  /** 是不是后台新建的（没有对应的 Markdown） */
  custom?: boolean;
}

export interface ActivityView {
  id: string;
  title: string;
  date: Date;
  location?: string;
  summary?: string;
  cover: ImageMetadata | string | null;
  photos: Array<ImageMetadata | string>;
  captions: string[];
  order: number;
  body?: string | null;
  custom?: boolean;
}

export function applyProject(row: ContentRow, base: ProjectView): ProjectView {
  return {
    ...base,
    title: row.title || base.title,
    summary: row.summary ?? base.summary,
    href: row.href ?? base.href,
    tags: row.tags.length > 0 ? row.tags : base.tags,
    period: row.period ?? base.period,
    cover: row.cover ?? base.cover,
    coverAlt: row.coverAlt ?? base.coverAlt,
    coverFit: row.cover ? row.coverFit : base.coverFit,
    order: row.order,
    custom: base.custom ?? false,
  };
}

export function rowToProject(row: ContentRow): ProjectView {
  return {
    id: row.slug ?? `custom-${row.id}`,
    title: row.title,
    summary: row.summary ?? '',
    href: row.href ?? undefined,
    tags: row.tags,
    period: row.period ?? undefined,
    cover: row.cover,
    coverAlt: row.coverAlt ?? undefined,
    coverFit: row.coverFit,
    order: row.order,
    custom: true,
  };
}

/**
 * 内容日期统一按 UTC 零点解析：YAML 里的日期也是 UTC 零点，formatDate 又按 UTC 输出。
 * 这里若按 +08:00 解析，东八区会显示成前一天。
 */
export function parseActivityDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

export function applyActivity(row: ContentRow, base: ActivityView): ActivityView {
  const date = row.date ? parseActivityDate(row.date) : base.date;
  return {
    ...base,
    title: row.title || base.title,
    date: Number.isNaN(date.getTime()) ? base.date : date,
    location: row.location ?? base.location,
    summary: row.summary ?? base.summary,
    cover: row.cover ?? base.cover,
    photos: row.photos.length > 0 ? row.photos : base.photos,
    captions: row.captions.length > 0 ? row.captions : base.captions,
    order: row.order,
    body: row.body ?? base.body ?? null,
    custom: base.custom ?? false,
  };
}

export function rowToActivity(row: ContentRow): ActivityView {
  const date = row.date ? parseActivityDate(row.date) : new Date();
  return {
    id: row.slug ?? `custom-${row.id}`,
    title: row.title,
    date: Number.isNaN(date.getTime()) ? new Date() : date,
    location: row.location ?? undefined,
    summary: row.summary ?? undefined,
    cover: row.cover,
    photos: row.photos,
    captions: row.captions,
    order: row.order,
    body: row.body ?? null,
    custom: true,
  };
}

export interface DeckView {
  src: ImageMetadata | string;
  alt: string;
  caption: string;
  href: string;
}

/** 相片堆：后台加过任何一张，就整组用后台的；否则回落到首屏里写死的默认几张 */
export function deckFromRows(fallback: DeckView[]): DeckView[] {
  const rows = listContent('deck');
  if (rows.length === 0) return fallback;
  return rows
    .filter((row) => row.cover)
    .map((row) => ({
      src: row.cover as string,
      alt: row.coverAlt ?? row.title ?? '',
      caption: row.title || row.summary || '',
      href: row.href ?? '/projects',
    }));
}
