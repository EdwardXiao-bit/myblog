import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// 上线前把这里换成你的真实域名，或者设置 SITE_URL 环境变量。
// 它会影响：canonical 链接、分享卡片、RSS、sitemap、robots.txt。
const SITE_URL = process.env.SITE_URL || 'https://example.com';

export default defineConfig({
  site: SITE_URL,

  // 适配器只为「留言板 / 管理页」存在。
  // output 保持默认的 'static'：首页、项目、活动都构建成纯静态文件，
  // 只有显式写了 `export const prerender = false` 的页面走服务端渲染。
  adapter: node({ mode: 'standalone' }),

  // sitemap 由 src/pages/sitemap.xml.ts 预渲染生成。
  // 不用 @astrojs/sitemap：它在 build:done 阶段写文件，进不了 standalone 的资产清单，
  // 线上会被 404（robots.txt 却指着它）。
});
