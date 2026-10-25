import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { absoluteUrl } from '../lib/site-url';

/**
 * sitemap 用「预渲染的端点」生成，而不是 @astrojs/sitemap 集成。
 *
 * 原因：集成是在 `astro:build:done` 阶段写文件的，文件虽然落在 dist/client 里，
 * 但没有进入 @astrojs/node standalone 的静态资产清单（assets 只来自构建期 manifest），
 * 结果线上 /sitemap-index.xml 直接 404，而 robots.txt 又指着它。
 * 预渲染端点会成为真正注册过的路由，任何部署形态都能命中。
 */
export const prerender = true;

export const GET: APIRoute = async ({ site: siteUrl }) => {
  const activities = await getCollection('activities');
  const newest = activities
    .map((item) => item.data.date)
    .sort((a, b) => b.getTime() - a.getTime())[0];

  const pages = [
    { path: '/', lastmod: newest },
    { path: '/projects/', lastmod: undefined },
    { path: '/activities/', lastmod: newest },
    // 留言板是服务端渲染的，静态扫描扫不到，手动列进来
    { path: '/guestbook/', lastmod: undefined },
    ...activities.map((item) => ({
      path: `/activities/${item.id}/`,
      lastmod: item.data.date,
    })),
  ];

  const urls = pages
    .map(({ path, lastmod }) => {
      const stamp = lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : '';
      return `  <url><loc>${absoluteUrl(siteUrl, path)}</loc>${stamp}</url>`;
    })
    .join('\n');

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'application/xml; charset=utf-8' },
  });
};
