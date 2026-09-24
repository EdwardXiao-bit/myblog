// 本机没有 Docker，所以对 compose / Caddyfile 做结构与逻辑校验（不是语法层面的糊弄）
//
// 注意：js-yaml 5.x **没有 default 导出**，只能用具名导出（4.x 也有具名导出，
// 所以 `import { load }` 对两者都成立）。写成 `import yaml from 'js-yaml'`
// 在 5.x 下会直接 SyntaxError。
import { readFileSync } from 'node:fs';
import { load } from 'js-yaml';

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`); }
};

console.log('\n[1] docker-compose.yml 能否解析为 YAML');
let cfg = null;
try {
  cfg = load(readFileSync('docker-compose.yml', 'utf8'));
  ok(true, 'YAML 解析成功');
} catch (e) {
  ok(false, 'YAML 解析', e.message);
  process.exit(1);
}

console.log('\n[2] 结构断言');
const app = cfg.services?.app;
const caddy = cfg.services?.caddy;
ok(!!app, 'services.app 存在');
ok(!!caddy, 'services.caddy 存在');

// SITE_URL 必须是构建期参数，否则 canonical/RSS/sitemap 全错
ok(!!app.build?.args?.SITE_URL, 'SITE_URL 是 build.args（构建期变量，不是运行时）');
ok(String(app.build.args.SITE_URL).includes(':?'),
   'SITE_URL 用了 :? 强制填写（没设就直接报错，不会悄悄构建出 example.com）');

// 持久化
const appVols = (app.volumes || []).map(String);
ok(appVols.some((v) => v.includes('./data:/app/data')), 'data 目录挂载为持久卷');
ok(appVols.some((v) => v.includes('./backups:/backups')), 'backups 目录挂载出来');

// 反代关键配置
ok(String(app.environment?.TRUST_PROXY) === '1', 'app 设了 TRUST_PROXY=1（否则限流全站共享）');
ok(!!app.healthcheck?.test, 'app 有 healthcheck');
ok(String(app.healthcheck.test.join(' ')).includes('/healthz'), 'healthcheck 打的是 /healthz');
ok(app.restart === 'unless-stopped', 'app 重启策略 unless-stopped');
ok(!!app.logging?.options?.['max-size'], 'app 配了日志轮转（否则磁盘会被日志吃满）');
ok(!app.ports, 'app 没有直接暴露端口（只让 Caddy 访问）');

const caddyPorts = (caddy.ports || []).map(String);
ok(caddyPorts.some((p) => p.startsWith('80:')), 'Caddy 映射 80');
ok(caddyPorts.some((p) => p.startsWith('443:')), 'Caddy 映射 443');
ok(caddy.volumes.map(String).some((v) => v.includes('Caddyfile')), 'Caddyfile 挂进容器');
// 注意：compose 里 `caddy_data:` 没有值，YAML 解析结果是 null，
// 所以只能判断「键是否存在」，不能判断真假值。
ok('caddy_data' in (cfg.volumes || {}), 'caddy_data 具名卷已声明（证书要持久化，否则每次重启都重新签）');
ok(!app.build.context || app.build.context === '.', 'build context 是项目根');

console.log('\n[3] Caddyfile 关键行');
const caddyfile = readFileSync('Caddyfile', 'utf8');
// 这一行是防「访客伪造 IP 绕过限流」的核心：必须覆盖而不是追加
ok(/header_up\s+X-Forwarded-For\s+\{http\.request\.remote\.host\}/.test(caddyfile),
   'reverse_proxy 里用 header_up **覆盖** X-Forwarded-For（追加的话客户端能伪造 IP）');
ok(caddyfile.includes('{$SITE_DOMAIN::80}'),
   '站点地址由 SITE_DOMAIN 决定，未设置时退化为 :80（IP 直连也能跑）');
ok(caddyfile.includes('admin off'), '关掉了 Caddy 管理 API');
ok(caddyfile.includes('reverse_proxy app:4321'), '反代指向 app:4321');

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
