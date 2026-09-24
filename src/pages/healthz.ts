import type { APIRoute } from 'astro';
import { getDb } from '../lib/db';

/**
 * 健康检查。给两处用：
 *   1. 容器 healthcheck / 反向代理探活
 *   2. 外部可用性监控（例如 Uptime Kuma、Cloudflare Health Checks）
 *
 * 特意去读一次数据库：这样「进程活着但数据库打不开」也能被发现——
 * 只回 200 的探活等于没探。
 */
export const prerender = false;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

export const GET: APIRoute = () => {
  try {
    const entries = getDb().prepare('select count(*) as n from entries').get() as { n: number };
    return json({
      ok: true,
      entries: entries.n,
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 503);
  }
};
