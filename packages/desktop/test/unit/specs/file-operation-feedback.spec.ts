import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parse, compileScript } from 'vue/compiler-sfc'
import ts from 'typescript'
import { ref, computed, watch, nextTick } from 'vue'

// Exercise the real SFC setup without adding a second component test framework.
const setup = (name: string, deps: Record<string, unknown>) => {
  const { descriptor } = parse(readFileSync(resolve('src/renderer/src/components', name), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'feedback-test' }).content
  const js = ts.transpileModule(compiled.split('\n').filter(l => !/^\s*import\s/.test(l)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText
  const mod = { exports: {} }
  const all = { _defineComponent: (x: unknown) => x, ref, computed, watch, nextTick, onMounted: () => {}, onBeforeUnmount: () => {}, t: (key: string, args?: unknown) => key + (args ? JSON.stringify(args) : ''), ...deps }
  // eslint-disable-next-line no-new-func
  return new Function('deps', 'exports', 'module', `const {${Object.keys(all).join(',')}} = deps; ${js}; return module.exports.default.setup({}, {expose(){}})`)(all, mod.exports, mod)
}
const searchSetup = () => {
  const pending: Array<{ resolve: () => void; reject: (e: Error) => void; options: any; cancel: ReturnType<typeof vi.fn> }> = []
  const projectTree = ref({ pathname: '/notes' })
  let unmount = () => {}
  const bus = { on: vi.fn(), off: vi.fn(), emit: vi.fn() }
  class Searcher {
    search(_paths: string[], _keyword: string, options: unknown) {
      let complete!: () => void; let fail!: (e: Error) => void
      const promise = new Promise<void>((resolve, reject) => { complete = resolve; fail = reject }) as Promise<void> & { cancel: () => void }
      promise.cancel = vi.fn()
      pending.push({ resolve: complete, reject: fail, options, cancel: promise.cancel as ReturnType<typeof vi.fn> })
      return promise
    }
  }
  Object.assign(window, { fileUtils: { MARKDOWN_INCLUSIONS: ['*.md'] } })
  const state = setup('sideBar/search.vue', {
    RipgrepDirectorySearcher: Searcher, SearchResultItem: {}, FindCaseIcon: {}, FindWordIcon: {}, FindRegexIcon: {}, VideoPause: {}, bus, log: { error: vi.fn() },
    useLayoutStore: () => ({ rightColumn: ref('search'), showSideBar: ref(true) }),
    useProjectStore: () => ({ projectTree }), useEditorStore: () => ({ currentFile: ref(null) }),
    usePreferencesStore: () => Object.fromEntries(['searchExclusions', 'searchMaxFileSize', 'searchIncludeHidden', 'searchNoIgnore', 'searchFollowSymlinks'].map(k => [k, ref(null)])),
    storeToRefs: (s: unknown) => s, onBeforeUnmount: (f: () => void) => { unmount = f }
  })
  return { state, pending, projectTree, unmount: () => unmount(), bus }
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await nextTick() }
afterEach(() => vi.useRealTimers())
describe('folder search request ownership', () => {
  it('waits for Chinese composition commit and debounces duplicate input', () => {
    vi.useFakeTimers(); const { state, pending } = searchSetup()
    state.beginComposition(); state.keyword.value = 'zhong'; state.queueSearch(); vi.advanceTimersByTime(500)
    expect(pending).toHaveLength(0)
    state.keyword.value = '中文'; state.endComposition(new CompositionEvent('compositionend')); state.queueSearch()
    vi.advanceTimersByTime(200); expect(pending).toHaveLength(1)
  })
  it('ignores completion and failure from superseded requests', async () => {
    const { state, pending } = searchSetup()
    state.keyword.value = 'old'; state.search(); state.keyword.value = 'new'; state.search()
    pending[0].options.didMatch({ path: 'stale', matches: [] }); pending[0].resolve(); await settle()
    expect(state.searcherRunning.value).toBe(true); expect(state.searchResult.value).toEqual([])
    pending[1].options.didMatch({ path: 'new', matches: [] }); pending[1].resolve(); await settle()
    expect(state.searchResult.value[0].path).toBe('new')
    state.search(); state.search(); pending[2].reject(new Error('stale error')); await settle()
    expect(state.searchErrorString.value).toBe(''); expect(state.searcherRunning.value).toBe(true)
  })
  it('cancels pending input and ignores late results after explicit cancel', async () => {
    const { state, pending } = searchSetup(); state.keyword.value = 'abc'; state.search(); state.cancelSearcher()
    pending[0].options.didMatch({ matches: [] }); pending[0].resolve(); await settle()
    expect(state.searchCanceled.value).toBe(true); expect(state.searchResult.value).toEqual([])
    expect(state.showNoResultFoundMessage.value).toBe(false)
  })
  it('distinguishes an error from a completed empty result and allows retry', async () => {
    const { state, pending } = searchSetup(); state.keyword.value = '['; state.search()
    pending[0].reject(new Error('invalid regex')); await settle()
    expect(state.searchErrorString.value).toContain('invalid regex'); expect(state.showNoResultFoundMessage.value).toBe(false)
    state.keyword.value = '中文'; state.search(); pending[1].resolve(); await settle()
    expect(state.searchErrorString.value).toBe(''); expect(state.showNoResultFoundMessage.value).toBe(true)
  })
  it('retains exactly 100 files when the result cap cancels the worker', async () => {
    const { state, pending } = searchSetup(); state.keyword.value = 'x'; state.search()
    for (let i = 0; i < 103; i++) pending[0].options.didMatch({ path: String(i), matches: [] })
    expect(pending[0].cancel).toHaveBeenCalledTimes(1); pending[0].resolve(); await settle()
    expect(state.searchResult.value).toHaveLength(100); expect(state.searchErrorString.value).toContain('searchLimited')
  })
  it('invalidates on folder change and removes listeners on unmount', async () => {
    vi.useFakeTimers(); const { state, pending, projectTree, unmount, bus } = searchSetup()
    state.keyword.value = 'x'; state.search(); projectTree.value = { pathname: '/other' }; await nextTick()
    expect(pending[0].cancel).toHaveBeenCalled(); unmount(); vi.advanceTimersByTime(300)
    pending[0].resolve(); await settle(); expect(pending).toHaveLength(1)
    expect(bus.off).toHaveBeenCalledWith('findInFolder', expect.any(Function))
  })
})
describe('rename dialog feedback', () => {
  it('keeps the draft after failure, prevents duplicate submits and retries the original tab', async () => {
    let reject!: (e: Error) => void
    const editor = { currentFile: { id: 'original', filename: 'old.md' }, RENAME: vi.fn(() => new Promise<void>((_, no) => { reject = no })) }
    const state = setup('rename/index.vue', { useEditorStore: () => editor, bus: { on: vi.fn(), off: vi.fn() } })
    state.handleRename(); state.tempName.value = '中文.md'
    const request = state.confirm(); state.confirm(); expect(editor.RENAME).toHaveBeenCalledTimes(1)
    editor.currentFile = { id: 'other', filename: 'other.md' }; reject(new Error('permission denied')); await request
    expect(state.showRename.value).toBe(true); expect(state.tempName.value).toBe('中文.md'); expect(state.error.value).toBe('permission denied')
    editor.RENAME.mockImplementation(() => Promise.resolve()); await state.confirm()
    expect(editor.RENAME).toHaveBeenLastCalledWith('中文.md', 'original'); expect(state.showRename.value).toBe(false)
  })
  it('does not submit while Enter confirms an IME candidate', () => {
    const rename = vi.fn(); const state = setup('rename/index.vue', { useEditorStore: () => ({ currentFile: { id: 'a', filename: 'a.md' }, RENAME: rename }), bus: { on: vi.fn(), off: vi.fn() } })
    state.handleRename(); state.onEnter(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true }))
    expect(rename).not.toHaveBeenCalled()
  })
})
