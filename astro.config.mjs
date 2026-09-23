import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';

// 上线前把这里换成你的真实域名，或者设置 SITE_URL 环境变量。
// 它会影响：canonical 链接、分享卡片、RSS、sitemap、robots.txt。
const SITE_URL = process.env.SITE_URL || 'https://example.com';

export default defineConfig({
  site: SITE_URL,

  // 适配器只为「留言板 / 管理页」存在。
  // output 保持默认的 'static'：首页、项目、活动都构建成纯静态文件，
  // 只有显式写了 `export const prerender = false` 的页面走服务端渲染。
  adapter: node({ mode: 'standalone' }),

  integrations: [
    sitemap({
      // 留言板是服务端渲染的，自动扫描扫不到，手动加进去
      customPages: [new URL('/guestbook/', SITE_URL).href],
      // 管理页不对外，不收录
      filter: (page) => !page.includes('/admin'),
    }),
  ],
});
