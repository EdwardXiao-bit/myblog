import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

// 上线前把这里换成你的真实域名，或者设置 SITE_URL 环境变量。
// 它会影响：canonical 链接、分享卡片、RSS、sitemap、robots.txt。
const SITE_URL = process.env.SITE_URL || 'https://example.com';

export default defineConfig({
  site: SITE_URL,

  // 线上由 Caddy 终止 TLS，再以 http 反代给容器。
  // 不声明 allowedDomains 时，Astro 把 request.url 当成 http://…，
  // 于是浏览器 Origin(https://…) 与它不匹配，所有表单 POST 都会被同源校验挡成 403。
  // 声明域名后 Astro 才信任 Caddy 发来的 X-Forwarded-Proto/Host，request.url 恢复成 https。
  // 各写接口本身仍各自校验 Origin/Host，这里只补“真实协议”这一环。
  security: {
    allowedDomains: [
      { hostname: 'edwardxiao.space', protocol: 'https' },
      { hostname: 'www.edwardxiao.space', protocol: 'https' },
    ],
  },

  // 适配器只为「留言板 / 管理页」存在。
  // output 保持默认的 'static'：首页、项目、活动都构建成纯静态文件，
  // 只有显式写了 `export const prerender = false` 的页面走服务端渲染。
  adapter: node({ mode: 'standalone' }),

  // sitemap 由 src/pages/sitemap.xml.ts 预渲染生成。
  // 不用 @astrojs/sitemap：它在 build:done 阶段写文件，进不了 standalone 的资产清单，
  // 线上会被 404（robots.txt 却指着它）。
});
