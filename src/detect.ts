/**
 * 复读退化判定：查表。
 *
 * 表里是已知会被模型复读的空话短句，**连标点一起写**，表本身可配置（见 config.ts）。
 * 基本判据是"整行与表项全等"，不拆解行的内部。
 *
 * 行内重复检测（可开关，默认关）打开时，"整行由多个表项首尾相接拼成"也算命中，
 * 用来兜住把短句连成一串写在同一行里的模型（如"好。好。好。"）。
 *
 * 阈值是"连续命中多少次才拦"：默认 1 表示发现即拦。计数单位是表项——整行全等算一次，
 * 开了行内检测后行内每一段各算一次；中间夹一行不命中的就重新计数。
 */

/**
 * 在 line 的 at 处能匹配到的最长表项长度。
 * @param line - 已小写化的行。
 * @param at - 起始下标。
 * @param fragments - 小写化的短句表。
 * @returns 匹配到的长度，0 表示这个位置没有表项。
 */
function longestFragmentAt(line: string, at: number, fragments: ReadonlySet<string>): number {
  let size = 0;
  for (const fragment of fragments) {
    if (fragment.length > size && line.startsWith(fragment, at)) {
      size = fragment.length;
    }
  }
  return size;
}

/**
 * 这一行算几次命中。
 * @param line - 已 trim 并小写化的行。
 * @param fragments - 小写化的短句表。
 * @param inlineRepeat - 是否把"整行由多个表项拼成"也算命中。
 * @returns 0 表示不是命中行，其余为这一行贡献的次数。
 */
function countHits(line: string, fragments: ReadonlySet<string>, inlineRepeat: boolean): number {
  if (fragments.has(line)) {
    return 1;
  }
  if (!inlineRepeat) {
    return 0;
  }
  let at = 0;
  let parts = 0;
  while (at < line.length) {
    const size = longestFragmentAt(line, at, fragments);
    if (size === 0) {
      return 0;
    }
    at += size;
    parts += 1;
  }
  return parts > 1 ? parts : 0;
}

/**
 * 找出退化的碎片行。
 * @param text - 已生成的思考文本。
 * @param fragments - 小写化的短句表。
 * @param threshold - 连续命中多少次才判定为复读。
 * @param inlineRepeat - 是否启用行内重复检测。
 * @returns 计数成立时返回那一行的原文，否则返回 null。
 */
export function findDegenerateLine(
  text: string,
  fragments: ReadonlySet<string>,
  threshold: number,
  inlineRepeat: boolean,
): string | null {
  let run = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    const hits = line === '' ? 0 : countHits(line.toLowerCase(), fragments, inlineRepeat);
    if (hits === 0) {
      run = 0;
      continue;
    }
    run += hits;
    if (run >= threshold) {
      return line;
    }
  }
  return null;
}
