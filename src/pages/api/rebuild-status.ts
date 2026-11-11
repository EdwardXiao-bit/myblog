import type { APIRoute } from 'astro';
import { adminConfigured, adminCookie, verifyToken } from '../../lib/auth';
import { rebuildState } from '../../lib/rebuild';

export const prerender = false;

/**
 * 重建进度：后台保存内容后轮询这里，构建完成（ok=true）就刷新页面。
 * 只要登录态，不返回数据库内容，日志尾巴用于失败时排查。
 */
export const GET: APIRoute = ({ cookies }) => {
  if (!adminConfigured() || !verifyToken(cookies.get(adminCookie.name)?.value)) {
    return new Response(JSON.stringify({ error: 'need-auth' }), {
      status: 401,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    });
  }

  return new Response(JSON.stringify(rebuildState()), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
};
