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
      // 容器内冒烟（deploy.sh 用 http://127.0.0.1:4321）是同源请求，
      // 但不在线上域名列表里就会被 checkOrigin 挡成 403，自检必然失败。
      // 这两条只影响「请求 URL 被信任成什么协议/主机」，不放开任何跨站写入。
      { hostname: '127.0.0.1', protocol: 'http' },
      { hostname: 'localhost', protocol: 'http' },
    ],
  },

  // 适配器只为「留言板 / 管理页」存在。
  // output 保持默认的 'static'：首页、项目、活动都构建成纯静态文件，
  // 只有显式写了 `export const prerender = false` 的页面走服务端渲染。
  adapter: node({ mode: 'standalone' }),

  // 后台保存内容后会在容器里重新构建（src/lib/rebuild.ts）。
  // 构建到带时间戳的 dist-build-<时间> 目录，下次启动由 scripts/serve.mjs 切过去，
  // 重建期间线上继续吃旧产物。
  // 平时不设这个变量，构建产物还是 ./dist。
  outDir: process.env.ASTRO_OUT_DIR || './dist',

  // sitemap 由 src/pages/sitemap.xml.ts 预渲染生成。
  // 不用 @astrojs/sitemap：它在 build:done 阶段写文件，进不了 standalone 的资产清单，
  // 线上会被 404（robots.txt 却指着它）。
});
