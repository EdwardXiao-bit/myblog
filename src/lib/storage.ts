import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import { loadEnvOnce } from './env';

/**
 * 图片存储。
 *
 * 现在落在本地磁盘（data/uploads/年/月/随机名.webp）。
 * 以后换到对象存储（S3 / 阿里云 OSS 等）时，**只需要改这个文件**：
 * 把 saveImage / readImage / removeImage 三个函数换成调用 SDK 即可，
 * 上层（留言业务、接口、页面）不用动——它们只认这里返回的相对路径。
 */

/** 单张图片的大小上限（字节） */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 一条留言最多带几张图 */
export const MAX_IMAGES_PER_ENTRY = 3;
/** 长边超过这个像素就等比缩小 */
const MAX_EDGE = 1600;

export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export interface StoredImage {
  /** 相对 uploads 根目录的路径，用 / 分隔，存进数据库 */
  path: string;
  width: number;
  height: number;
  bytes: number;
  /** 服务端返回给浏览器时的 content-type */
  mime: string;
}

export function uploadRoot(): string {
  loadEnvOnce();
  return resolve(process.cwd(), process.env.UPLOAD_DIR || 'data/uploads');
}

/**
 * 把相对路径还原成绝对路径。
 * 防目录穿越：解析之后必须仍在 uploads 根目录内，否则视为非法。
 */
function safeResolve(relativePath: string): string | null {
  const root = uploadRoot();
  const abs = resolve(root, relativePath);
  if (abs !== root && !abs.startsWith(root + sep)) return null;
  return abs;
}

function randomName(ext: string): string {
  const now = new Date();
  const folder = join(String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'));
  return join(folder, `${randomBytes(9).toString('hex')}${ext}`).split(sep).join('/');
}

/**
 * 保存一张上传的图片。
 * - jpeg / png / webp：等比缩到长边 1600 以内，转成 WebP，并丢掉 EXIF
 *   （原图的 EXIF 可能带拍摄地点，不该跟着留言一起公开）
 * - gif：原样保存，否则动图会变成静图
 */
export async function saveImage(input: Buffer, mime: string): Promise<StoredImage> {
  if (mime === 'image/gif') {
    const rel = randomName('.gif');
    const abs = join(uploadRoot(), rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, input);

    const meta = await sharp(input, { animated: true }).metadata();
    return {
      path: rel,
      width: meta.width ?? 0,
      height: meta.pageHeight ?? meta.height ?? 0,
      bytes: input.length,
      mime: 'image/gif',
    };
  }

  const result = await sharp(input, { failOn: 'none' })
    .rotate() // 按 EXIF 方向摆正，之后 metadata 被丢弃
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer({ resolveWithObject: true });

  const rel = randomName('.webp');
  const abs = join(uploadRoot(), rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, result.data);

  return {
    path: rel,
    width: result.info.width,
    height: result.info.height,
    bytes: result.data.length,
    mime: 'image/webp',
  };
}

export interface LoadedImage {
  data: Buffer;
  mime: string;
}

export function readImage(relativePath: string): LoadedImage | null {
  const abs = safeResolve(relativePath);
  if (!abs || !existsSync(abs)) return null;

  const mime = abs.endsWith('.gif') ? 'image/gif' : 'image/webp';
  return { data: readFileSync(abs), mime };
}

export function removeImage(relativePath: string): void {
  const abs = safeResolve(relativePath);
  if (!abs) return;
  try {
    rmSync(abs, { force: true });
  } catch {
    // 文件可能已经被删掉了，忽略
  }
}
