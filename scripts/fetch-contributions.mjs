#!/usr/bin/env node
/**
 * 拉过去一年的 GitHub 贡献数据，写到 src/data/contributions.json。
 *
 * 优先走 GraphQL（能看到私有仓库的贡献），需要 GH_CONTRIB_TOKEN（classic PAT，勾 read:user）。
 * 没有 token 时退回公开接口 github-contributions-api.jogruber.de —— 只有公开贡献。
 *
 * 用法：
 *   GH_CONTRIB_TOKEN=xxx node scripts/fetch-contributions.mjs
 *   node scripts/fetch-contributions.mjs            # 公开数据
 */
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LOGIN = process.env.GH_LOGIN || 'EdwardXiao-bit';
const TOKEN = process.env.GH_CONTRIB_TOKEN || '';
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../src/data/contributions.json');
const PUBLIC_OUT = resolve(dirname(fileURLToPath(import.meta.url)), '../public/contributions.json');
const DAYS = 365;

const iso = (d) => d.toISOString().slice(0, 10);

/** GitHub 的等级：0 无，1–4 递增。用固定阈值，跨天稳定，不随当年数据抖动。 */
function levelOf(count) {
  if (!count) return 0;
  if (count <= 2) return 1;
  if (count <= 4) return 2;
  if (count <= 7) return 3;
  return 4;
}

function toWeeks(days) {
  // days: [{ date, count }]，按日期升序；补到整周（GitHub 以周日开头）
  const byDate = new Map(days.map((d) => [d.date, d.count]));
  const first = new Date(days[0].date + 'T00:00:00Z');
  const last = new Date(days.at(-1).date + 'T00:00:00Z');
  const start = new Date(first);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay()); // 回到周日

  const weeks = [];
  const cursor = new Date(start);
  while (cursor <= last) {
    const week = [];
    for (let i = 0; i < 7; i += 1) {
      const date = iso(cursor);
      week.push({ date, count: byDate.get(date) ?? 0, level: levelOf(byDate.get(date) ?? 0) });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }
  return weeks;
}

function summarize(weeks) {
  const flat = weeks.flat();
  const total = flat.reduce((sum, d) => sum + d.count, 0);
  let streak = 0;
  let longest = 0;
  for (const d of flat) {
    if (d.count > 0) {
      streak += 1;
      longest = Math.max(longest, streak);
    } else {
      streak = 0;
    }
  }
  return { total, longest };
}

async function viaGraphql() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - (DAYS - 1));

  const query = `
    query ($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays { date contributionCount }
            }
          }
        }
      }
    }
  `;

  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      'User-Agent': 'myblog-contributions',
    },
    body: JSON.stringify({
      query,
      variables: { login: LOGIN, from: from.toISOString(), to: to.toISOString() },
    }),
  });

  const json = await res.json();
  if (!res.ok || json.errors) {
    throw new Error(`GraphQL ${res.status}: ${JSON.stringify(json.errors ?? json).slice(0, 300)}`);
  }

  const cal = json.data.user.contributionsCollection.contributionCalendar;
  const days = cal.weeks.flatMap((w) =>
    w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })),
  );
  days.sort((a, b) => a.date.localeCompare(b.date));
  return { days, source: 'graphql' };
}

async function viaPublicApi() {
  const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${LOGIN}?y=last`, {
    headers: { 'User-Agent': 'myblog-contributions' },
  });
  if (!res.ok) throw new Error(`public api ${res.status}`);
  const json = await res.json();
  const days = json.contributions
    .map((d) => ({ date: d.date, count: d.count }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-DAYS);
  return { days, source: 'public' };
}

async function main() {
  let result;
  if (TOKEN) {
    try {
      result = await viaGraphql();
    } catch (err) {
      console.warn(`GraphQL 失败，退回公开数据：${err.message}`);
      result = await viaPublicApi();
    }
  } else {
    result = await viaPublicApi();
  }

  const weeks = toWeeks(result.days);
  const { total, longest } = summarize(weeks);
  const payload = {
    login: LOGIN,
    generatedAt: new Date().toISOString(),
    source: result.source,
    from: weeks[0][0].date,
    to: result.days.at(-1).date,
    total,
    longestStreak: longest,
    weeks,
  };

  // 数据没变就不写，避免 Actions 每天空提交
  try {
    const prev = JSON.parse(await readFile(OUT, 'utf8'));
    const same =
      prev.total === payload.total &&
      prev.longestStreak === payload.longestStreak &&
      JSON.stringify(prev.weeks) === JSON.stringify(payload.weeks);
    if (same) {
      console.log(`贡献数据未变化（${total} 次，来源 ${result.source}），跳过写入。`);
      return;
    }
    // 本地没 token 时只拿得到公开数据；别把仓库里已有的「含私有贡献」版本覆盖掉
    if (prev.source === 'graphql' && result.source === 'public') {
      console.warn('已有 GraphQL（含私有）数据，本地公开数据不覆盖。要更新请带上 GH_CONTRIB_TOKEN。');
      return;
    }
  } catch {
    /* 首次运行没有旧文件 */
  }

  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(payload, null, 2) + '\n', 'utf8');
  console.log(
    `写入 ${OUT}\n  ${payload.from} → ${payload.to}，共 ${total} 次，最长连续 ${longest} 天，来源 ${result.source}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
