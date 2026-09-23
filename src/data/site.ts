/**
 * 站点内容配置 —— 想改自我介绍、链接、经历，改这一个文件就够了。
 * 带 ← 的注释是给你改的地方。
 */

export interface SocialLink {
  label: string;
  href: string;
}

export interface ExperienceItem {
  period: string;
  title: string;
  org?: string;
  desc?: string;
}

export interface SiteConfig {
  /** 站点名，显示在浏览器标签和左上角 */
  name: string;
  /** 一句话签名，显示在名字下面 */
  tagline: string;
  /** SEO 描述 */
  description: string;
  /** 头像路径，例如 '/avatar.jpg' 并把图片放进 public/；留空则用名字首字生成 */
  avatar: string;
  /** 所在城市，留空则不显示 */
  location: string;
  /** 邮箱，留空则不显示 */
  email: string;
  socials: SocialLink[];
  /** 每段一个字符串，会按段落渲染 */
  about: string[];
  experience: ExperienceItem[];
  skills: string[];
}

export const site: SiteConfig = {
  name: '肖铭皓',                                    // ← 改成你的名字
  tagline: '计科生一枚，vibe coding摸鱼中🖐️🐟️',        // ← 改成你的签名
  description: '肖铭皓的个人主页：简介、项目、活动与留言板。',
  avatar: '/avatar.jpg',                               // ← 把图片放到 public/avatar.jpg 即可；没有文件时自动用名字首字
  location: '中国 · 成都',                              // ← 改成你的城市
  email: '1062355602@qq.com',                            // ← 改成你的邮箱

  socials: [
    { label: 'GitHub', href: 'https://github.com/EdwardXiao-bit' },
    { label: 'Email', href: '1062355602@qq.com' },
    // { label: 'X', href: 'https://x.com/yourname' },
    // { label: '博客园', href: 'https://example.com' },
  ],

  // ↓ 只陈述做过的事，不写「方向 / 兴趣领域」——方向还没定，不替你表态
  about: [
    '四川大学计算机科学与技术专业大三在读，在成都。做过古陶瓷碎片的深度学习复原，也写各种小工具。',
    '最近在给 DeepSeek Harness 写插件，也会把踩过的坑整理成文档。',
  ],

  experience: [
    // ← 按时间倒序，想加几段加几段
    {
      period: '2024 — 现在',
      title: '本科在读',
      org: '四川大学 · 计算机科学与技术',
    },
    {
      period: '2026 上半年',
      title: '古陶瓷碎片智能复原',
      org: '项目经历',
      desc: '用深度学习做碎片拼接与三维重建，另做了一个展示站点。',
    },
  ],

  // ← 只列具体用过的技术，不写领域名（那等于替你定方向）
  skills: ['Python', 'C++', 'JavaScript', 'PyTorch', 'WebGL'],
};
