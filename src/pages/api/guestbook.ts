import type { APIRoute } from 'astro';
import {
  addAttachment,
  createEntry,
  hashIp,
  isEmptyMessage,
  isRateLimited,
  moderationOn,
  validateMessage,
} from '../../lib/guestbook';
import {
  ALLOWED_MIME,
  MAX_IMAGES_PER_ENTRY,
  MAX_IMAGE_BYTES,
  removeImage,
  saveImage,
} from '../../lib/storage';

// 需要服务端处理，所以明确退出预渲染
export const prerender = false;

/** 一律用「提交后重定向」返回，避免刷新重复提交 */
const back = (m: string) =>
  new Response(null, { status: 303, headers: { Location: `/guestbook?m=${m}` } });

/** 最快多久算正常人：页面渲染到提交之间的毫秒数 */
const MIN_FILL_MS = 1200;

export const POST: APIRoute = async ({ request, clientAddress }) => {
  // 同源校验：浏览器带的 Origin 必须和本站一致
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return back('bad-request');
    } catch {
      return back('bad-request');
    }
  }

  const form = await request.formData();

  // 蜜罐：这个字段被 CSS 藏起来了，真人看不到，机器人会老老实实填上。
  // 命中就当垃圾静默丢掉——不给提示，免得对方知道被识破了。
  if (String(form.get('website') ?? '').trim() !== '') return back('ok');

  // 提交过快也当机器人（同样的处理方式）
  const stampedAt = Number(form.get('ts') ?? 0);
  if (stampedAt > 0 && Date.now() - stampedAt < MIN_FILL_MS) return back('ok');

  const { ok, reason, nickname, body } = validateMessage(form.get('nickname'), form.get('body'));
  if (!ok) return back(reason === 'too-long' ? 'too-long' : 'empty');

  // 图片：先检查，再处理
  const files = form
    .getAll('images')
    .filter((item): item is File => typeof item === 'object' && 'size' in item && item.size > 0);

  if (files.length > MAX_IMAGES_PER_ENTRY) return back('too-many-images');

  for (const file of files) {
    if (!ALLOWED_MIME.includes(file.type)) return back('bad-image');
    if (file.size > MAX_IMAGE_BYTES) return back('image-too-large');
  }

  // 纯图片没有文字也算有效留言，两者都空才拒绝
  if (isEmptyMessage(body, files.length)) return back('empty');

  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    // 某些部署环境拿不到客户端地址，退化成不区分来源
  }

  const ipHash = hashIp(ip);
  if (isRateLimited(ipHash)) return back('rate');

  // 先把图存下来，再建条目；中途失败就把已存的图删掉，不留孤儿文件
  const stored = [];
  try {
    for (const file of files) {
      stored.push(await saveImage(Buffer.from(await file.arrayBuffer()), file.type));
    }
  } catch {
    for (const image of stored) removeImage(image.path);
    return back('bad-image');
  }

  const status = moderationOn() ? 'pending' : 'published';

  let entryId: number;
  try {
    entryId = createEntry({ kind: 'message', nickname, body, status, ipHash });
  } catch {
    for (const image of stored) removeImage(image.path);
    return back('bad-request');
  }

  for (const image of stored) addAttachment(entryId, image);

  return back(status === 'pending' ? 'pending' : 'ok');
};

// 直接 GET 这个地址只会看到一句提示，避免让人以为表单坏了
export const GET: APIRoute = () =>
  new Response('请从留言板页面提交留言。', {
    status: 405,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
