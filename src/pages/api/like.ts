import type { APIRoute } from 'astro';
import { getEntry, hashIp, toggleLike } from '../../lib/guestbook';

/**
 * 点赞。
 * 不需要登录，也不需要 JS：表单直接 POST 过来，处理完跳回原处。
 * 页面上的脚本只是把它变成「不刷新页面」，没脚本也能用。
 */
export const prerender = false;

/** 只允许跳回站内路径，避免被当成开放重定向 */
function safeBack(raw: unknown): string {
  const value = typeof raw === 'string' ? raw : '';
  if (value.startsWith('/') && !value.startsWith('//')) return value;
  return '/guestbook';
}

export const POST: APIRoute = async ({ request, clientAddress }) => {
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) return new Response('Forbidden', { status: 403 });
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // 非表单请求会抛异常，不接住就是 500（机器人常这么打）
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  const id = Number(form.get('id') ?? 0);
  const back = safeBack(form.get('back'));

  if (!Number.isInteger(id) || id <= 0) {
    return new Response(null, { status: 303, headers: { Location: back } });
  }

  // 只允许给已公开的内容点赞
  const entry = getEntry(id);
  if (!entry || entry.status !== 'published') {
    return new Response(null, { status: 303, headers: { Location: back } });
  }

  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    // 拿不到地址就退化成全局去重，宁可少算也不要多算
  }

  toggleLike(id, hashIp(ip));

  // 页面上的脚本会带 accept: application/json 过来，好就地更新数字；
  // 没脚本的普通表单提交则照常跳回原处。
  if ((request.headers.get('accept') ?? '').includes('application/json')) {
    const updated = getEntry(id, hashIp(ip));
    return new Response(
      JSON.stringify({ count: updated?.likeCount ?? 0, liked: updated?.likedByMe ?? false }),
      { headers: { 'content-type': 'application/json' } }
    );
  }

  return new Response(null, { status: 303, headers: { Location: `${back}#entry-${id}` } });
};

export const GET: APIRoute = () =>
  new Response('请从留言板页面点赞。', {
    status: 405,
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
