import { site } from '../data/site';

/**
 * 彩蛋：有人留言时用了站主的昵称。
 *
 * 只在渲染时比对，不落库——这样以后改站点名，历史留言的标记会跟着变，
 * 也不需要在数据库里多存一个可以不一致的字段。
 * 大小写和首尾空格都不计较，免得「edwardxiao」漏掉。
 */
export function isImpostor(nickname: string | null | undefined): boolean {
  if (!nickname) return false;

  const owner = site.name.trim().toLowerCase();
  if (owner.length === 0) return false;

  return nickname.trim().toLowerCase() === owner;
}
