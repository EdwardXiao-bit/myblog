import sharp from 'sharp';

/**
 * 分享卡片（og:image）渲染器。
 *
 * 为什么自己画而不是用现成库：中文排版库通常要额外塞一个 CJK 字体文件进仓库
 * （动辄十几 MB），而 SVG + sharp 走的是系统字体，这里的中文能正常渲染。
 */

const WIDTH = 1200;
const HEIGHT = 630;

const COLORS = {
  bg: '#131211',
  text: '#eceae5',
  soft: '#b4b1a9',
  muted: '#8b8880',
  accent: '#6fb3a3',
};

export interface CardOptions {
  /** 顶部小字，例如站点名或日期 */
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** 右下角，一般是域名 */
  footer?: string;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** 逐字估算宽度：中日韩字符按 1 个字宽，其余按 0.55，够用且不需要字体度量 */
function charWidth(ch: string): number {
  return /[\u2e80-\u9fff\uff00-\uffef\u3000-\u303f]/.test(ch) ? 1 : 0.55;
}

function wrap(text: string, fontSize: number, maxWidth: number, maxLines: number): string[] {
  const maxEm = maxWidth / fontSize;
  const lines: string[] = [];
  let current = '';
  let used = 0;

  for (const ch of text) {
    const w = charWidth(ch);
    if (used + w > maxEm && current.length > 0) {
      lines.push(current);
      current = '';
      used = 0;
      if (lines.length === maxLines) break;
    }
    current += ch;
    used += w;
  }

  if (lines.length < maxLines && current) lines.push(current);

  // 超出部分用省略号收尾
  const consumed = lines.join('').length;
  if (consumed < text.length && lines.length > 0) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = last.slice(0, Math.max(0, last.length - 1)) + '…';
  }

  return lines;
}

export async function renderCard(options: CardOptions): Promise<Buffer> {
  const padding = 80;
  const maxTextWidth = WIDTH - padding * 2;

  const titleSize = options.title.length > 24 ? 56 : 68;
  const titleLines = wrap(options.title, titleSize, maxTextWidth, 3);

  const subtitleLines = options.subtitle
    ? wrap(options.subtitle, 32, maxTextWidth, 2)
    : [];

  // 整块文字垂直居中
  const blockHeight =
    (options.eyebrow ? 46 : 0) +
    titleLines.length * (titleSize * 1.18) +
    (subtitleLines.length ? subtitleLines.length * 46 + 22 : 0);
  let y = (HEIGHT - blockHeight) / 2 + titleSize * 0.9;

  const parts: string[] = [];

  parts.push(
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="${COLORS.bg}"/>`,
    // 右上角一抹点缀色，预览图缩小时也能认出是这个站
    `<circle cx="${WIDTH - 130}" cy="120" r="200" fill="${COLORS.accent}" opacity="0.10"/>`,
    `<circle cx="${WIDTH - 130}" cy="120" r="118" fill="${COLORS.accent}" opacity="0.10"/>`,
    `<rect x="0" y="0" width="8" height="${HEIGHT}" fill="${COLORS.accent}"/>`
  );

  if (options.eyebrow) {
    // 眉标基线要抬到标题行上沿之上，留出它自己的字高，否则会和标题贴在一起
    parts.push(
      `<text x="${padding}" y="${y - titleSize * 0.82 - 28}" font-family="Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif" font-size="26" fill="${COLORS.accent}">${escapeXml(options.eyebrow)}</text>`
    );
  }

  for (const line of titleLines) {
    parts.push(
      `<text x="${padding}" y="${y}" font-family="Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif" font-size="${titleSize}" font-weight="bold" fill="${COLORS.text}">${escapeXml(line)}</text>`
    );
    y += titleSize * 1.18;
  }

  if (subtitleLines.length) {
    y += 18;
    for (const line of subtitleLines) {
      parts.push(
        `<text x="${padding}" y="${y}" font-family="Microsoft YaHei, PingFang SC, Noto Sans SC, sans-serif" font-size="32" fill="${COLORS.soft}">${escapeXml(line)}</text>`
      );
      y += 46;
    }
  }

  if (options.footer) {
    parts.push(
      `<text x="${padding}" y="${HEIGHT - 56}" font-family="Arial, Helvetica, sans-serif" font-size="26" fill="${COLORS.muted}">${escapeXml(options.footer)}</text>`
    );
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">${parts.join('')}</svg>`;

  return sharp(Buffer.from(svg)).png({ compressionLevel: 9, palette: true }).toBuffer();
}
