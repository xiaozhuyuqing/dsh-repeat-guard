/**
 * 复读退化判定：查表。
 *
 * 表里是已知会被模型复读的空话短句，**连标点一起写**，表本身可配置（见 config.ts）。
 * 判定是"思考里有没有独占一行的表项"：整行与表项全等，不拆解行的内部。
 *
 * 阈值是"连续命中多少行才拦"：默认 1 表示发现即拦；调到 n 时，要连着 n 行都命中
 * （句子可以各不相同）才拦，中间夹一行不命中的就重新计数。
 */

/**
 * 找出退化的碎片行。
 * @param text - 已生成的思考文本。
 * @param fragments - 小写化的短句表。
 * @param threshold - 连续命中多少行才判定为复读。
 * @returns 计数成立时返回那一行的原文，否则返回 null。
 */
export function findDegenerateLine(
  text: string,
  fragments: ReadonlySet<string>,
  threshold: number,
): string | null {
  let run = 0;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line !== '' && fragments.has(line.toLowerCase())) {
      run += 1;
      if (run >= threshold) {
        return line;
      }
    } else {
      run = 0;
    }
  }
  return null;
}
