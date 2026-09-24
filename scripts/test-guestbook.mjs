// 留言板端到端测试：对着真实运行的服务器发请求，并直接读数据库核对结果。
// 不靠"页面看起来对"来判断——每一条断言都要么查库、要么查真实响应。
//
// 前置：
//   1) npm run build
//   2) 起两个服务器（审核开 / 审核关）：
//        $env:GUESTBOOK_DB='data/test-guestbook.db'; $env:PORT='4322'; node dist/server/entry.mjs
//        $env:GUESTBOOK_DB='data/test-open.db'; $env:MODERATION='off'; $env:PORT='4323'; node dist/server/entry.mjs
//   3) node scripts/test-guestbook.mjs
//
// 服务器进程会带上 GUESTBOOK_DB，而脚本读的是同一个文件（WAL 模式支持并发读）。

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { DatabaseSync } from 'node:sqlite';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4322';
const OPEN_BASE = process.argv[3] ?? 'http://127.0.0.1:4323';
const DB = 'data/test-guestbook.db';
const OPEN_DB = 'data/test-open.db';

// ---------- 读 .env 拿密码（不打印出来）----------
const env = Object.fromEntries(
  readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

// ---------- 断言框架 ----------
let passed = 0;
let failed = 0;

function ok(name, detail = '') {
  passed++;
  console.log(`  ok   ${name}${detail ? '  — ' + detail : ''}`);
}

function bad(name, detail = '') {
  failed++;
  console.log(`  FAIL ${name}${detail ? '  — ' + detail : ''}`);
}

function check(name, cond, detail = '') {
  cond ? ok(name, detail) : bad(name, detail);
}

function section(title) {
  console.log(`\n${title}`);
}

// ---------- 工具 ----------
// 数据库是服务器收到第一个请求时才建的，所以这里必须懒打开。
// 用读写连接：限流测试需要"把时间往前拨"，即把已有记录的时间改老。
let _db;
const db = () => (_db ??= new DatabaseSync(DB));
let _openDb;
const openDb = () => (_openDb ??= new DatabaseSync(OPEN_DB));

/** 把所有记录的时间改成 2 小时前 —— 等价于"过了一小时窗口"，用来重置限流 */
function ageOut() {
  const old = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  db().exec(`update entries set created_at = '${old}'`);
}

/** 提交表单，默认模拟"页面加载后等了几秒才提交"的正常用户 */
async function post(base, path, fields, { cookie, origin, tsOffset = -5000 } = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(fields)) body.append(k, String(v));
  if (!('ts' in fields) && tsOffset !== null) body.append('ts', String(Date.now() + tsOffset));

  const headers = {
    'content-type': 'application/x-www-form-urlencoded',
    origin: origin ?? base,
  };
  if (cookie) headers.cookie = cookie;

  return fetch(base + path, { method: 'POST', body, headers, redirect: 'manual' });
}

const locationOf = (res) => res.headers.get('location') ?? '';
const codeOf = (res) => new URL(locationOf(res), 'http://x').searchParams.get('m');

const get = (base, path, cookie) =>
  fetch(base + path, { headers: cookie ? { cookie } : {}, redirect: 'manual' });

const bodyOf = async (res) => res.text();

function count(sql, ...params) {
  return Number(db().prepare(sql).get(...params)?.n ?? 0);
}

function findEntry(text) {
  return db().prepare('select * from entries where body = ?').get(text);
}

// ============================================================
section('1. 留言板页面');
{
  const res = await get(BASE, '/guestbook');
  const html = await bodyOf(res);
  check('GET /guestbook 返回 200', res.status === 200, `status=${res.status}`);
  check('包含表单', html.includes('gb-form'));
  check('包含蜜罐字段', html.includes('name="website"'));
  check('提示会审核', html.includes('审核'));
}

section('2. 正常留言 → 进入待审核队列');
{
  // 上一步的请求已经让服务器建好了库，这里清空历史数据，保证测试可以反复跑
  db().exec('delete from entries');
  check('测试库已重置', count('select count(*) as n from entries') === 0);

  const BODY = '你好，这是一条测试留言';
  const res = await post(BASE, '/api/guestbook', { nickname: '小明', body: BODY });
  check('返回 303 重定向', res.status === 303, `status=${res.status}`);
  check('提示待审核', codeOf(res) === 'pending', `m=${codeOf(res)}`);

  const row = findEntry(BODY);
  check('已写入数据库', Boolean(row));
  check('状态是 pending', row?.status === 'pending', `status=${row?.status}`);
  check('昵称已保存', row?.nickname === '小明');
  check('只存 IP 哈希，不存明文', typeof row?.ip_hash === 'string' && row.ip_hash.length === 32);

  const html = await bodyOf(await get(BASE, '/guestbook'));
  check('未审核前不出现在留言墙', !html.includes(BODY));
}

