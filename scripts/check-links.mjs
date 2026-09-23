// 外链体检：项目卡和社交链接指向的地址是否真的能打开。
// 死链挂在作品集上很扣分，所以单独做成一个可重复运行的检查。
//
// 用法：node scripts/check-links.mjs   （需要联网，因此不放进 check-build）
//
// 两个注意点：
//  1. 本机网络屏蔽了 github.com 的 HTTPS(443)，直接 fetch 会一律失败。
//     所以 GitHub 链接改走 api.github.com 验证仓库/用户是否存在——那是通的，
//     而且答案更准确：能区分「仓库不存在」和「网络到不了」。
//  2. site.ts 里被注释掉的示例链接不算真链接，不能拿来说事。

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const targets = [];

// 1) 项目 frontmatter 里的 href
const projectDir = 'src/content/projects';
for (const name of readdirSync(projectDir)) {
  if (!name.endsWith('.md')) continue;
  const file = join(projectDir, name);
  const match = readFileSync(file, 'utf8').match(/^href:\s*(\S+)\s*$/m);
  if (match) targets.push({ from: `projects/${name}`, url: match[1] });
}

// 2) site.ts 里的社交链接（跳过注释掉的行）
readFileSync('src/data/site.ts', 'utf8')
  .split(/\r?\n/)
  .filter((line) => !line.trim().startsWith('//'))
  .forEach((line) => {
    for (const match of line.matchAll(/href:\s*'([^']+)'/g)) {
      if (/^https?:\/\//.test(match[1])) targets.push({ from: 'site.ts', url: match[1] });
    }
  });

if (targets.length === 0) {
  console.log('没有需要检查的外链。');
  process.exit(0);
}

const UA = { 'user-agent': 'myblog-link-check' };

/** GitHub 网页走不通时，改用 API 确认目标是否存在 */
function githubApiUrl(url) {
  const repo = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/?#]+)\/?$/);
  if (repo) return `https://api.github.com/repos/${repo[1]}/${repo[2]}`;

  const user = url.match(/^https:\/\/github\.com\/([^/?#]+)\/?$/);
  if (user) return `https://api.github.com/users/${user[1]}`;

  return null;
}

console.log(`检查 ${targets.length} 个外链…\n`);

let broken = 0;
let unreachable = 0;

for (const target of targets) {
  const api = githubApiUrl(target.url);
  let status;
  let via;

  try {
    if (api) {
      const res = await fetch(api, { headers: UA });
      status = res.status;
      via = 'api.github.com';
    } else {
      let res = await fetch(target.url, { method: 'HEAD', redirect: 'follow', headers: UA });
      if (res.status === 405 || res.status === 501) {
        res = await fetch(target.url, { method: 'GET', redirect: 'follow', headers: UA });
      }
      status = res.status;
      via = 'direct';
    }
  } catch (err) {
    // 网络层就失败了，不能断定链接有问题
    unreachable++;
    console.log(`???  无法访问  ${target.url}`);
    console.log(`       引用自 ${target.from} — ${err.message}`);
    continue;
  }

  const ok = status === 200;
  if (!ok) broken++;

  const label = ok ? 'OK  ' : status === 404 ? 'DEAD' : 'FAIL';
  const note = status === 404 ? '  <-- 目标不存在' : status === 403 ? '  <-- 拒绝访问' : '';
  console.log(`${label} ${String(status).padEnd(4)} ${target.url}${note}  (${via})`);
  if (!ok) console.log(`       引用自 ${target.from}`);
}

console.log('');
if (broken === 0 && unreachable === 0) console.log('全部可访问');
else {
  if (broken) console.log(`${broken} 个链接确认有问题（404 等）`);
  if (unreachable) console.log(`${unreachable} 个链接本机访问不到，无法判断好坏（不算失败）`);
}

process.exit(broken ? 1 : 0);
