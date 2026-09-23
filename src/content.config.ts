import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

/**
 * 内容集合定义。
 * 每个集合对应 src/content/ 下的一个目录，目录里的 Markdown 会被自动读取并做类型校验。
 * 字段写错、漏写必填项，构建时会直接报错并告诉你是哪个文件。
 */

// 项目：一篇 Markdown 一个项目
const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: z.object({
    title: z.string(),
    /** 一句话简介，显示在卡片上 */
    summary: z.string(),
    /** 项目链接（线上地址或仓库），留空则卡片不可点 */
    href: z.string().url().optional(),
    /** 标签，例如 ['TypeScript', 'Web'] */
    tags: z.array(z.string()).default([]),
    /** 年份或时间段，仅用于展示 */
    period: z.string().optional(),
    /** 排序权重，数字越小越靠前 */
    order: z.number().default(100),
  }),
});

// 活动：一个活动一个目录，目录里有 index.md 和照片
const activities = defineCollection({
  loader: glob({ pattern: '**/index.md', base: './src/content/activities' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      /** 活动日期，写成 2024-08-17 这种格式即可 */
      date: z.coerce.date(),
      location: z.string().optional(),
      /** 列表页显示的一句话 */
      summary: z.string().optional(),
      /** 封面图：写 ./cover.jpg（相对于 index.md 所在的目录） */
      cover: image().optional(),
      /** 照片组，写 ['./photo-1.jpg', './photo-2.jpg'] */
      photos: z.array(image()).default([]),
      /** 排序权重，数字越小越靠前 */
      order: z.number().default(100),
    }),
});

export const collections = { projects, activities };