section('3. 匿名留言（昵称留空）');
{
  const BODY = '匿名路过，留个脚印';
  await post(BASE, '/api/guestbook', { nickname: '', body: BODY });
  const row = findEntry(BODY);
  check('昵称存为 null', row?.nickname === null, `nickname=${JSON.stringify(row?.nickname)}`);
}

section('4. 蜜罐：机器人填了隐藏字段 → 静默丢弃');
{
  const before = count('select count(*) as n from entries');
  const BODY = '我是机器人发的垃圾';
  const res = await post(BASE, '/api/guestbook', {
    nickname: 'spam',
    body: BODY,
    website: 'http://spam.example',
  });
  check('对外仍回 303（不暴露被识破）', res.status === 303);
  check('提示为 ok 而非报错', codeOf(res) === 'ok', `m=${codeOf(res)}`);
  check('数据库没有新增', count('select count(*) as n from entries') === before);
  check('内容确实没入库', !findEntry(BODY));
}

section('5. 提交过快 → 当机器人丢弃');
{
  const before = count('select count(*) as n from entries');
  const BODY = '手速飞快提交';
  await post(BASE, '/api/guestbook', { nickname: '', body: BODY }, { tsOffset: 0 });
  check('数据库没有新增', count('select count(*) as n from entries') === before);
  check('内容确实没入库', !findEntry(BODY));
}

section('6. 内容校验');
{
  const before = count('select count(*) as n from entries');

  const empty = await post(BASE, '/api/guestbook', { nickname: '', body: '   ' });
  check('空内容被拒', codeOf(empty) === 'empty', `m=${codeOf(empty)}`);

  const long = await post(BASE, '/api/guestbook', { nickname: '', body: 'x'.repeat(1200) });
  check('超长内容被拒', codeOf(long) === 'too-long', `m=${codeOf(long)}`);

  check('两条都没入库', count('select count(*) as n from entries') === before);
}

section('7. 限流：同一来源每小时最多 5 条');
{
  // 前面的用例也占用了同一来源的配额，先把时间拨回去，从干净状态开始
  ageOut();

  const results = [];
  for (let i = 0; i < 5; i++) {
    results.push(codeOf(await post(BASE, '/api/guestbook', { nickname: '', body: `限流测试 ${i}` })));
  }
  check('前 5 条都放行', results.every((m) => m === 'pending'), results.join(','));

  const over = await post(BASE, '/api/guestbook', { nickname: '', body: '第六条应该被拦下' });
  check('第 6 条被限流', codeOf(over) === 'rate', `m=${codeOf(over)}`);
  check('超限内容未入库', !findEntry('第六条应该被拦下'));

  // 时间窗口滑过之后应该恢复
  ageOut();
  const after = await post(BASE, '/api/guestbook', { nickname: '', body: '窗口滑过后又能发了' });
  check('一小时窗口滑过后恢复', codeOf(after) === 'pending', `m=${codeOf(after)}`);
}

section('8. 跨站来源被拒');
{
  const res = await post(BASE, '/api/admin', { action: 'login', password: 'x' }, {
    origin: 'http://evil.example',
  });
  check('异地来源返回 403', res.status === 403, `status=${res.status}`);
}

section('9. 管理页登录');
{
  const res = await get(BASE, '/admin');
  const html = await bodyOf(res);
  check('未登录时显示密码表单', html.includes('type="password"'));
  check('未登录时看不到待审核列表', !html.includes('待审核 '));

  const wrong = await post(BASE, '/api/admin', { action: 'login', password: 'definitely-wrong' });
  check('密码错误被拒', codeOf(wrong) === 'bad-password', `m=${codeOf(wrong)}`);
  check('密码错误不发 cookie', !wrong.headers.get('set-cookie'));
}

