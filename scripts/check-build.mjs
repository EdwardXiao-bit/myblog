// 构建产物自检：内容断言 + 资源/链接完整性 + 静态/SSR 边界
// 构建通过 ≠ 页面正确。这个脚本读 dist/ 里真实的产物做检查：
//   1) 关键内容是否渲染出来
//   2) HTML 里引用的每个本地资源/链接，在 dist/client 里是否真的存在（防 404）
//   3) 该静态的页面静态、该走服务端的页面没有被预渲染
// 用法：npm run build && node scripts/check-build.mjs

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const CLIENT = 'dist/client';

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name.endsWith('.html')) out.push(full);
  }
  return out;
};

let failed = 0;
const fail = (msg) => {
  failed++;
  console.log('FAIL ' + msg);
};

const pages = walk(CLIENT);
const html = new Map(pages.map((p) => [p.replace(/\\/g, '/'), readFileSync(p, 'utf8')]));

// ---------- 1) 内容断言 ----------
// 只断言「结构」和「板块存在」，不写死具体内容。
// 之前吃过的亏：断言里写死项目和名字，用户一改内容检查就红，反倒像产品坏了。
const assertions = [
  ['dist/client/index.html', ['class="hero"', 'timeline-period', 'class="chips"', 'dataset.theme']],
  ['dist/client/projects/index.html', ['我的项目', 'project-card']],
  ['dist/client/activities/index.html', ['我的活动', 'activity-list']],
];

console.log('--- 内容断言 ---');
for (const [page, needles] of assertions) {
  if (!html.has(page)) {
    fail(`缺少页面 ${page}`);
    continue;
  }
  const body = html.get(page);
  const misses = needles.filter((n) => !body.includes(n));
  if (misses.length) fail(`${page} 缺失: ${misses.join(', ')}`);
  else console.log(`OK   ${page.replace('dist/client', '')}`);
}

// ---------- 内容集合是否真的渲染出来了 ----------
console.log('\n--- 内容集合渲染 ---');
const countOf = (page, pattern) => (html.get(page)?.match(pattern) ?? []).length;

const projectCount = countOf('dist/client/projects/index.html', /class="project-card"/g);
if (projectCount > 0) console.log(`OK   项目页渲染了 ${projectCount} 张卡片`);
else fail('项目页一张卡片都没有（内容集合没被读到？）');

const activityCount = countOf('dist/client/activities/index.html', /class="activity"/g);
if (activityCount > 0) console.log(`OK   活动页渲染了 ${activityCount} 条记录`);
else fail('活动页一条记录都没有');

// 活动详情页是按内容生成的，所以动态找一个来验，不写死是哪一场
const detailPages = [...html.keys()].filter((p) =>
  /^dist\/client\/activities\/[^/]+\/index\.html$/.test(p)
);
if (detailPages.length > 0) {
  const sample = detailPages[0];
  const body = html.get(sample);
  if (body.includes('activity-detail') && body.includes('prose')) {
    console.log(`OK   活动详情页可用（共 ${detailPages.length} 个，抽查 ${sample.replace('dist/client', '')}）`);
  } else {
    fail(`${sample} 缺少详情页结构`);
  }
} else {
  fail('没有任何活动详情页');
}

console.log('\n--- 占位内容扫描 ---');
// 模板里留下的示例文案。这些不是错误，但上线前应该清掉，
// 所以只警告、不让构建失败——同时也当成内容补充进度的提醒。
const PLACEHOLDER_MARKERS = ['这里写', '写在这里', '示例项目', '你的名字', '你的职位', '改成你的'];
const leftovers = new Map();

for (const [page, body] of html) {
  for (const marker of PLACEHOLDER_MARKERS) {
    if (body.includes(marker)) {
      const key = marker;
      if (!leftovers.has(key)) leftovers.set(key, []);
      leftovers.get(key).push(page.replace('dist/client', ''));
    }
  }
}

if (leftovers.size === 0) {
  console.log('OK   没有残留的示例文案');
} else {
  const total = [...leftovers.values()].reduce((n, pages) => n + pages.length, 0);
  console.log(`WARN 还有 ${total} 处示例文案没替换（不影响构建，上线前记得清掉）：`);
  for (const [marker, pages] of leftovers) {
    console.log(`       「${marker}」→ ${[...new Set(pages)].join(', ')}`);
  }
}

// ---------- 2) 静态 / SSR 边界 ----------
console.log('\n--- 静态 / SSR 边界 ---');
const mustBeStatic = ['index.html', 'projects/index.html', 'activities/index.html'];
const mustBeSsr = ['guestbook/index.html', 'admin/index.html'];

