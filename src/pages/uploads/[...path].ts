import type { APIRoute } from 'astro';
import { readImage } from '../../lib/storage';

/**
 * 提供留言上传的图片。
 *
 * 文件名是随机串（见 lib/storage.ts），猜不到；但**知道地址的人就能看**——
 * 待审核留言里的图片虽然没被任何页面引用，严格说并非访问控制。
 * 个人站这样够了；要更严就得把「已公开」也纳入判断，或改用带签名的地址。
 */
export const prerender = false;

export const GET: APIRoute = ({ params }) => {
  const relativePath = params.path ?? '';
  const image = readImage(relativePath);

  if (!image) {
    return new Response('图片不存在', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }

  return new Response(image.data, {
    headers: {
      'content-type': image.mime,
      // 文件名带随机串，内容永不改变，可以放心长期缓存
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
};
