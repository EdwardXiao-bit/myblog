import type { APIRoute } from 'astro';
import { renderCard } from '../lib/og';
import { site } from '../data/site';
import { hostOf } from '../lib/site-url';

/**
 * 站点默认分享卡片 → /og.png
 * 构建时生成（默认就是预渲染），不需要运行时算力。
 */
export const GET: APIRoute = async ({ site: siteUrl }) => {
  const png = await renderCard({
    eyebrow: site.name,
    title: site.tagline,
    subtitle: site.location || undefined,
    footer: hostOf(siteUrl),
  });

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
