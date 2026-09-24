import type { APIRoute } from 'astro';
import { adminCookie, checkPassword, issueToken, verifyToken } from '../../lib/auth';
import {
  addAttachment,
  addReply,
  createEntry,
  removeEntry,
  removeReply,
  setStatus,
  validateMessage,
  validateReply,
} from '../../lib/guestbook';
import { ALLOWED_MIME, MAX_IMAGES_PER_ENTRY, MAX_IMAGE_BYTES, removeImage, saveImage } from '../../lib/storage';

export const prerender = false;

const back = (path: string, m?: string) =>
  new Response(null, { status: 303, headers: { Location: m ? `${path}?m=${m}` : path } });

/** formData 里挑出真正有内容的文件 */
function pickFiles(form: FormData): File[] {
  return form
    .getAll('images')
    .filter((item): item is File => typeof item === 'object' && 'size' in item && item.size > 0);
}

export const POST: APIRoute = async ({ request, cookies, url }) => {
  // 同源校验：管理动作都靠 cookie 认证，必须挡住跨站提交
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '');

  // ---- 登录（唯一不需要已登录的动作）----
  if (action === 'login') {
    const password = String(form.get('password') ?? '');
    if (!checkPassword(password)) return back('/admin', 'bad-password');

    cookies.set(adminCookie.name, issueToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: adminCookie.maxAge,
      // 走 HTTPS 时加上 Secure，防止凭证在明文连接上被带出去。
      // 本机是 http，这一项为空，不影响开发。
      secure: url.protocol === 'https:',
    });
    return back('/admin', 'signed-in');
  }

  // ---- 以下动作都要求已登录 ----
  if (!verifyToken(cookies.get(adminCookie.name)?.value)) return back('/admin', 'need-auth');

  if (action === 'logout') {
    cookies.delete(adminCookie.name, { path: '/' });
    return back('/admin');
  }

  if (action === 'diary') {
    const visibility = String(form.get('visibility') ?? 'public');
    const { ok, reason, body } = validateMessage(null, form.get('body'));
    if (!ok) return back('/admin', reason === 'too-long' ? 'too-long' : 'empty');
    if (body.trim().length === 0) return back('/admin', 'empty');

    createEntry({
      kind: 'diary',
      nickname: null,
      body,
      status: visibility === 'private' ? 'private' : 'published',
    });
    return back('/admin', visibility === 'private' ? 'diary-private' : 'diary-public');
  }

  // ---- 回复：和留言一样支持表情与配图；每次提交都是追加一条新回复 ----
  if (action === 'reply') {
    const id = Number(form.get('id') ?? 0);
    if (!Number.isInteger(id) || id <= 0) return back('/admin', 'bad-request');

    const body = validateReply(form.get('body'));
    const files = pickFiles(form);

    if (files.length > MAX_IMAGES_PER_ENTRY) return back('/admin', 'too-many-images');
    for (const file of files) {
      if (!ALLOWED_MIME.includes(file.type)) return back('/admin', 'bad-image');
      if (file.size > MAX_IMAGE_BYTES) return back('/admin', 'image-too-large');
    }

    if (body.length === 0 && files.length === 0) return back('/admin', 'empty');

    const stored = [];
    try {
      for (const file of files) {
        stored.push(await saveImage(Buffer.from(await file.arrayBuffer()), file.type));
      }
    } catch {
      for (const image of stored) removeImage(image.path);
      return back('/admin', 'bad-image');
    }

    const replyId = addReply(id, body);
    for (const image of stored) addAttachment(replyId, image);

    return back('/admin', 'replied');
  }

  if (action === 'unreply') {
    const id = Number(form.get('id') ?? 0);
    if (!Number.isInteger(id) || id <= 0) return back('/admin', 'bad-request');

    // 先拿到附件路径，删完记录再把磁盘文件也清掉，避免留下孤儿图片
    const paths = removeReply(id);
    for (const path of paths) removeImage(path);

    return back('/admin', 'replied');
  }

  if (action === 'moderate') {
    const id = Number(form.get('id') ?? 0);
    const op = String(form.get('op') ?? '');
    if (!Number.isInteger(id) || id <= 0) return back('/admin', 'bad-request');

    if (op === 'approve') setStatus(id, 'published');
    else if (op === 'reject') setStatus(id, 'rejected');
    else if (op === 'delete') {
      // 删除主内容时会连它的回复一起删，图片文件也一并清掉
      const paths = removeEntry(id);
      for (const path of paths) removeImage(path);
    } else return back('/admin', 'bad-request');

    return back('/admin', 'done');
  }

  return back('/admin', 'bad-request');
};
