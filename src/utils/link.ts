/**
 * 链接归一化。
 *
 * 起因：socials 里写 `{ label: 'Email', href: '1062355602@qq.com' }` 时，
 * 少了 `mailto:` 就会被浏览器当成站内相对路径，变成一个 404 的死链接。
 * 与其要求每个人记住前缀，不如在这里补上。
 */

const HAS_PROTOCOL = /^[a-z][a-z0-9+.-]*:/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeHref(href: string): string {
  const value = (href ?? '').trim();
  if (value.length === 0) return '';

  // 已经有 mailto: / https: 之类的协议，原样返回
  if (HAS_PROTOCOL.test(value)) return value;

  // 协议相对地址（//example.com）和站内路径（/projects、#anchor）
  if (value.startsWith('//') || value.startsWith('/') || value.startsWith('#')) return value;

  // 光秃秃的邮箱地址，补上 mailto:
  if (EMAIL.test(value)) return `mailto:${value}`;

  return value;
}

/** 是否该在新标签页打开：站外 http(s) 链接才是 */
export function isExternal(href: string): boolean {
  return /^https?:\/\//i.test(normalizeHref(href));
}
