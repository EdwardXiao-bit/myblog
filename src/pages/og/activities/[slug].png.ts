import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { renderCard } from '../../../lib/og';
import { hostOf } from '../../../lib/site-url';
import { formatDate } from '../../../utils/format';

/**
 * 每场活动一张分享卡片 → /og/activities/<slug>.png
 * 构建时为每场活动各生成一张。
 */
export async function getStaticPaths() {
  const activities = await getCollection('activities');
  return activities.map((activity) => ({
    params: { slug: activity.id },
    props: { activity },
  }));
}

export const GET: APIRoute = async ({ props, site: siteUrl }) => {
  const { activity } = props as { activity: { data: { title: string; summary?: string; date: Date; location?: string } } };
  const { title, summary, date, location } = activity.data;

  const png = await renderCard({
    eyebrow: [formatDate(date), location].filter(Boolean).join(' · '),
    title,
    subtitle: summary,
    footer: hostOf(siteUrl),
  });

  return new Response(png, {
    headers: {
      'content-type': 'image/png',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