// 登录成功，拿到 cookie 供后续用例使用
let COOKIE = '';
{
  const res = await post(BASE, '/api/admin', { action: 'login', password: env.ADMIN_PASSWORD });
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get('set-cookie') ?? '';
  COOKIE = raw.split(';')[0];
  check('密码正确登录成功', codeOf(res) === 'signed-in', `m=${codeOf(res)}`);
  check('拿到 gb_admin cookie', COOKIE.startsWith('gb_admin='));
  check('cookie 是 HttpOnly', /httponly/i.test(raw), raw.split(';').slice(1).join(';').trim());
}

{
  const html = await bodyOf(await get(BASE, '/admin', COOKIE));
  check('登录后显示仪表盘', html.includes('写日记'));
  check('登录后能看到待审核区', html.includes('待审核'));
}

section('10. 写日记');
{
  const PUBLIC_DIARY = '今天把留言板做完了，心情不错。';
  const res = await post(BASE, '/api/admin', { action: 'diary', body: PUBLIC_DIARY, visibility: 'public' }, { cookie: COOKIE });
  check('公开日记保存成功', codeOf(res) === 'diary-public', `m=${codeOf(res)}`);

  const row = findEntry(PUBLIC_DIARY);
  check('日记 kind 正确', row?.kind === 'diary', `kind=${row?.kind}`);
  check('日记状态为 published', row?.status === 'published');

  const html = await bodyOf(await get(BASE, '/guestbook'));
  check('公开日记出现在留言墙', html.includes(PUBLIC_DIARY));
  check('带「日记」标记', html.includes('日记'));

  const PRIVATE_DIARY = '这条只想自己看，别人不该看到。';
  await post(BASE, '/api/admin', { action: 'diary', body: PRIVATE_DIARY, visibility: 'private' }, { cookie: COOKIE });
  const prow = findEntry(PRIVATE_DIARY);
  check('私密日记状态为 private', prow?.status === 'private', `status=${prow?.status}`);
  const pub = await bodyOf(await get(BASE, '/guestbook'));
  check('私密日记不出现在留言墙', !pub.includes(PRIVATE_DIARY));
}

section('10b. RSS 订阅');
{
  const res = await get(BASE, '/rss.xml');
  const xml = await bodyOf(res);
  check('RSS 可访问', res.status === 200, `status=${res.status}`);
  check('是合法 XML 声明', xml.startsWith('<?xml'));
  check('含 rss 根节点', xml.includes('<rss'));
  check('声明了语言', xml.includes('<language>zh-cn</language>'));

  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)];
  check('有订阅条目', items.length > 0, `${items.length} 条`);

  // 这是隐私边界：公开的内容要进订阅，标记为"仅自己"的绝不能进
  check('公开日记进了订阅', xml.includes('今天把留言板做完了'));
  check('私密日记没有泄漏进订阅', !xml.includes('这条只想自己看'));

  const hasCategory = /<category>日记<\/category>/.test(xml);
  check('日记条目带分类标记', hasCategory);

  // 别人的留言属于别人的内容，不该混进你的订阅
  check('他人留言没有混进订阅', !xml.includes('你好，这是一条测试留言'));
}

section('11. 审核：通过 / 拒绝 / 删除');
{
  ageOut(); // 释放限流配额

  const XSS = '<script>alert(1)</script>';
  await post(BASE, '/api/guestbook', { nickname: '攻击者', body: XSS });
  const target = findEntry(XSS);
  check('含脚本的留言已入库', Boolean(target));

  const approve = await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: COOKIE },
    body: new URLSearchParams({ action: 'moderate', id: String(target.id), op: 'approve' }),
    redirect: 'manual',
  });
  check('审核通过请求成功', codeOf(approve) === 'done', `m=${codeOf(approve)}`);
  check('状态变为 published', findEntry(XSS)?.status === 'published');

  const html = await bodyOf(await get(BASE, '/guestbook'));
  check('审核后出现在留言墙', html.includes('alert(1)'));
  check('脚本被转义，没有真的注入', !html.includes('<script>alert(1)</script>') && html.includes('&lt;script&gt;'));

  const REJECT_ME = '这条应该被拒绝';
  await post(BASE, '/api/guestbook', { nickname: '', body: REJECT_ME });
  const rejTarget = findEntry(REJECT_ME);
  await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: COOKIE },
    body: new URLSearchParams({ action: 'moderate', id: String(rejTarget.id), op: 'reject' }),
    redirect: 'manual',
  });
  check('拒绝后状态为 rejected', findEntry(REJECT_ME)?.status === 'rejected');
  const html2 = await bodyOf(await get(BASE, '/guestbook'));
  check('被拒绝的不显示', !html2.includes(REJECT_ME));

  const DEL_ME = '这条会被删掉';
  await post(BASE, '/api/guestbook', { nickname: '', body: DEL_ME });
  const delTarget = findEntry(DEL_ME);
  await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: COOKIE },
    body: new URLSearchParams({ action: 'moderate', id: String(delTarget.id), op: 'delete' }),
    redirect: 'manual',
  });
  check('删除后记录消失', !findEntry(DEL_ME));
}

