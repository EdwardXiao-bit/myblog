/**
 * 生产环境冒烟：对着「真正跑起来的服务器」验，不是对着 dev。
 *
 *   node scripts/smoke-prod.mjs http://127.0.0.1:4321          # 只读，安全
 *   node scripts/smoke-prod.mjs https://你的域名 --write        # 额外测写链路（会写一条再删掉）
 *
 * 默认只读：不向站点写任何数据，可以放心对着线上跑。
 * 加 --write 才测「提交留言 -> 落库 -> 清理」，且必须能直接读到 data/guestbook.db
 * （也就是只能在服务器本机跑，别在本地对着线上跑这一项）。
 *
 * 设计说明（都是踩过坑总结的）：
 *  1. 校验失败返回的是 303 + ?m=reason，不是 4xx —— 断言要看 Location。
 *  2. 跨站 / 缺 Origin 由 Astro 自带的 checkOrigin 拦截，返回 403，
 *     在业务代码之前。所以别再断言 303。
 *  3. 非表单请求（JSON）不应产生 500 —— 曾经是，四个接口都补了 try/catch。
 */
import { DatabaseSync } from 'node:sqlite';

const BASE = (process.argv[2] || 'http://127.0.0.1:4321').replace(/\/$/, '');
const WRITE = process.argv.includes('--write');
const HOST = BASE.replace(/^https?:\/\//, '');
const SAME = `${BASE.startsWith('https') ? 'https' : 'http'}://${HOST}`;

let pass = 0;
let fail = 0;
const failed = [];
const ok = (cond, label, extra = '') => {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    failed.push(label);
    console.log(`  ✗ ${label}${extra ? '  ' + extra : ''}`);
  }
};

const dbCount = () => {
  const db = new DatabaseSync('data/guestbook.db');
  const n = db.prepare('select count(*) n from entries').get().n;
  db.close();
  return n;
};

async function postForm(fields, { origin = SAME } = {}) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  const headers = origin === null ? {} : { origin };
  const r = await fetch(`${BASE}/api/guestbook`, {
    method: 'POST',
    headers,
    body: fd,
    redirect: 'manual',
  });
  const loc = r.headers.get('location') || '';
  return { status: r.status, m: loc ? new URL(loc, BASE).searchParams.get('m') : null };
}

console.log(`\n生产冒烟：${BASE}${WRITE ? '（含写链路）' : '（只读）'}`);

// ---- 1. 页面与端点 ----
console.log('\n[1] 页面与端点');
const pages = ['/', '/projects', '/activities', '/guestbook', '/rss.xml', '/robots.txt',
               '/sitemap-index.xml', '/og.png'];
for (const p of pages) {
  try {
    const r = await fetch(BASE + p, { redirect: 'manual' });
    ok(r.status === 200, `GET ${p} -> 200`, `实得 ${r.status}`);
  } catch (e) {
    ok(false, `GET ${p}`, e.message);
  }
}

// ---- 2. 活动详情页 + 图片产物 ----
console.log('\n[2] 活动详情页 + 图片产物');
const activities = await (await fetch(`${BASE}/activities`)).text();
const slugs = [...activities.matchAll(/\/activities\/([a-z0-9-]+)/g)].map((m) => m[1]);
const uniq = [...new Set(slugs)];
ok(uniq.length > 0, `活动列表页解析出 ${uniq.length} 个活动`);
let webp = null;
for (const s of uniq) {
  const r = await fetch(`${BASE}/activities/${s}`);
  ok(r.status === 200, `GET /activities/${s} -> 200`, `实得 ${r.status}`);
  if (r.status === 200 && !webp) {
    const m = (await r.text()).match(/\/_astro\/[A-Za-z0-9._-]+\.webp/);
    if (m) webp = m[0];
  }
}
if (webp) {
  const r = await fetch(BASE + webp);
  const ct = r.headers.get('content-type') || '';
  ok(r.status === 200 && ct.includes('webp'), `图片产物可访问（${ct}）`);
} else {
  ok(false, '活动页里找到 _astro/*.webp 引用');
}

