import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, reactive, toRefs } from 'vue'
import path from 'pathe'
import Tree from '../../../src/renderer/src/components/sideBar/tree.vue'

interface TestState { currentFile: { pathname: string }; tabs: Array<{ pathname: string }> }
const shared = vi.hoisted(() => ({ state: null as unknown as TestState }))
vi.mock('../../../src/renderer/src/store/editor', () => ({ useEditorStore: () => shared.state }))
vi.mock('../../../src/renderer/src/store/project', () => ({ useProjectStore: () => reactive({ projectTree: { pathname: '/unrelated-project' } }) }))
vi.mock('pinia', () => ({ storeToRefs: (state: TestState) => toRefs(state) }))
vi.mock('../../../src/renderer/src/i18n', () => ({ t: (key: string) => key }))
let app: ReturnType<typeof createApp>
let host: HTMLDivElement
const settle = async() => {
  await Promise.resolve()
  await nextTick()
  await Promise.resolve()
  await nextTick()
}

beforeEach(() => {
  const storage = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) })
  shared.state = reactive({
    currentFile: { pathname: '/notes/a.md' },
    tabs: [{ pathname: '/notes/a.md' }, { pathname: '/notes/b.md' }]
  })
  Object.assign(window, {
    path,
    fileUtils: {
      readDirectory: vi.fn().mockResolvedValue(['a.md', 'b.md', 'b.markdown'].map(name => ({ name, kind: 'file' }))),
      isChildOfDirectory: (dir: string, file: string) => file.startsWith(dir + '/'),
      hasMarkdownExtension: (name: string) => /\.(md|markdown)$/.test(name),
      isSamePathSync: (a: string, b: string) => a === b
    }
  })
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(Tree)
  app.mount(host)
})
afterEach(() => {
  app.unmount()
  host.remove()
})

describe('workspace file list', () => {
  it('does not rescan the same directory on tab switches and filters locally', async() => {
    await settle()
    shared.state.currentFile = { pathname: '/notes/b.md' }
    await settle()
    expect(window.fileUtils.readDirectory).toHaveBeenCalledTimes(1)
    const input = host.querySelector('input')!
    input.value = 'b.'
    input.dispatchEvent(new Event('input'))
    await settle()
    expect(host.querySelectorAll('.sb-row')).toHaveLength(2)
    expect(host.textContent).toContain('b.md')
    expect(window.fileUtils.readDirectory).toHaveBeenCalledTimes(1)
  })
  it('ignores stale directory responses and supports explicit refresh', async() => {
    await settle()
    let finishOld!: (value: Array<{ name: string; kind: 'file' }>) => void
    vi.mocked(window.fileUtils.readDirectory)
      .mockImplementationOnce(
        () =>
          new Promise<Array<{ name: string; kind: 'file' }>>((resolve) => {
            finishOld = resolve
          })
      )
      .mockResolvedValueOnce([{ name: 'new.md', kind: 'file' }])
    shared.state.currentFile = { pathname: '/old/a.md' }
    await nextTick()
    shared.state.currentFile = { pathname: '/new/new.md' }
    await settle()
    finishOld([{ name: 'stale.md', kind: 'file' }])
    await settle()
    expect(host.textContent).toContain('new')
    expect(host.textContent).not.toContain('stale')
    vi.mocked(window.fileUtils.readDirectory).mockResolvedValueOnce([{ name: 'new.md', kind: 'file' }, { name: 'added.md', kind: 'file' }])
    host.querySelector('button')!.click()
    await settle()
    expect(host.textContent).toContain('added')
  })
})

describe('lazy directory hierarchy', () => {
  it('loads only expanded directories, preserves the root on deep file activation and never follows links', async() => {
    await settle()
    Object.assign(window, { electron: { ipcRenderer: { send: vi.fn() } } })
    const listings = {
      '/notes': [{ name: '中文', kind: 'directory' }, { name: 'loop', kind: 'link' }],
      '/notes/中文': [{ name: '深层', kind: 'directory' }, { name: 'same.md', kind: 'file' }],
      '/notes/中文/深层': [{ name: 'same.md', kind: 'file' }]
    }
    vi.mocked(window.fileUtils.readDirectory).mockImplementation(async p => listings[p as keyof typeof listings] as Awaited<ReturnType<typeof window.fileUtils.readDirectory>>)
    host.querySelector<HTMLButtonElement>('.file-tools button')!.click()
    await settle()
    const count = vi.mocked(window.fileUtils.readDirectory).mock.calls.length
    expect(host.querySelectorAll('.sb-row')).toHaveLength(2)
    host.querySelector<HTMLButtonElement>('[data-path="/notes/中文"]')!.click()
    await settle()
    expect(window.fileUtils.readDirectory).toHaveBeenCalledTimes(count + 1)
    host.querySelector<HTMLButtonElement>('[data-path="/notes/中文/深层"]')!.click()
    await settle()
    const deep = host.querySelector<HTMLButtonElement>('[data-path="/notes/中文/深层/same.md"]')!
    expect(deep.style.paddingLeft).toBe('44px')
    deep.click()
    expect(window.electron.ipcRenderer.send).toHaveBeenCalledWith('mt::open-file', '/notes/中文/深层/same.md', {})
    shared.state.currentFile = { pathname: '/notes/中文/深层/same.md' }
    await settle()
    expect(host.querySelector('.sb-head')!.textContent!.trim()).toBe('文件夹 · /notes')
    expect(host.querySelector<HTMLButtonElement>('[data-path="/notes/loop"]')!.disabled).toBe(true)
    expect(window.fileUtils.readDirectory).not.toHaveBeenCalledWith('/notes/loop')
    host.querySelector<HTMLButtonElement>('[data-path="/notes/中文"]')!.click()
    await settle()
    expect(host.querySelector('[data-path="/notes/中文/深层/same.md"]')).toBeNull()
    expect(JSON.parse(localStorage.getItem('workspace-file-tree-v1')!).expanded).not.toContain('/notes/中文')
  })
  it('distinguishes empty folders and permission failures and allows retry', async() => {
    await settle()
    vi.mocked(window.fileUtils.readDirectory).mockResolvedValueOnce([{ name: 'empty', kind: 'directory' }, { name: 'denied', kind: 'directory' }])
    host.querySelector<HTMLButtonElement>('.file-tools button')!.click()
    await settle()
    vi.mocked(window.fileUtils.readDirectory).mockResolvedValueOnce([])
    host.querySelector<HTMLButtonElement>('[data-path="/notes/empty"]')!.click()
    await settle()
    expect(host.textContent).toContain('空目录')
    vi.mocked(window.fileUtils.readDirectory).mockRejectedValueOnce(new Error('EACCES'))
    host.querySelector<HTMLButtonElement>('[data-path="/notes/denied"]')!.click()
    await settle()
    expect(host.textContent).toContain('无法读取目录')
    host.querySelector<HTMLButtonElement>('[data-path="/notes/denied"]')!.click()
    await settle()
    vi.mocked(window.fileUtils.readDirectory).mockResolvedValueOnce([{ name: 'recovered.md', kind: 'file' }])
    host.querySelector<HTMLButtonElement>('[data-path="/notes/denied"]')!.click()
    await settle()
    expect(host.textContent).toContain('recovered.md')
  })
})