section('12. 未登录不能执行管理动作');
{
  const res = await post(BASE, '/api/admin', { action: 'diary', body: '偷偷发一条', visibility: 'public' });
  check('无 cookie 被拦', codeOf(res) === 'need-auth', `m=${codeOf(res)}`);
  check('内容未入库', !findEntry('偷偷发一条'));
}

section('13. MODERATION=off：提交即公开（另一个实例）');
{
  const BODY = '审核关闭时这条应该立刻可见';
  const res = await post(OPEN_BASE, '/api/guestbook', { nickname: '路人', body: BODY });
  check('提示为 ok 而非 pending', codeOf(res) === 'ok', `m=${codeOf(res)}`);

  const row = openDb().prepare('select * from entries where body = ?').get(BODY);
  check('状态直接是 published', row?.status === 'published', `status=${row?.status}`);

  const html = await bodyOf(await get(OPEN_BASE, '/guestbook'));
  check('立刻出现在留言墙', html.includes(BODY));
}

// ============================================================
section('14. 日记的署名与标签');
{
  const DIARY = '今天把留言板做完了，心情不错。'; // 第 10 节建的公开日记
  const html = await bodyOf(await get(BASE, '/guestbook'));

  check('日记带「站主日记」标签', html.includes('站主日记'));

  // 标签前面应该是站主名，而不是「匿名」
  const around = html.slice(Math.max(0, html.indexOf('站主日记') - 200), html.indexOf('站主日记'));
  check('日记署名不是匿名', !around.includes('匿名'), around.slice(-60).trim());

  check('日记正文正常显示', html.includes(DIARY));
}

section('15. 时间显示到分钟且用本地时区');
{
  const html = await bodyOf(await get(BASE, '/guestbook'));

  // 形如 2026年9月23日 23:44
  const stamped = /(\d{4})年(\d{1,2})月(\d{1,2})日\s+(\d{2}):(\d{2})/.test(html);
  check('时间精确到分钟', stamped);

  // 本地时间（UTC+8）应当和 UTC 显示不同——凌晨发的留言最容易暴露时区错误。
  // 注意只查「可见文字」：<time datetime="..."> 属性里本来就该是 UTC 的机器可读时间，
  // 在整页 HTML 里搜字符串会把它一起算进去，那是标准写法，不是 bug。
  const visible = html.replace(/<[^>]*>/g, ' ');
  const row = db().prepare("select created_at from entries where status='published' limit 1").get();
  if (row) {
    const d = new Date(row.created_at);
    const localMinutes = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const utcMinutes = String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
    if (localMinutes === utcMinutes) {
      check('时间用本地时区', true, `本机与 UTC 恰好相同（${localMinutes}），无法区分`);
    } else {
      check(
        '可见文字用本地时区而非 UTC',
        visible.includes(localMinutes) && !visible.includes(utcMinutes),
        `本地 ${localMinutes} / UTC ${utcMinutes}`
      );
    }
  }
}