for (const p of mustBeStatic) {
  if (existsSync(join(CLIENT, p))) console.log(`OK   ${p} 已预渲染`);
  else fail(`${p} 应该被预渲染却不存在`);
}

for (const p of mustBeSsr) {
  if (existsSync(join(CLIENT, p))) fail(`${p} 不该出现在静态产物里（含动态数据，必须走服务端）`);
  else console.log(`OK   ${p.replace('/index.html', '')} 走 SSR（未预渲染）`);
}

if (existsSync('dist/server/entry.mjs')) console.log('OK   服务端入口 dist/server/entry.mjs 存在');
else fail('缺少 dist/server/entry.mjs');

// ---------- 3) 链接与资源完整性 ----------
console.log('\n--- 本地引用完整性 ---');
const skip = /^(https?:|mailto:|tel:|data:|#|\/\/)/;

// 这些路径由服务端在运行时渲染，dist/client 里自然没有对应文件，
// 不能按「静态文件必须存在」来判定。
const ssrRoutes = ['/guestbook', '/admin', '/rss.xml'];
const isSsrRoute = (p) => p.startsWith('/api/') || ssrRoutes.some((r) => p === r || p.startsWith(r + '/'));

let refCount = 0;
let ssrCount = 0;
const broken = [];

for (const [page, body] of html) {
  const refs = new Set();
  for (const m of body.matchAll(/(?:src|href)="([^"]+)"/g)) refs.add(m[1]);

  for (const ref of refs) {
    if (skip.test(ref)) continue;
    const clean = ref.split('?')[0].split('#')[0];
    if (isSsrRoute(clean)) {
      ssrCount++;
      continue;
    }
    refCount++;
    const candidates = clean.endsWith('/')
      ? [join(CLIENT, clean, 'index.html')]
      : [join(CLIENT, clean), join(CLIENT, clean, 'index.html'), join(CLIENT, clean + '.html')];
    if (!candidates.some(existsSync)) broken.push(`${page} → ${ref}`);
  }
}

if (broken.length) for (const b of broken) fail(`断链 ${b}`);
else console.log(`OK   检查了 ${refCount} 个静态引用（另有 ${ssrCount} 个指向 SSR 路由），全部正常`);

// ---------- 4) 图片管线 ----------
console.log('\n--- 图片管线 ---');
const assetDir = join(CLIENT, '_astro');
const assets = existsSync(assetDir) ? readdirSync(assetDir) : [];
const webp = assets.filter((f) => f.endsWith('.webp'));
console.log(`OK   生成 ${webp.length} 个优化后的 webp`);
const hasSrcset = [...html.values()].some((b) => b.includes('srcset='));
console.log(`${hasSrcset ? 'OK  ' : 'FAIL'} 响应式 srcset ${hasSrcset ? '已生成' : '缺失'}`);
if (!hasSrcset) failed++;

// ---------- 5) 设计系统 ----------
// 每个页面可能有自己的样式分片，深色规则散在其中任意一个都算通过
const cssFiles = assets.filter((f) => f.endsWith('.css'));
const darkIn = cssFiles.filter((f) =>
  /\[data-theme=dark\]|\[data-theme="dark"\]/.test(readFileSync(join(assetDir, f), 'utf8'))
);
const dark = darkIn.length > 0;
console.log(
  `${dark ? 'OK  ' : 'FAIL'} 深色模式样式 ${dark ? `存在于 ${darkIn.length}/${cssFiles.length} 个样式分片` : '缺失'}`
);
if (!dark) failed++;

// ---------- 6) 布局宽度 ----------
// 全站只有一个容器宽度。曾经按页面类型分宽窄，结果导航要么和正文对不齐、
// 要么切页时横跳——两者不可能同时成立。
console.log('\n--- 布局宽度 ---');

const chromeBad = [...html.entries()]
  .filter(
    ([, body]) =>
      !body.includes('class="wrap header-inner"') ||
      !body.includes('class="wrap footer-inner"')
  )
  .map(([page]) => page);

if (chromeBad.length === 0) {
  console.log(`OK   全部 ${html.size} 个页面的头部与页脚使用同一个容器`);
} else {
  fail(`头部/页脚容器不对：${chromeBad.join(', ')}`);
}

const mainBad = [...html.entries()]
  .filter(([, body]) => !/<main class="wrap">/.test(body))
  .map(([page]) => page);

if (mainBad.length === 0) {
  console.log(`OK   全部 ${html.size} 个页面的正文与头部同宽（导航和正文左边缘对齐）`);
} else {
  fail(`正文容器与头部不一致：${mainBad.join(', ')}`);
}

// 产物 CSS 里只应剩一个宽度变量，分宽窄的残留会导致对齐再次错位
const allCss = cssFiles.map((f) => readFileSync(join(assetDir, f), 'utf8')).join('\n');
const normalizedCss = allCss.replace(/\s+/g, ' ');
const singleWidth = /--maxw:\d+px/.test(normalizedCss);
const leftoverTextWidth = normalizedCss.includes('--maxw-text');
if (singleWidth && !leftoverTextWidth) {
  console.log('OK   全站单一容器宽度，没有按页面分宽窄的残留');
} else {
  fail(`容器宽度配置不对：单一宽度=${singleWidth} 残留分宽=${leftoverTextWidth}`);
}

// ---------- 7) SEO / 分享卡片 / 订阅 ----------
console.log('\n--- SEO / 分享卡片 / 订阅 ---');

const home = html.get('dist/client/index.html') ?? '';

// 活动详情页和它的分享卡片都是按内容生成的，动态挑一个来验，不写死是哪一场
const sampleDetail = detailPages[0];
const sampleSlug = sampleDetail?.match(/^dist\/client\/activities\/([^/]+)\/index\.html$/)?.[1];
const activity = sampleDetail ? (html.get(sampleDetail) ?? '') : '';

const metaChecks = [
  ['首页有 og:image', /<meta property="og:image" content="[^"]*\/og\.png"/.test(home)],
  ['首页声明卡片尺寸', home.includes('og:image:width') && home.includes('og:image:height')],
  ['首页用大图卡样式', /twitter:card" content="summary_large_image"/.test(home)],
  ['首页有 canonical', /rel="canonical"/.test(home)],
  ['首页声明 RSS', /rel="alternate" type="application\/rss\+xml"/.test(home)],
];

if (sampleSlug) {
  metaChecks.push([
    `活动详情用自己的卡片（抽查 ${sampleSlug}）`,
    activity.includes(`/og/activities/${sampleSlug}.png`),
  ]);
  metaChecks.push(['活动详情 og:type 为 article', /og:type" content="article"/.test(activity)]);
} else {
  console.log('SKIP 没有活动详情页，跳过对应检查');
}

for (const [label, pass] of metaChecks) {
  if (pass) console.log(`OK   ${label}`);
  else fail(label);
}

// 卡片图片确实生成了
const ogActivityDir = 'dist/client/og/activities';
const activityCards = existsSync(ogActivityDir)
  ? readdirSync(ogActivityDir).filter((f) => f.endsWith('.png'))
  : [];
const cardFiles = ['dist/client/og.png', ...activityCards.map((f) => join(ogActivityDir, f))];
for (const card of cardFiles) {
  if (existsSync(card) && statSync(card).size > 5000) {
    console.log(`OK   ${card.replace('dist/client', '')} 已生成 (${Math.round(statSync(card).size / 1024)}KB)`);
  } else {
    fail(`${card} 缺失或过小`);
  }
}

// robots.txt
if (existsSync('dist/client/robots.txt')) {
  const robots = readFileSync('dist/client/robots.txt', 'utf8');
  const blocksAdmin = /Disallow: \/admin/.test(robots);
  const hasSitemap = /Sitemap: https?:\/\/\S+/.test(robots);
  if (blocksAdmin && hasSitemap) console.log('OK   robots.txt 屏蔽 /admin 并声明 sitemap');
  else fail(`robots.txt 内容不完整: ${JSON.stringify(robots)}`);
} else {
  fail('robots.txt 缺失');
}

// sitemap：应包含留言板、不含管理页
// 注意 sitemap-index.xml 只是索引，真正的 URL 在 sitemap-0.xml 等分片里，所以要把所有分片合起来看
const sitemapFiles = readdirSync(CLIENT).filter((f) => /^sitemap.*\.xml$/.test(f));
if (sitemapFiles.length > 0) {
  const xml = sitemapFiles.map((f) => readFileSync(join(CLIENT, f), 'utf8')).join('\n');
  const hasGuestbook = xml.includes('/guestbook/');
  const hasAdmin = xml.includes('/admin');
  if (hasGuestbook && !hasAdmin) {
    console.log(`OK   sitemap 含留言板、不含管理页（${sitemapFiles.join(', ')}）`);
  } else {
    fail(`sitemap 内容不对：guestbook=${hasGuestbook} admin=${hasAdmin}`);
  }
} else {
  fail('sitemap 缺失');
}

// RSS 是服务端路由，构建时按需渲染，静态产物里不该出现
if (existsSync(join(CLIENT, 'rss.xml'))) {
  fail('rss.xml 不该出现在静态产物里（日记是动态的，必须走服务端）');
} else {
  console.log('OK   rss.xml 走 SSR（未预渲染，保证日记随时更新）');
}

console.log(failed ? `\n${failed} 项失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
