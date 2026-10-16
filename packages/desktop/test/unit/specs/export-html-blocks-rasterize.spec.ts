import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type * as MuyaCore from '@muyajs/core'

// 导出 PDF / 打印 / docx 时，带脚本的内嵌 HTML 块要逐块离屏截图。每块大半时间是主进程
// 等内容稳定、等出帧的固定时长（实测约 440ms/块），原先严格串行；现在最多 3 块并发。
// 这里钉住：结果仍按文档顺序替换、并发不超过上限、任何一块失败整篇按原样导出且不再
// 发起新的截图。

const targets = vi.hoisted(() =>
  Array.from({ length: 7 }, (_, i) => ({
    html: `<div id="b${i}"><script>1</script></div>`,
    width: 100 + i,
    height: 50,
    zoom: 1,
    auto: true
  }))
)

vi.mock('@muyajs/core', async (importOriginal) => ({
  ...(await importOriginal<typeof MuyaCore>()),
  collectHtmlFrameTargets: () => targets
}))
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }))

const { inlineFramedHtmlBlocks, RASTERIZE_CONCURRENCY } = await import('@/util/exportHtmlBlocks')

const markdown = targets.map((t, i) => `段落 ${i}\n\n${t.html}\n`).join('\n')
const muya = { domNode: document.createElement('div') } as never

let inFlight = 0
let peak = 0
let calls: number[] = []
let failAt = -1

beforeEach(() => {
  inFlight = 0
  peak = 0
  calls = []
  failAt = -1
  ;(window as unknown as { electron: unknown }).electron = {
    ipcRenderer: {
      invoke: async (_channel: string, args: { width: number }) => {
        const index = args.width - 100
        calls.push(index)
        inFlight++
        peak = Math.max(peak, inFlight)
        // 后面的块先完成：检验结果不是按完成顺序排的。
        await new Promise((resolve) => setTimeout(resolve, 30 - index * 3))
        inFlight--
        return index === failAt ? null : { dataUrl: `data:image/png;base64,B${index}` }
      }
    }
  }
})

afterEach(() => {
  delete (window as unknown as { electron?: unknown }).electron
})

describe('inlineFramedHtmlBlocks — image export rasterizes blocks concurrently', () => {
  it('replaces every block with its own snapshot, in document order', async () => {
    const out = await inlineFramedHtmlBlocks(muya, markdown)
    const order = [...out.markdown.matchAll(/base64,B(\d+)/g)].map((m) => Number(m[1]))
    expect(order).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(out.markdown).not.toContain('<script>')
    for (let i = 0; i < targets.length; i++) expect(out.markdown).toContain(`段落 ${i}`)
  })

  it('never runs more than RASTERIZE_CONCURRENCY snapshots at once', async () => {
    await inlineFramedHtmlBlocks(muya, markdown)
    expect(RASTERIZE_CONCURRENCY).toBe(3)
    expect(peak).toBe(RASTERIZE_CONCURRENCY)
    expect([...calls].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('a failed snapshot exports the document unchanged and stops issuing new ones', async () => {
    failAt = 1
    const out = await inlineFramedHtmlBlocks(muya, markdown)
    expect(out.markdown).toBe(markdown)
    expect(calls.length).toBeLessThan(targets.length)
  })
})
