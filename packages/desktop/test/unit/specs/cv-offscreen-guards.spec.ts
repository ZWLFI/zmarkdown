import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 大文档的「屏外块跳过渲染」（content-visibility）是 2026-10-15 性能审计 A 项：
// 开启后 2MB 文档滚动长任务 17.2s → 0、帧 p50 50ms → 10ms。代价是几何变成估算值，
// 所以三件事必须一直成立，否则会退化成「滚动顺滑但跳转/恢复不准」：
//   1. 只对够大的文档开（小文档没有收益，且会让滚动条先粗后细）；
//   2. 换标签恢复滚动位置时优先按「内容锚点」落位（像素在估算几何下不可比）；
//   3. 导出采集内嵌帧尺寸期间保持精确布局（帧尺寸取自活编辑器 DOM）。
// 这些都在 editor.vue 内部、只能按源码形态钉住（与 tab-switch-redundant-work.spec 同法）。

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(
  resolve(here, '../../../src/renderer/src/components/editorWithTabs/editor.vue'),
  'utf8'
)
const lines = source.split('\n')

const regionBetween = (startNeedle: string, endNeedle: string): string => {
  const start = lines.findIndex((l) => l.includes(startNeedle))
  expect(start, `找不到起点：${startNeedle}`).toBeGreaterThan(-1)
  const end = lines.findIndex((l, i) => i > start && l.includes(endNeedle))
  expect(end, `找不到终点：${endNeedle}`).toBeGreaterThan(start)
  return lines.slice(start, end + 1).join('\n')
}

describe('editor.vue — 屏外块跳过渲染（content-visibility）的护栏', () => {
  it('按顶层块数设阈值，小文档不开', () => {
    expect(source).toMatch(/const CV_OFFSCREEN_MIN_BLOCKS = \d+/)
    const apply = regionBetween(
      'const applyOffscreenSkipping = ',
      'const scheduleOffscreenSkipping = '
    )
    expect(apply).toMatch(/blocks < CV_OFFSCREEN_MIN_BLOCKS/)
    expect(apply).toMatch(/classList\.remove\('cv-offscreen'\)/)
    expect(apply).toMatch(/classList\.add\('cv-offscreen'\)/)
  })

  it('滚动时记内容锚点（块下标 + 块顶相对容器顶的偏移）', () => {
    const capture = regionBetween('const captureScrollAnchor = ', 'const restoreScrollAnchor = ')
    expect(capture).toMatch(/scrollAnchorByTab\.set\(tabId, \{ index: found, topRel/)
    // 二分而非线性扫描：滚动事件每帧都会走到这里
    expect(capture).toMatch(/while \(lo <= hi\)/)
    const handler = regionBetween('scrollHandler = () => {', 'container.addEventListener')
    expect(handler).toMatch(/captureScrollAnchor\(container, currentFile\.value\.id\)/)
  })

  it('换标签恢复滚动位置时优先按锚点落位，失效才退回像素', () => {
    const restore = regionBetween("if (typeof scrollTop === 'number') {", '// 换标签：新文档已布局')
    const anchorAt = restore.indexOf('scrollAnchorByTab.get(id)')
    const exact = restore.indexOf('withExactLayout(')
    const pixel = restore.indexOf('scrollToCords(scrollTop)')
    expect(anchorAt).toBeGreaterThan(-1)
    expect(exact).toBeGreaterThan(anchorAt)
    expect(pixel).toBeGreaterThan(exact)
    // cv 挂回会换回混合布局 → 落位后要按同一锚点复位
    expect(restore).toMatch(/pendingAnchorReapply = \{ tabId: id!/)
  })

  it('揭示类操作后按锚点复位（否则挂回 cv 时目标会漂走）', () => {
    const reveal = regionBetween('const scrollElementIntoView = ', 'const scrollToHighlight = ')
    expect(reveal).toMatch(/withExactLayout\(/)
    expect(reveal).toMatch(
      /pendingAnchorReapply = \{ tabId, anchor: \{ index, topRel: STANDAR_Y \} \}/
    )
  })

  it('导出采集内嵌帧尺寸期间保持精确布局', () => {
    const exportRegion = regionBetween('const handleExport = ', 'switch (type) {')
    expect(exportRegion).toMatch(/withExactLayoutAsync\(/)
    expect(exportRegion).toMatch(/inlineFramedHtmlBlocks\(/)
  })
})
