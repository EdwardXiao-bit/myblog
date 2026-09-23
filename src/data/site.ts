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

/** 直接展示的联系方式：QQ / 微信这类没有公开主页，只能写成文字 */
export interface ContactItem {
  label: string;
  value: string;
}

export interface Hobby {
  emoji: string;
  name: string;
  /** 补充说明，例如 Steam 好友 ID、视频号 */
  note?: string;
  /** 有公开链接才填；没有就只显示文字 */
  href?: string;
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
  /** 直接展示的联系方式（QQ / 微信），和 socials 一起排在名字下面 */
  contacts: ContactItem[];
  /** 每段一个字符串，会按段落渲染 */
  about: string[];
  experience: ExperienceItem[];
  /** 兴趣爱好，显示在「经历」下面 */
  hobbies: Hobby[];
  skills: string[];
}

export const site: SiteConfig = {
  name: 'EdwardXiao',                                // ← 站点名：浏览器标签、左上角、页脚都用它
  tagline: '计科生一枚，vibe coding摸鱼中🖐️🐟️',        // ← 改成你的签名
  description: 'EdwardXiao 的个人主页：简介、项目、活动与留言板。',
  avatar: '/avatar.jpg',                               // ← 把图片放到 public/avatar.jpg 即可；没有文件时自动用名字首字
  location: '中国 · 成都',                              // ← 改成你的城市
  email: '1062355602@qq.com',                            // ← 改成你的邮箱

  socials: [
    { label: 'GitHub', href: 'https://github.com/EdwardXiao-bit' },
    { label: 'Email', href: '1062355602@qq.com' },
    // { label: 'X', href: 'https://x.com/yourname' },
  ],

  // QQ / 微信没有公开主页，只能写成文字贴出来。不想要就删掉对应那行。
  contacts: [
    { label: 'QQ', value: '1062355602' },
    { label: '微信', value: '19923173106' },
  ],

  // ↓ 只陈述做过的事，不写「方向 / 兴趣领域」——方向还没定，不替你表态
  about: [
    '四川大学计算机科学与技术专业大三在读，在成都。做过古陶瓷碎片的深度学习复原，也写各种小工具。',
    '最近在探索 AI Agent，并给 DeepSeek Harness 写插件。',
  ],

  experience: [
    // ← 一行一段经历，顺序随意（现在是从高中往下读的时间线）
    {
      period: '2021 — 2024',
      title: '高中',
      org: '重庆市第八中学',
    },
    {
      period: '2024 — 现在',
      title: '本科在读',
      org: '四川大学 · 计算机学院 计算机科学与技术',
    },
    {
      period: '2026 7月',
      title: '新加坡国立大学计算机学院暑期研习',
      org: '研学经历',
    },
  ],

  // ← 爱好，显示在「经历」下面。Steam / 视频号这类只能写 ID，没有公开链接
  hobbies: [
    { emoji: '🚲', name: '骑行', note: 'XDS Hero 300' },
    { emoji: '🎮', name: '游戏', note: 'Steam 好友 ID：1421154588（EdwardDavis）' },
    { emoji: '🎹', name: '钢琴', note: '微信视频号：EdwardDavisXiao' },
    { emoji: '🏊‍♀️', name: '游泳', },
    { emoji: '🎶', name: '听歌', note: '古典，摇滚，爵士，伍佰，...'},
  ],

  // ← 只列具体用过的技术，不写领域名（那等于替你定方向）
  skills: ['AI Agent', 'C++', 'Unity', 'Didot', 'JavaScript', 'PyTorch', 'WebGL'],
};
