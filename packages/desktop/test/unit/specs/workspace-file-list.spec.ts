import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, reactive, toRefs } from 'vue'
import path from 'pathe'
import Tree from '../../../src/renderer/src/components/sideBar/tree.vue'

interface TestState { currentFile: { pathname: string }; tabs: Array<{ pathname: string }> }
const shared = vi.hoisted(() => ({ state: null as unknown as TestState }))
vi.mock('../../../src/renderer/src/store/editor', () => ({ useEditorStore: () => shared.state }))
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
  shared.state = reactive({
    currentFile: { pathname: '/notes/a.md' },
    tabs: [{ pathname: '/notes/a.md' }, { pathname: '/notes/b.md' }]
  })
  Object.assign(window, {
    path,
    fileUtils: {
      readdir: vi.fn().mockResolvedValue(['a.md', 'b.md', 'b.markdown']),
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
    expect(window.fileUtils.readdir).toHaveBeenCalledTimes(1)
    const input = host.querySelector('input')!
    input.value = 'b.'
    input.dispatchEvent(new Event('input'))
    await settle()
    expect(host.querySelectorAll('.sb-row')).toHaveLength(2)
    expect(host.textContent).toContain('b.md')
    expect(window.fileUtils.readdir).toHaveBeenCalledTimes(1)
  })
  it('ignores stale directory responses and supports explicit refresh', async() => {
    await settle()
    let finishOld!: (value: string[]) => void
    vi.mocked(window.fileUtils.readdir)
      .mockImplementationOnce(
        () =>
          new Promise<string[]>((resolve) => {
            finishOld = resolve
          })
      )
      .mockResolvedValueOnce(['new.md'])
    shared.state.currentFile = { pathname: '/old/a.md' }
    await nextTick()
    shared.state.currentFile = { pathname: '/new/new.md' }
    await settle()
    finishOld(['stale.md'])
    await settle()
    expect(host.textContent).toContain('new')
    expect(host.textContent).not.toContain('stale')
    vi.mocked(window.fileUtils.readdir).mockResolvedValueOnce(['new.md', 'added.md'])
    host.querySelector('button')!.click()
    await settle()
    expect(host.textContent).toContain('added')
  })
})
