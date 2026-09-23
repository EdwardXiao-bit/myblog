import { createHmac, timingSafeEqual } from 'node:crypto';
import { loadEnvOnce } from './env';

/**
 * 管理页登录：密码来自 .env 的 ADMIN_PASSWORD。
 * 登录后往 cookie 里放一个「过期时间 + HMAC 签名」的令牌，
 * 服务端只验签名，不存 session，重启也不会把已登录的人踢下线。
 */

const COOKIE_NAME = 'gb_admin';
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12 小时

/** 密码至少要这么长才允许启用管理功能，太短等于没设 */
const MIN_PASSWORD_LENGTH = 6;

function secret(): string {
  loadEnvOnce();
  return process.env.ADMIN_PASSWORD ?? '';
}

export function adminConfigured(): boolean {
  return secret().length >= MIN_PASSWORD_LENGTH;
}

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

export function issueToken(): string {
  const expires = String(Date.now() + MAX_AGE_SECONDS * 1000);
  return `${expires}.${sign(expires)}`;
}

export function verifyToken(token: string | undefined | null): boolean {
  if (!token || !adminConfigured()) return false;

  const [expires, mac] = token.split('.');
  if (!expires || !mac) return false;
  if (Number(expires) < Date.now()) return false;

  return safeEqual(mac, sign(expires));
}

export function checkPassword(input: string): boolean {
  const expected = secret();
  if (!expected) return false;
  return safeEqual(input, expected);
}

export const adminCookie = {
  name: COOKIE_NAME,
  maxAge: MAX_AGE_SECONDS,
};
