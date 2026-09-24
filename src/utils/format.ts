/**
 * 日期格式化。这里有两个函数，别混用：
 *
 * - formatDate / formatYearMonth：给**内容里的日期**用（活动、项目里手写的 2024-08-17）。
 *   YAML 会把这种日期解析成 UTC 零点，所以必须用 UTC 格式化，否则在东八区会显示成前一天。
 *
 * - formatDateTime：给**数据库里的时间戳**用（留言、日记的创建时间）。
 *   那是真实时刻，必须按访问者的本地时区显示，否则凌晨发的留言会显示成前一天。
 */

/** 内容日期：2024年8月17日（UTC，避免日期偏移） */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** 只到年月的短格式，用在卡片角标上 */
export function formatYearMonth(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}

/** 真实时刻：2026年9月23日 23:44（本机时区，精确到分钟） */
export function formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date);
}
