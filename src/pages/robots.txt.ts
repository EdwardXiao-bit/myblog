import type { APIRoute } from 'astro';
import { absoluteUrl } from '../lib/site-url';

/**
 * robots.txt 也用端点生成，这样 Sitemap 地址会跟着 astro.config 里的 site 自动变，
 * 不需要上线前手动改一个写死的域名。
 */
export const GET: APIRoute = ({ site: siteUrl }) => {
  const body = [
    'User-agent: *',
    'Allow: /',
    // 管理页和接口不该被搜索引擎收录
    'Disallow: /admin',
    'Disallow: /api/',
    '',
    `Sitemap: ${absoluteUrl(siteUrl, '/sitemap-index.xml')}`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
};
