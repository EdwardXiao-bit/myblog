// 生成示例照片（占位图），用来验证图片管线：压缩、尺寸推断、响应式 srcset
// 用法：node scripts/make-placeholder-photos.mjs
// 这些图只是模板，随时可以删掉换成你自己的照片。

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error('没找到 sharp（它随 Astro 一起安装为可选依赖）。先跑 npm install。');
  process.exit(1);
}

const sets = [
  {
    dir: 'src/content/activities/2024-summer-meetup',
    palette: [
      ['#2f6f62', '#7fb8a8'],
      ['#1f4a56', '#4f93a8'],
      ['#4a5f2f', '#9cb86a'],
      ['#6b4a2f', '#c69a6a'],
    ],
  },
  {
    dir: 'src/content/activities/2023-open-source-day',
    palette: [
      ['#3a3f6b', '#8a8fc6'],
      ['#6b3a5a', '#c68ab0'],
      ['#2f5a6b', '#7fb0c6'],
      ['#5a4a2f', '#b8a06a'],
    ],
  },
];

function svg(c1, c2, label, sub) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1067">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${c1}"/>
        <stop offset="1" stop-color="${c2}"/>
      </linearGradient>
    </defs>
    <rect width="1600" height="1067" fill="url(#g)"/>
    <circle cx="1330" cy="220" r="150" fill="rgba(255,255,255,0.10)"/>
    <circle cx="240" cy="880" r="220" fill="rgba(0,0,0,0.08)"/>
    <text x="800" y="510" font-family="Arial, Helvetica, sans-serif" font-size="128" font-weight="bold" fill="rgba(255,255,255,0.95)" text-anchor="middle">${label}</text>
    <text x="800" y="600" font-family="Arial, Helvetica, sans-serif" font-size="46" fill="rgba(255,255,255,0.75)" text-anchor="middle">${sub}</text>
    <text x="800" y="990" font-family="Arial, Helvetica, sans-serif" font-size="34" fill="rgba(255,255,255,0.55)" text-anchor="middle">SAMPLE IMAGE - REPLACE WITH YOUR PHOTO</text>
  </svg>`;
}

for (const set of sets) {
  await mkdir(set.dir, { recursive: true });
  const names = ['cover', 'photo-1', 'photo-2', 'photo-3'];

  for (let i = 0; i < names.length; i++) {
    const [c1, c2] = set.palette[i];
    const file = join(set.dir, `${names[i]}.jpg`);
    const svgBuf = Buffer.from(svg(c1, c2, `SAMPLE ${i + 1}`, `placeholder ${i + 1} of ${names.length}`));
    await sharp(svgBuf).jpeg({ quality: 82, mozjpeg: true }).toFile(file);
    console.log('生成', file);
  }
}

console.log('\n完成。替换成真实照片时，保持文件名一致即可，无需改 Markdown。');
