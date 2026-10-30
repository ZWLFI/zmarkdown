import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.hoisted(() => {
  Object.assign(window, {
    path: { sep: '/', dirname: (p: string) => p },
    electron: { clipboard: { writeText: vi.fn() }, ipcRenderer: { send: vi.fn(), on: vi.fn() } }
  })
})
vi.mock('@/services/notification', () => ({ default: { notify: vi.fn() } }))
vi.mock('@/store/bufferedState', () => ({
  debouncedSendBufferedState: vi.fn(),
  sendBufferedState: vi.fn()
}))

import { useEditorStore } from '@/store/editor'
import { usePreferencesStore } from '@/store/preferences'
import { getOptionsFromState } from '@/store/help'
import type { IFileState } from '@shared/types/files'

let store: ReturnType<typeof useEditorStore>
let preferences: ReturnType<typeof usePreferencesStore>
let tab: IFileState
const saves = () =>
  vi
    .mocked(window.electron.ipcRenderer.send)
    .mock.calls.filter((call) => call[0] === 'mt::response-file-save')
const schedule = () =>
  store.HANDLE_AUTO_SAVE({
    id: tab.id,
    filename: tab.filename,
    pathname: tab.pathname,
    markdown: tab.markdown,
    options: getOptionsFromState(tab)
  })

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  setActivePinia(createPinia())
  store = useEditorStore()
  preferences = usePreferencesStore()
  preferences.autoSave = true
  preferences.autoSaveDelay = 1000
  tab = {
    id: 'timer-tab',
    filename: 'note.md',
    pathname: '/tmp/note.md',
    markdown: 'old',
    isSaved: false,
    trimTrailingNewline: 0,
    encoding: { encoding: 'utf8', isBom: false },
    lineEnding: 'lf',
    history: { stack: [{ id: 1 }], lastEditIndex: 0, lastInitIndex: -1, index: 0 }
  } as IFileState
  store.tabs = [tab]
  store.currentFile = tab
  store.tabIdToIndex = { [tab.id]: 0 }
})

afterEach(() => {
  store.tabs = []
  vi.runOnlyPendingTimers()
  vi.useRealTimers()
})

describe('pending automatic saves', () => {
  it('does not write after automatic saving is disabled', () => {
    schedule()
    preferences.autoSave = false
    vi.advanceTimersByTime(1000)
    expect(saves()).toHaveLength(0)
    expect(tab.isSaved).toBe(false)
  })

  it('uses the current path after a rename or Save As while waiting', () => {
    schedule()
    tab.pathname = '/tmp/renamed.md'
    tab.filename = 'renamed.md'
    vi.advanceTimersByTime(1000)
    expect(saves()).toHaveLength(1)
    expect(saves()[0]?.slice(1, 4)).toEqual([tab.id, 'renamed.md', '/tmp/renamed.md'])
  })

  it('takes content, save options and receipt version from one current snapshot', () => {
    schedule()
    tab.markdown = 'newer'
    tab.lineEnding = 'crlf'
    tab.history.stack.push({ id: 2 } as IFileState['history']['stack'][number])
    tab.history.lastEditIndex = 1
    vi.advanceTimersByTime(1000)
    expect(saves()[0]?.[4]).toBe('newer')
    expect(saves()[0]?.[5]).toMatchObject({ lineEnding: 'crlf' })
    expect(saves()[0]?.[7]).toBe(2)
  })

  it('skips a tab that lost its path without opening a save dialog', () => {
    schedule()
    tab.pathname = ''
    vi.advanceTimersByTime(1000)
    expect(saves()).toHaveLength(0)
  })

  it.each(['closed', 'saved'])('skips a %s tab', (state) => {
    schedule()
    if (state === 'closed') store.tabs = []
    else tab.isSaved = true
    vi.advanceTimersByTime(1000)
    expect(saves()).toHaveLength(0)
  })

  it('coalesces repeated edits and writes exactly once after the last delay', () => {
    schedule()
    vi.advanceTimersByTime(500)
    tab.markdown = 'latest'
    schedule()
    vi.advanceTimersByTime(500)
    expect(saves()).toHaveLength(0)
    vi.advanceTimersByTime(500)
    expect(saves()).toHaveLength(1)
    expect(saves()[0]?.[4]).toBe('latest')
    vi.advanceTimersByTime(5000)
    expect(saves()).toHaveLength(1)
  })

  it('can resume on a fresh edit after a disabled timer expires', () => {
    schedule()
    preferences.autoSave = false
    vi.advanceTimersByTime(1000)
    expect(saves()).toHaveLength(0)
    preferences.autoSave = true
    tab.markdown = 'resumed'
    schedule()
    vi.advanceTimersByTime(1000)
    expect(saves()).toHaveLength(1)
    expect(saves()[0]?.[4]).toBe('resumed')
  })
})
