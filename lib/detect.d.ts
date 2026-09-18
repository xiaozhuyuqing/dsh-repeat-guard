/**
 * 复读退化判定：查表。
 *
 * 表里是已知会被模型复读的空话短句，**连标点一起写**。判定就是"思考里有没有
 * 独占一行的表项"，整行与表项全等，不拆解行的内部。
 *
 * 增删条目直接改下面的 FRAGMENTS 即可，改完重新构建。
 */
/**
 * 找出退化的碎片行。
 * @param text - 已生成的思考文本。
 * @returns 命中返回该行的原文，未命中返回 null。
 */
export declare function findDegenerateLine(text: string): string | null;