section('16. 图片上传');
{
  const sharp = createRequire(import.meta.url)('sharp');
  const png = await sharp({
    create: { width: 120, height: 80, channels: 3, background: '#2f6f62' },
  })
    .png()
    .toBuffer();

  const before = count('select count(*) as n from attachments');

  const form = new FormData();
  form.append('nickname', '带图的访客');
  form.append('body', '这是我传的图');
  form.append('ts', String(Date.now() - 5000));
  form.append('images', new Blob([png], { type: 'image/png' }), 'test.png');

  const res = await fetch(BASE + '/api/guestbook', {
    method: 'POST',
    body: form,
    headers: { origin: BASE },
    redirect: 'manual',
  });
  check('带图提交成功', res.status === 303, `status=${res.status}`);

  const after = count('select count(*) as n from attachments');
  check('附件记录已写入', after === before + 1, `${before} -> ${after}`);

  const att = db().prepare('select * from attachments order by id desc limit 1').get();
  check('存的是 webp 相对路径', String(att?.path ?? '').endsWith('.webp'), String(att?.path));
  check('记录了尺寸', Number(att?.width) > 0 && Number(att?.height) > 0, `${att?.width}x${att?.height}`);

  // 图片本身要取得回来
  const img = await fetch(`${BASE}/uploads/${att.path}`);
  check('上传的图片可访问', img.status === 200, `status=${img.status}`);
  check('返回的 content-type 正确', (img.headers.get('content-type') ?? '').includes('image/webp'));

  // 目录穿越防护
  const evil = await fetch(`${BASE}/uploads/../../package.json`);
  check('拒绝目录穿越', evil.status !== 200, `status=${evil.status}`);

  // 审核通过后页面上应该出现这张图
  const approve = await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: COOKIE },
    body: new URLSearchParams({ action: 'moderate', id: String(att.entry_id), op: 'approve' }),
    redirect: 'manual',
  });
  check('含图留言可审核', codeOf(approve) === 'done');

  const html = await bodyOf(await get(BASE, '/guestbook'));
  check('审核后页面里出现该图片', html.includes(`/uploads/${att.path}`));
}

section('17. 点赞');
{
  const target = db().prepare("select id from entries where status='published' order by id limit 1").get();
  const id = Number(target.id);

  const before = count('select count(*) as n from likes where entry_id = ?', id);

  const first = await fetch(BASE + '/api/like', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, accept: 'application/json' },
    body: new URLSearchParams({ id: String(id) }),
  });
  const payload = await first.json();
  check('点赞返回 JSON', first.status === 200 && typeof payload.count === 'number', JSON.stringify(payload));
  check('计数增加了', payload.count === before + 1, `${before} -> ${payload.count}`);
  check('标记为我点过', payload.liked === true);

  // 同一个来源再点一次不该重复计数
  const second = await fetch(BASE + '/api/like', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, accept: 'application/json' },
    body: new URLSearchParams({ id: String(id) }),
  });
  const again = await second.json();
  check('重复点赞不重复计数', again.count === payload.count, `${payload.count} -> ${again.count}`);

  // 未审核的不允许点赞
  const pendingRow = db().prepare("select id from entries where status='pending' limit 1").get();
  if (pendingRow) {
    const beforePending = count('select count(*) as n from likes where entry_id = ?', Number(pendingRow.id));
    await fetch(BASE + '/api/like', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, accept: 'application/json' },
      body: new URLSearchParams({ id: String(pendingRow.id) }),
    });
    check(
      '未审核的留言点不了赞',
      count('select count(*) as n from likes where entry_id = ?', Number(pendingRow.id)) === beforePending
    );
  }

  const html = await bodyOf(await get(BASE, '/guestbook'));
  check('页面上有点赞按钮和计数', html.includes('like-count') && html.includes(`value="${id}"`));
}

section('18. 站主回复');
{
  const target = db().prepare("select id from entries where status='published' order by id limit 1").get();
  const id = Number(target.id);
  const REPLY = '谢谢，常来玩！';

  // 未登录不能回复
  await post(BASE, '/api/admin', { action: 'reply', id: String(id), body: '偷偷回复' });
  check('未登录回复被拒', !db().prepare('select reply from entries where id = ?').get(id)?.reply);

  const form = new URLSearchParams({ action: 'reply', id: String(id), body: REPLY });
  const res = await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: COOKIE },
    body: form,
    redirect: 'manual',
  });
  check('登录后可以回复', codeOf(res) === 'replied', `m=${codeOf(res)}`);

  const row = db().prepare('select reply, replied_at from entries where id = ?').get(id);
  check('回复已入库', row?.reply === REPLY);
  check('记录了回复时间', Boolean(row?.replied_at));

  const html = await bodyOf(await get(BASE, '/guestbook'));
  check('留言板上能看到回复', html.includes(REPLY));
  check('回复带站主标记', html.includes('回复'));

  // 删除回复
  await fetch(BASE + '/api/admin', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', origin: BASE, cookie: COOKIE },
    body: new URLSearchParams({ action: 'unreply', id: String(id) }),
    redirect: 'manual',
  });
  check('可以删除回复', !db().prepare('select reply from entries where id = ?').get(id)?.reply);
}

// ---------- 汇总 ----------
console.log(`\n${'='.repeat(46)}`);
console.log(`通过 ${passed} 项，失败 ${failed} 项`);
process.exit(failed ? 1 : 0);
