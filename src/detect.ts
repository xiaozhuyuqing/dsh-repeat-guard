/**
 * 复读退化判定：查表。
 *
 * 表里是已知会被模型复读的空话短句，**连标点一起写**。判定就是"思考里有没有
 * 独占一行的表项"，整行与表项全等，不拆解行的内部。
 *
 * 增删条目直接改下面的 FRAGMENTS 即可，改完重新构建。
 */

/**
 * 会被复读的空话短句表，标点照原样写。
 *
 * 英文条目一律写小写，判定时会把整行转成小写再比。
 */
const FRAGMENTS: readonly string[] = [
  // 中文
  '好。',
  '好的。',
  '好嘞。',
  '对。',
  '对的。',
  '是。',
  '是的。',
  '行。',
  '嗯。',
  '可以。',
  '明白。',
  '收到。',
  '了解。',
  '执行。',
  '继续。',
  '确认。',
  '完成。',
  '搞定。',
  '写。',
  '查。',
  '看。',
  // 英文
  'ok.',
  'okay.',
  'sure.',
  'alright.',
  'right.',
  'yes.',
  'done.',
  'got it.',
  'let me go.',
  'let me do it.',
  'check it.',
];

/** 查表用的集合。 */
const FRAGMENT_SET = new Set(FRAGMENTS);

/**
 * 找出退化的碎片行。
 * @param text - 已生成的思考文本。
 * @returns 命中返回该行的原文，未命中返回 null。
 */
export function findDegenerateLine(text: string): string | null {
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line !== '' && FRAGMENT_SET.has(line.toLowerCase())) {
      return line;
    }
  }
  return null;
}
