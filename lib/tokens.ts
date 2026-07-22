// S3: Cheap token-count approximation. NOT tiktoken — but far closer to true
// token counts than raw character length, which was previously used for prompt
// budgets and caused silent context truncation on long Chinese sessions.
//
// Heuristic:
//   - Chinese/CJK characters ≈ 1 token each (models actually range 0.5-1.5).
//   - Latin characters ≈ 1 token per 3.5 characters.
//   - Digits, whitespace, punctuation folded into the latin bucket.
//
// Slightly overestimates for pure Chinese, slightly underestimates for pure
// English — both directions safe for a budget check (we want the ceiling).

const CJK_RE = /[㐀-鿿豈-﫿぀-ヿ가-힯]/;

export function approxTokens(value: unknown): number {
  if (typeof value !== "string" || !value) return 0;
  let cjk = 0;
  let other = 0;
  for (let index = 0; index < value.length; index += 1) {
    const ch = value.charAt(index);
    if (CJK_RE.test(ch)) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk + other / 3.5);
}

export function approxTokensSum(values: Array<string | null | undefined>): number {
  let total = 0;
  for (const value of values) total += approxTokens(value);
  return total;
}
