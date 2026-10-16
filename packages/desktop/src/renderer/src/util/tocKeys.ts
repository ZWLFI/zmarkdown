export interface KeyedTocNode {
  key: string
  label: unknown
  slug: unknown
  children: KeyedTocNode[]
}

interface TocLike {
  label?: unknown
  slug?: unknown
  githubSlug?: unknown
  children?: TocLike[]
}

// Give each TOC node a stable key so el-tree can preserve the user's
// expand/collapse state. The key is the heading's content-derived `githubSlug`,
// deduplicated in document order so duplicate headings stay distinct. This is
// stable across content edits (#3028) AND across a document reload / tab switch
// (#3791) — unlike the per-render object id `slug`, which every switch rebuilds.
// `slug` is still carried for the click-to-scroll anchor payload.
export function deriveKeyedToc(nodes: TocLike[]): KeyedTocNode[] {
  const seen = new Map<string, number>()
  const assign = (list: TocLike[]): KeyedTocNode[] =>
    list.map((node) => {
      const base =
        typeof node.githubSlug === 'string' && node.githubSlug ? node.githubSlug : 'heading'
      const count = seen.get(base) ?? 0
      seen.set(base, count + 1)
      return {
        key: count === 0 ? base : `${base}-${count}`,
        label: node.label,
        slug: node.slug,
        children: assign(node.children ?? [])
      }
    })
  return assign(nodes)
}

// Whether two flat TOC lists (`getTOC` items: content / lvl / slug / githubSlug,
// all primitives) are item-for-item identical. Replaces the generic `deep-equal`,
// whose per-value type-brand checks cost ~40ms on a 1100-heading document and
// ~110ms on 2700 headings — paid in the idle callback after every keystroke.
// Values are compared with `===`, so any difference `deep-equal`'s loose mode
// would forgive only causes an extra (harmless) store update, never a missed one.
export function isSameToc(a: ReadonlyArray<object>, b: ReadonlyArray<object>): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i] as Record<string, unknown>
    const y = b[i] as Record<string, unknown>
    if (x === y) continue
    const keys = Object.keys(x)
    if (keys.length !== Object.keys(y).length) return false
    for (const k of keys) {
      if (x[k] !== y[k]) return false
    }
  }
  return true
}
