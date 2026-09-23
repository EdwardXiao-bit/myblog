import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import type { APIRoute } from 'astro';
import { site } from '../data/site';
import { listFeed } from '../lib/guestbook';

// 日记是随时写的，所以这个地址每次请求现算，不做预渲染
export const prerender = false;

/** 取正文第一行当标题，太长就截断 */
function titleFromBody(body: string): string {
  const firstLine = body.split('\n').find((line) => line.trim().length > 0)?.trim() ?? '';
  return firstLine.length > 40 ? firstLine.slice(0, 40) + '…' : firstLine || '日记';
}

export const GET: APIRoute = async ({ site: siteUrl }) => {
  const activities = await getCollection('activities');
  // 只放你自己写的东西。别人的留言不属于你的内容，不往订阅里塞。
  const diaries = listFeed().filter((entry) => entry.kind === 'diary');

  const items = [
    ...activities.map((activity) => ({
      title: activity.data.title,
      pubDate: activity.data.date,
      description: activity.data.summary ?? '',
      link: `/activities/${activity.id}/`,
      categories: ['活动'],
    })),
    ...diaries.map((diary) => ({
      title: titleFromBody(diary.body),
      pubDate: new Date(diary.createdAt),
      description: diary.body,
      link: '/guestbook/',
      categories: ['日记'],
    })),
  ].sort((a, b) => b.pubDate.getTime() - a.pubDate.getTime());

  return rss({
    title: `${site.name} · 动态`,
    description: site.description,
    site: siteUrl ?? 'https://example.com',
    items,
    customData: '<language>zh-cn</language>',
  });
};
