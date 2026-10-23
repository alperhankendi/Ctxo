/**
 * Compares strings with `<` and `>` (UTF-16 code unit order, which Ctxo calls code point order),
 * never by locale.
 *
 * `localeCompare` depends on the machine's locale (Turkish treats dotted and dotless i specially, for
 * one), so output sorted with it can differ between teammates and CI runners. Every list that ends up
 * in a committed artifact is sorted with this comparator instead.
 */
export function compareCodepoint(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
