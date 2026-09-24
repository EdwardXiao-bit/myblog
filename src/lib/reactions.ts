/**
 * 可以贴的表情反应。
 *
 * 做成白名单是有意的：接口只接受这里的值。
 * 否则任何字符串都能被存进数据库、再原样渲染到页面上——
 * 那等于给匿名访客开了一个写内容的入口。
 */
export const REACTION_EMOJIS = [
  '👍', '❤️', '😂', '😍', '🥰', '😮', '😢', '🤔',
  '👏', '🙏', '💪', '🎉', '🎊', '🎆', '✨', '🔥',
  '💯', '⭐', '🌟', '🚀', '🌸', '☕', '🍻', '🐟',
];

const ALLOWED = new Set(REACTION_EMOJIS);

export function isAllowedReaction(value: unknown): value is string {
  return typeof value === 'string' && ALLOWED.has(value);
}