// ---- 3. 构建期 SITE_URL ----
console.log('\n[3] 构建期 SITE_URL 是否真的写进产物');
const home = await (await fetch(`${BASE}/`)).text();
const siteUrl = (home.match(/<link[^>]+rel="canonical"[^>]+href="([^"]+)"/) || [])[1] || '';
ok(!!siteUrl, `canonical 存在：${siteUrl}`);
ok(!siteUrl.includes('example.com'), 'canonical 不是占位的 example.com（构建时传了 SITE_URL）');
if (siteUrl) {
  const origin = new URL(siteUrl).origin;
  const rss = await (await fetch(`${BASE}/rss.xml`)).text();
  ok(rss.includes(origin), 'RSS 里的链接与 canonical 同源');
  const sm = await (await fetch(`${BASE}/sitemap-index.xml`)).text();
  ok(sm.includes(origin), 'sitemap 里的链接与 canonical 同源');
}
const rb = await (await fetch(`${BASE}/robots.txt`)).text();
ok(rb.includes('Disallow: /admin'), 'robots.txt 屏蔽 /admin');
ok(rb.includes('Disallow: /api/'), 'robots.txt 屏蔽 /api/');

// ---- 4. 留言板 ----
console.log('\n[4] 留言板');
const gb = await (await fetch(`${BASE}/guestbook`)).text();
ok(gb.includes('guestbook') || gb.includes('留言'), '留言板页面正常返回内容');

// ---- 5. 反爬与同源 ----
console.log('\n[5] 反爬与同源');
ok((await postForm({ body: '   ' })).m === 'empty', '纯空白 -> empty');
ok((await postForm({ body: 'x'.repeat(1500) })).m === 'too-long', '超长正文 -> too-long');
ok((await postForm({ body: 'fast', ts: String(Date.now()) })).m === 'ok', '提交过快 -> 静默 ok');
ok((await postForm({ body: 'spam', website: 'http://spam' })).m === 'ok', '蜜罐命中 -> 静默 ok');
const cross = await postForm({ body: 'cross' }, { origin: 'https://evil.example' });
ok(cross.status === 403, '跨站 Origin -> 403', `实得 ${cross.status}`);
const noOrigin = await postForm({ body: 'x' }, { origin: null });
ok(noOrigin.status === 403, '缺 Origin -> 403', `实得 ${noOrigin.status}`);

// ---- 6. 非表单请求不应 500 ----
console.log('\n[6] 畸形请求不应产生 500');
for (const [name, path] of [['guestbook', '/api/guestbook'], ['like', '/api/like'],
                            ['react', '/api/react'], ['admin', '/api/admin']]) {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: SAME },
    body: JSON.stringify({ body: 'json' }),
    redirect: 'manual',
  });
  ok(r.status !== 500, `${name}: JSON 请求不是 500`, `实得 ${r.status}`);
}

// ---- 7. 写链路（需 --write，且必须在服务器本机）----
if (WRITE) {
  console.log('\n[7] 写链路（提交 -> 落库 -> 清理）');
  const before = dbCount();
  const happy = await postForm({
    body: 'smoke-prod entry',
    nickname: 'smoke',
    ts: String(Date.now() - 5000),
  });
  ok(['pending', 'ok'].includes(happy.m), `正常提交 -> ${happy.m}`, `实得 ${happy.m}`);
  ok(dbCount() === before + 1, `落库 +1（${before} -> ${dbCount()}）`);
  const db = new DatabaseSync('data/guestbook.db');
  const row = db.prepare('select id, kind, nickname, body, status from entries order by id desc limit 1').get();
  ok(row.body === 'smoke-prod entry' && row.nickname === 'smoke',
     `落库内容正确：#${row.id} ${row.status}`);
  db.exec(`delete from entries where id = ${row.id}`);
  db.exec("delete from sqlite_sequence where name='entries'");
  db.close();
  ok(dbCount() === before, `测试数据已清理（回到 ${before} 条）`);
} else {
  console.log('\n[7] 写链路：已跳过（加 --write 并在服务器本机运行）');
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
if (fail) {
  console.log('失败项：');
  failed.forEach((f) => console.log('  - ' + f));
}
process.exit(fail ? 1 : 0);
