import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 大文件打开 / 切换标签的冗余整篇工作（2026-10-14 实测：5MB 文档打开时引擎
// 整篇 setContent 三次、切换两次，另有一次被立即覆盖的强制同步布局）。
// editor.vue 的这几处只能按源码形态钉住，防止被改回去：
//   1. 左右双开同步 watch 在当前标签 id 变化时直接返回（内容已由 file-changed 装好）；
//   2. 新开标签：file-loaded 不再重复 setContent 刚由 file-changed 装好的同一份内容；
//   3. 切换时只在首次激活时为保存追踪整篇序列化一次；
//   4. currentFile watch 不再触发 scrollToCursor（会被 file-changed 的滚动恢复覆盖）。

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

describe('editor.vue — no redundant whole-document work on open / tab switch', () => {
  it('the left/right sync watch returns on a tab change before any serialization', () => {
    const skip = source.indexOf('if (id !== prevId) return')
    const marker = source.indexOf('editorStore.IS_ENGINE_OWN_WRITE(tab.id, md)')

    expect(skip).toBeGreaterThan(-1)
    expect(skip).toBeLessThan(marker)
  })

  it('file-loaded skips setContent for content file-changed just loaded', () => {
    const loaded = regionBetween('const setMarkdownToEditor = ', 'focusFreshEditor()')
    expect(loaded).toMatch(
      /if \(!isJustLoaded\(id, newMarkdown \?\? ''\)\) \{\s*editor\.value\.setContent/
    )

    const switched = regionBetween(
      '// Tab switch / programmatic content swap',
      'lastTabId.value = id'
    )
    expect(switched).toMatch(
      /editor\.value\.setContent\(newMarkdown\)\s*markJustLoaded\(id, newMarkdown\)/
    )
  })

  it('the just-loaded mark expires after the current task', () => {
    const mark = regionBetween('const markJustLoaded = ', 'const isJustLoaded')
    expect(mark).toMatch(/queueMicrotask\(/)
  })

  it('seeds the save-tracking baseline only on first activation of a tab', () => {
    const switched = regionBetween(
      '// Tab switch / programmatic content swap',
      '} else if (newCursor)'
    )
    expect(switched).toMatch(
      /if \(id && !syntheticHistoryByTab\.has\(id\)\) \{\s*getSyntheticHistory\(id, editor\.value\.getMarkdown\(\)\)/
    )
  })

  it('the currentFile watch does not scroll (file-changed restores the scroll position)', () => {
    const watcher = regionBetween(
      'watch(currentFile, (value, oldValue) => {',
      'hideAllFloatTools()'
    )
    expect(watcher).not.toMatch(/scrollToCursor\s*\(/)
  })
})
