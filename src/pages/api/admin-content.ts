import type { APIRoute } from 'astro';
import { adminConfigured, adminCookie, verifyToken } from '../../lib/auth';
import { deleteContent, getContent, saveContent, type ContentKind } from '../../lib/content';
import { requestRebuild } from '../../lib/rebuild';
import { ALLOWED_MIME, MAX_IMAGE_BYTES, saveImage } from '../../lib/storage';

export const prerender = false;

const back = (path: string, m?: string) =>
  new Response(null, { status: 303, headers: { Location: m ? `${path}?m=${m}` : path } });

const KINDS: ContentKind[] = ['project', 'activity', 'deck'];

/** 后台表单提交的一张图；校验不过返回错误码 */
async function pickImage(form: FormData, key: string): Promise<{ path?: string; error?: string }> {
  const item = form.get(key);
  if (!(item instanceof File) || item.size === 0) return {};
  if (!ALLOWED_MIME.includes(item.type)) return { error: 'bad-image' };
  if (item.size > MAX_IMAGE_BYTES) return { error: 'image-too-large' };
  try {
    const stored = await saveImage(Buffer.from(await item.arrayBuffer()), item.type);
    return { path: `/uploads/${stored.path}` };
  } catch {
    return { error: 'image-failed' };
  }
}

/**
 * 相册：已存在的图由隐藏字段逐行报送（photo_src / photo_caption），
 * 这次新选的图在 photos 里，题注按选择顺序放 new_caption。
 */
async function collectPhotos(form: FormData): Promise<{ photos: string[]; captions: string[]; error?: string }> {
  const sources = form.getAll('photo_src').map((value) => String(value));
  const existingCaptions = form.getAll('photo_caption').map((value) => String(value).trim());
  const photos: string[] = [];
  const captions: string[] = [];
  sources.forEach((src, index) => {
    if (!src) return;
    photos.push(src);
    captions.push(existingCaptions[index] ?? '');
  });

  const files = form.getAll('photos').filter((value): value is File => value instanceof File && value.size > 0);
  const newCaptions = form.getAll('new_caption').map((value) => String(value).trim());
  for (const [index, file] of files.entries()) {
    if (!ALLOWED_MIME.includes(file.type)) return { photos: [], captions: [], error: 'bad-image' };
    if (file.size > MAX_IMAGE_BYTES) return { photos: [], captions: [], error: 'image-too-large' };
    try {
      const stored = await saveImage(Buffer.from(await file.arrayBuffer()), file.type);
      photos.push(`/uploads/${stored.path}`);
      captions.push(newCaptions[index] ?? '');
    } catch {
      return { photos: [], captions: [], error: 'image-failed' };
    }
  }

  return { photos, captions };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const list = (form: FormData, key: string) =>
  text(form, key)
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);

export const POST: APIRoute = async ({ request, cookies, url }) => {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return new Response('Forbidden', { status: 403 });
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }

  const action = String(form.get('action') ?? '');
  if (action !== 'login' && !verifyToken(cookies.get(adminCookie.name)?.value)) {
    return back('/admin', 'need-auth');
  }
  if (!adminConfigured()) return back('/admin', 'need-auth');

  // 手动补一次重建：自动重建失败（比如构建报错）之后，修完可以直接点按钮重试
  if (action === 'rebuild') {
    requestRebuild();
    return back('/admin/content', 'rebuilding');
  }

  const kind = String(form.get('kind') ?? '') as ContentKind;
  if (!KINDS.includes(kind)) return back('/admin/content', 'bad-kind');

  if (action === 'delete') {
    const id = Number(form.get('id'));
    if (!Number.isFinite(id) || id <= 0) return back('/admin/content', 'bad-request');
    deleteContent(id);
    // 页面是构建期产物，删完也要重建一次
    requestRebuild();
    return back('/admin/content', 'deleted');
  }

  if (action !== 'save') return back('/admin/content', 'bad-request');

  const id = Number(form.get('id')) || undefined;
  const slug = text(form, 'slug') || null;
  const title = text(form, 'title');
  if (!title) return back('/admin/content', 'empty-title');

  const cover = await pickImage(form, 'cover');
  if (cover.error) return back('/admin/content', cover.error);

  const existing = id ? getContent(id) : null;
  const previous = existing?.cover ?? null;
  const coverPath = cover.path ?? previous;  // 覆盖静态条目时封面可以留空（沿用 Markdown 里的那张），只有「凭空新建」才必须有图
  const requireCover = !id && !slug;
  if (requireCover && !coverPath) return back('/admin/content', 'need-cover');

  const gallery = await collectPhotos(form);
  if (gallery.error) return back('/admin/content', gallery.error);

  saveContent({
    id,
    kind,
    slug,
    title,
    summary: text(form, 'summary') || null,
    body: text(form, 'body') || null,
    href: text(form, 'href') || null,
    tags: list(form, 'tags'),
    period: text(form, 'period') || null,
    date: text(form, 'date') || null,
    location: text(form, 'location') || null,
    cover: coverPath,
    coverAlt: text(form, 'coverAlt') || null,
    coverFit: text(form, 'coverFit') === 'contain' ? 'contain' : 'cover',
    photos: gallery.photos,
    captions: gallery.captions,
    order: Number(text(form, 'order')) || 100,
    status: text(form, 'status') === 'hidden' ? 'hidden' : 'published',
  });

  // 保存成功：先返回 303，构建在后台跑，完成后进程退出由容器/守护脚本重启
  requestRebuild();
  return back('/admin/content', 'saved');
};
