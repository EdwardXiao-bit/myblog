// 冒烟测试：对着跑起来的 dev/preview 服务器发真实请求，确认页面能正常返回
// 用法：node scripts/smoke.mjs [baseUrl]
//
// 只断言结构和板块是否存在，不写死具体内容——否则你一改内容，
// 检查就红，看着像站点坏了，其实只是断言过时。

import { readdirSync } from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:4321';

const cases = [
  { path: '/', must: ['class="hero"', 'timeline-period', 'class="chips"', 'dataset.theme'] },
  { path: '/projects', must: ['我的项目', 'project-card'] },
  { path: '/activities', must: ['我的活动', 'activity-list'] },
  { path: '/guestbook', must: ['留言板', 'gb-form', 'name="website"'] },
  { path: '/admin', must: ['管理'] },
  { path: '/rss.xml', must: ['<rss', '<language>zh-cn</language>'] },
  { path: '/robots.txt', must: ['Disallow: /admin', 'Sitemap:'] },
];

let failed = 0;

for (const c of cases) {
  try {
    const res = await fetch(base + c.path);
    const html = await res.text();
    const misses = c.must.filter((m) => !html.includes(m));
    if (!res.ok || misses.length) {
      failed++;
      console.log(`FAIL ${c.path}  status=${res.status}${misses.length ? `  缺失: ${misses.join(', ')}` : ''}`);
    } else {
      console.log(`OK   ${c.path}  status=${res.status}  ${html.length}B`);
    }
  } catch (err) {
    failed++;
    console.log(`FAIL ${c.path}  请求失败: ${err.message}`);
  }
}

// 活动详情页是按内容生成的，动态找一个来验，不写死是哪一场
try {
  const listHtml = await (await fetch(base + '/activities')).text();
  const slug = listHtml.match(/href="\/activities\/([^"/]+)"/)?.[1];

  if (!slug) {
    console.log('SKIP /activities/<slug>  活动页里暂时没有详情链接');
  } else {
    const res = await fetch(`${base}/activities/${slug}`);
    const html = await res.text();
    if (res.ok && html.includes('activity-detail') && html.includes('prose')) {
      console.log(`OK   /activities/${slug}  status=${res.status}  ${html.length}B`);
    } else {
      failed++;
      console.log(`FAIL /activities/${slug}  status=${res.status}`);
    }
  }
} catch (err) {
  failed++;
  console.log(`FAIL 活动详情页探测失败: ${err.message}`);
}

// 内容新鲜度：源码里有几个项目文件，页面上就该有几张卡。
// 只比数量、不比内容，所以内容怎么写都不会误报；
// 但「改了内容却没重启 dev」导致服务器一直发旧页，会被抓住。
try {
  const projectFiles = readdirSync('src/content/projects').filter((f) => f.endsWith('.md')).length;
  const projectsHtml = await (await fetch(base + '/projects')).text();
  const cards = (projectsHtml.match(/class="project-card"/g) ?? []).length;

  if (cards === projectFiles) {
    console.log(`OK   项目页卡片数 ${cards} 与源文件数一致（内容不是旧的）`);
  } else {
    failed++;
    console.log(
      `FAIL 项目页有 ${cards} 张卡，源文件却有 ${projectFiles} 个 —— 服务器可能在发旧内容，重启 dev 再试`
    );
  }

  const activityDirs = readdirSync('src/content/activities', { withFileTypes: true }).filter((d) =>
    d.isDirectory()
  ).length;
  const activitiesHtml = await (await fetch(base + '/activities')).text();
  const items = (activitiesHtml.match(/class="activity"/g) ?? []).length;

  if (items === activityDirs) {
    console.log(`OK   活动页条目数 ${items} 与源目录数一致`);
  } else {
    failed++;
    console.log(`FAIL 活动页有 ${items} 条，源目录却有 ${activityDirs} 个 —— 服务器可能在发旧内容`);
  }
} catch (err) {
  failed++;
  console.log(`FAIL 内容新鲜度检查失败: ${err.message}`);
}

console.log(failed ? `\n${failed} 个用例失败` : '\n全部通过');
process.exit(failed ? 1 : 0);
