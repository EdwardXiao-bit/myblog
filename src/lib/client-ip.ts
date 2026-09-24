/**
 * 取访客 IP（只用来算哈希，不存明文）。
 *
 * 为什么要单独写这个，而不是直接用 Astro 的 `clientAddress`：
 *
 *   Astro 的 node 适配器取的是 `incomingRequest.socket.remoteAddress`
 *   （见 node_modules/astro/dist/vite-plugin-app/handle-request.js），
 *   **完全不解析 X-Forwarded-For**。放在反向代理（Caddy / nginx）后面时，
 *   这个值永远是代理容器的地址，于是：
 *
 *     - 限流从「每人每小时 5 条」退化成「全站每小时 5 条」
 *     - 点赞去重键 entry_id + ip_hash 变成全局唯一，一个人点赞＝所有人都点过
 *
 *   两种情况都不会报错，只会「悄悄地不好用」——所以这里显式处理。
 *
 * 信任规则：
 *   只有 TRUST_PROXY=1 时才读 X-Forwarded-For，而且只取**最后一段**。
 *   最后一段是由本机反向代理写入的，客户端伪造不了——前提是代理用「覆盖」
 *   而不是「追加」（Caddyfile 里写了 `header_up X-Forwarded-For {http.request.remote.host}`）。
 *
 *   站点直接暴露在公网（没有反向代理）时**不要**开这个开关，
 *   否则任何人都能塞一个 X-Forwarded-For 绕过限流。
 */
export function clientIp(request: Request, socketAddress?: string): string {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = request.headers.get('x-forwarded-for');
    if (forwarded) {
      const hops = forwarded
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
      const nearest = hops[hops.length - 1];
      if (nearest) return nearest;
    }
  }
  return socketAddress ?? 'unknown';
}
