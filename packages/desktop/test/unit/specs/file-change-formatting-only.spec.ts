import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  const w = globalThis as unknown as {
    window?: {
      path?: { sep: string; dirname: (p: string) => string }
      fileUtils?: { isSamePathSync: (a: string, b: string) => boolean }
      electron?: { ipcRenderer: { send: (...a: unknown[]) => void; on: Mock } }
    }
  }
  w.window ??= {}
  w.window.path ??= { sep: '/', dirname: (p: string) => p }
  w.window.fileUtils ??= { isSamePathSync: (a, b) => a === b }
  w.window.electron ??= { ipcRenderer: { send: () => {}, on: vi.fn() } }
})

vi.mock('@/services/notification', () => ({
  default: { notify: vi.fn(), name: 'notify' }
}))
vi.mock('@/store/bufferedState', () => ({ debouncedSendBufferedState: vi.fn() }))
// 断言路径只需要 autoSave 一个字段；用默认（代码默认 true）会把测试拖进
// loadChange（需要完整的标签夹具）。关掉后行为等价于用户的实际偏好。
vi.mock('@/store/preferences', () => ({ usePreferencesStore: () => ({ autoSave: false }) }))

import { useEditorStore } from '@/store/editor'

// 2026-10-13：外部写入者（agent/其他编辑器）写出的文件通常不是引擎规范形态
// ——最典型的是表格填充（`| a | b |` vs 引擎的 `| a   | b   |`）。此前用原始串
// 直接比，纯格式差异也弹「已在磁盘上发生变更」横幅、把标签置脏，而点重新加载后
// 画面不会有任何变化。这里覆盖「渲染语义一致 → 静默跳过」的新判据。
describe('useEditorStore LISTEN_FOR_FILE_CHANGE — formatting-only external rewrite', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(window.electron.ipcRenderer.on as Mock).mockReset()
  })

  // 模拟引擎的规范化：把连续空格压成单个（等价于表格填充归一）
  const canonicalize = (md: string): string => md.replace(/[ \t]+/g, ' ')

  const makeSavedTab = (store: ReturnType<typeof useEditorStore>, markdown: string) => {
    const tab = {
      id: 'tab-1',
      filename: 'a.md',
      pathname: '/x/a.md',
      markdown,
      isSaved: true,
      notifications: []
    }
    store.tabs = [tab] as unknown as typeof store.tabs
    store.tabIdToIndex = { 'tab-1': 0 }
    return tab
  }

  const captureHandler = () => {
    const onMock = window.electron.ipcRenderer.on as Mock
    const call = onMock.mock.calls.find((c) => c[0] === 'mt::update-file')!
    return call[1] as (e: unknown, payload: unknown) => void
  }

  const fire = (handler: ReturnType<typeof captureHandler>, markdown: string) =>
    handler(null, { type: 'change', change: { pathname: '/x/a.md', data: { markdown } } })

  const BUFFER = '| a | b |\n| --- | --- |\n| 1 | 2 |\n'
  const PADDED = '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n'

  it('ignores a rewrite that differs only in engine-normalized formatting', () => {
    const store = useEditorStore()
    store.SET_MARKDOWN_CANONICALIZER(canonicalize)
    const tab = makeSavedTab(store, BUFFER)
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), PADDED)

    expect(notifySpy).not.toHaveBeenCalled()
    expect(tab.isSaved).toBe(true)
  })

  it('still warns when the rewrite changes the rendered content', () => {
    const store = useEditorStore()
    store.SET_MARKDOWN_CANONICALIZER(canonicalize)
    const tab = makeSavedTab(store, BUFFER)
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), '| a | b |\n| --- | --- |\n| 1 | 3 |\n')

    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(tab.isSaved).toBe(false)
  })

  it('falls back to the byte comparison when no canonicalizer is registered', () => {
    const store = useEditorStore()
    store.SET_MARKDOWN_CANONICALIZER(null)
    const tab = makeSavedTab(store, BUFFER)
    const notifySpy = vi.spyOn(store, 'pushTabNotification').mockImplementation(() => {})
    store.LISTEN_FOR_FILE_CHANGE()

    fire(captureHandler(), PADDED)

    expect(notifySpy).toHaveBeenCalledTimes(1)
    expect(tab.isSaved).toBe(false)
  })
})
