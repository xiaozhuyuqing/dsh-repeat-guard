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
    // 空行是排版，不是内容：跳过而不重置计数。
    // 否则模型把复读写成「做。\n\n做。\n\n做。」时，每两句之间夹一个空行，
    // 计数永远在 1 和 0 之间跳，threshold 设多少都不会触发。
    if (line === '') {
      continue;
    }
    const hits = countHits(line.toLowerCase(), fragments, inlineRepeat);
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

/**
 * 密度判据：看最近的窗口里有多少行是碎片行。
 *
 * 连续判据管的是「做。做。做。做。」这种一长串；但模型还有另一种退化形态——
 * 碎片之间夹着「（调用）」「（执行）」这类假装动作的行，把连续打断成 1、2、3 的碎块，
 * 连续长度永远到不了阈值，而整段思考其实已经全是碎片了。
 *
 * 判据改成看密度：最近 windowSize 个非空行里，长度不超过 shortLineChars 的行占多少。
 * 实测 304 个真实 turn，中位数 20.1%、复读的 turn 在 82%–93%，中间几乎是空的。
 *
 * 不依赖短句表——碎片行未必在表里，但一定短。
 *
 * @param text - 已生成的思考文本。
 * @param windowSize - 只看最后多少个非空行。
 * @param densityThreshold - 碎片行占比达到多少算复读（0–1）。
 * @param shortLineChars - 多长算碎片行。
 * @returns 判定成立时返回窗口里最后一行原文，否则返回 null。
 */
export function findDegenerateDensity(
  text: string,
  windowSize: number,
  densityThreshold: number,
  shortLineChars: number,
): string | null {
  if (windowSize < 1) {
    return null;
  }
  const lines: string[] = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line !== '') {
      lines.push(line);
    }
  }
  // 窗口没满不判：样本太少时密度没有意义。
  if (lines.length < windowSize) {
    return null;
  }
  // 前缀和：prefix[i] = 前 i 行里有几行是碎片行。
  // 这样每个窗口的密度都是 O(1)，整段扫完仍是 O(n)，可以每来一个 chunk 都重算。
  const prefix = new Array<number>(lines.length + 1).fill(0);
  for (let i = 0; i < lines.length; i += 1) {
    prefix[i + 1] = prefix[i] + (lines[i]!.length <= shortLineChars ? 1 : 0);
  }
  // 扫所有窗口，而不是只看末尾：复读结束前模型常常会补一段正常的话，
  // 只看最后 windowSize 行会漏掉前面那段真正的复读。
  for (let end = windowSize; end <= lines.length; end += 1) {
    const start = end - windowSize;
    const density = (prefix[end]! - prefix[start]!) / windowSize;
    if (density >= densityThreshold) {
      return lines[end - 1]!;
    }
  }
  return null;
}
