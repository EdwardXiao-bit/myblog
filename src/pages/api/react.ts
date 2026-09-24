import type { APIRoute } from 'astro';
import { getEntry, hashIp, toggleReaction } from '../../lib/guestbook';
import { isAllowedReaction } from '../../lib/reactions';

/**
 * 贴 / 取消贴一个表情反应。
 * 和点赞一样不需要登录，靠 IP 哈希去重；区别是这里可切换（再点一下取消）。
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

  const form = await request.formData();
  const id = Number(form.get('id') ?? 0);
  const emoji = String(form.get('emoji') ?? '');
  const back = safeBack(form.get('back'));

  const jump = () =>
    new Response(null, { status: 303, headers: { Location: `${back}#entry-${id}` } });

  // 表情必须来自白名单——否则等于给匿名访客开了个写任意内容的入口
  if (!Number.isInteger(id) || id <= 0 || !isAllowedReaction(emoji)) return jump();

  // 只允许给已公开的内容贴
  const entry = getEntry(id);
  if (!entry || entry.status !== 'published') return jump();

  let ip = 'unknown';
  try {
    ip = clientAddress ?? 'unknown';
  } catch {
    // 拿不到地址就退化成全局去重，宁可少算也不要多算
  }

  const ipHash = hashIp(ip);
  toggleReaction(id, emoji, ipHash);

  // 页面上的脚本会带 accept: application/json 过来，好就地重画 chip；
  // 没脚本的普通表单提交则跳回原处。
  if ((request.headers.get('accept') ?? '').includes('application/json')) {
    const updated = getEntry(id, ipHash);
    return new Response(JSON.stringify({ reactions: updated?.reactions ?? [] }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  return jump();
};

export const GET: APIRoute = () =>
  new Response('请从留言板页面贴表情。', {
    status: 405,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
