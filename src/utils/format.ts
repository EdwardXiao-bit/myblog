/** 日期格式化：统一用 UTC，避免时区把日期挪一天（YAML 里的 2024-08-17 会被解析成 UTC 零点） */
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
