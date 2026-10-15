import { describe, it, expect } from 'vitest'
import { deriveKeyedToc, isSameToc } from '@/util/tocKeys'

// #3791: the TOC's collapse state is remembered by these keys. They must be
// derived from the content-based `githubSlug` so they survive a tab switch
// (which rebuilds every heading block with a fresh object-identity `slug`),
// not only same-tab edits (#3028).

const flatKeys = (nodes: ReturnType<typeof deriveKeyedToc>): string[] =>
  nodes.flatMap((n) => [n.key, ...flatKeys(n.children)])

describe('deriveKeyedToc', () => {
  it('keys nodes by githubSlug, deduplicated in document order', () => {
    const keyed = deriveKeyedToc([
      { label: 'Intro', slug: 'uid-1', githubSlug: 'intro', children: [] },
      { label: 'Intro', slug: 'uid-2', githubSlug: 'intro', children: [] }
    ])
    expect(keyed.map((n) => n.key)).toEqual(['intro', 'intro-1'])
  })

  it('produces identical keys when the same document is rebuilt with fresh slugs (tab switch)', () => {
    // Same headings/content, different per-render object-identity slugs — this
    // is exactly what Editor.setContent does when you switch back to a tab.
    const doc = (p: string) => [
      {
        label: 'A',
        slug: `${p}-1`,
        githubSlug: 'a',
        children: [{ label: 'B', slug: `${p}-2`, githubSlug: 'b', children: [] }]
      },
      { label: 'C', slug: `${p}-3`, githubSlug: 'c', children: [] }
    ]

    const before = deriveKeyedToc(doc('old'))
    const after = deriveKeyedToc(doc('new'))

    // Keys are stable across the rebuild, so collapse state keyed by them
    // survives the switch (they would differ if keyed by `slug`).
    expect(flatKeys(after)).toEqual(flatKeys(before))
    expect(flatKeys(after)).toEqual(['a', 'b', 'c'])
  })

  it('falls back to a stable placeholder for unsluggable headings', () => {
    const keyed = deriveKeyedToc([
      { label: '🎉', slug: 'uid-1', githubSlug: '', children: [] },
      { label: '🎊', slug: 'uid-2', githubSlug: '', children: [] }
    ])
    expect(keyed.map((n) => n.key)).toEqual(['heading', 'heading-1'])
  })

  it('preserves slug (for the scroll-to-heading payload) while keying by githubSlug', () => {
    const keyed = deriveKeyedToc([{ label: 'A', slug: 'uid-42', githubSlug: 'a', children: [] }])
    expect(keyed[0].slug).toBe('uid-42')
    expect(keyed[0].key).toBe('a')
  })
})

// The store skips a TOC update when the fresh `getTOC()` list is item-for-item
// identical to the stored one. This replaced the generic `deep-equal`, which
// cost ~40ms (1100 headings) to ~110ms (2700 headings) per idle tick while
// typing; it must still report every real change.
describe('isSameToc', () => {
  const item = (content: string, lvl = 2, slug = `uid-${content}`) => ({
    content,
    lvl,
    slug,
    githubSlug: content.toLowerCase()
  })

  it('treats equal lists (distinct objects) as the same', () => {
    expect(isSameToc([item('A'), item('B', 3)], [item('A'), item('B', 3)])).toBe(true)
    expect(isSameToc([], [])).toBe(true)
  })

  it('reports length, order, level, text and slug changes', () => {
    const base = [item('A'), item('B')]
    expect(isSameToc(base, [item('A')])).toBe(false)
    expect(isSameToc(base, [item('B'), item('A')])).toBe(false)
    expect(isSameToc(base, [item('A'), item('B', 3)])).toBe(false)
    expect(isSameToc(base, [item('A'), { ...item('B'), content: 'B!' }])).toBe(false)
    expect(isSameToc(base, [item('A'), item('B', 2, 'uid-other')])).toBe(false)
  })

  it('reports added or removed fields', () => {
    const extra = { ...item('A'), anchor: 'x' }
    expect(isSameToc([item('A')], [extra])).toBe(false)
    expect(isSameToc([extra], [item('A')])).toBe(false)
  })

  it('compares strictly (a loosely-equal value still counts as a change)', () => {
    expect(isSameToc([item('A', 1)], [{ ...item('A'), lvl: '1' as unknown as number }])).toBe(false)
  })
})
