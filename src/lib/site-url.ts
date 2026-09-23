/** 从 Astro.site 取出用于显示的域名，拿不到就返回空串 */
export function hostOf(siteUrl: URL | undefined): string {
  if (!siteUrl) return '';
  try {
    return new URL(siteUrl).host;
  } catch {
    return '';
  }
}

/** 把路径拼成绝对地址，RSS 和分享卡片要求绝对 URL */
export function absoluteUrl(siteUrl: URL | undefined, path: string): string {
  const base = siteUrl ?? new URL('https://example.com');
  return new URL(path, base).href;
}
