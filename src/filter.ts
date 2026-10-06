// `--only` substring filtering — the original consumer's SHOTS_ONLY semantics: the
// walkthrough still runs; only shot *writes* are filtered.

export function parseOnly(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Empty filter list captures everything; otherwise any substring match wins. */
export function shouldCapture(name: string, only: string[]): boolean {
  return only.length === 0 || only.some((f) => name.includes(f))
}
