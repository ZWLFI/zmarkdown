import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
vi.mock('electron', () => ({ ipcMain: { handle: vi.fn(), on: vi.fn() } }))
vi.mock('child_process', () => { const spawn = vi.fn(); return { spawn, default: { spawn } } })
vi.mock('electron-log', () => ({ default: { warn: vi.fn(), error: vi.fn() } }))
vi.mock('@vscode/ripgrep', () => ({ rgPath: '/fake/rg' }))
import { ipcMain } from 'electron'
import { spawn } from 'child_process'
import { registerRipgrepHandlers } from 'main_renderer/ipc/ripgrep'

describe('text search completion distinguishes errors, no results and cancellation', () => {
  let child: EventEmitter & { stderr: EventEmitter; stdout: EventEmitter; kill: ReturnType<typeof vi.fn> }
  let sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn>; once: ReturnType<typeof vi.fn> }
  beforeEach(() => {
    vi.clearAllMocks()
    child = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), stdout: new EventEmitter(), kill: vi.fn() })
    vi.mocked(spawn).mockReturnValue(child as never)
    sender = { isDestroyed: () => false, send: vi.fn(), once: vi.fn() }
    registerRipgrepHandlers()
    const start = vi.mocked(ipcMain.handle).mock.calls.find(([name]) => name === 'mt::rg::start')![1]
    start({ sender } as never, { searchId: 'test', mode: 'text', directories: ['/tmp'], pattern: '[', options: { isRegexp: true } })
  })
  it('reports invalid regex stderr and never follows it with a success', () => {
    child.stderr.emit('data', 'regex parse error: unclosed character class\n')
    child.emit('close', 2); child.emit('error', new Error('late error'))
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('mt::rg::error', { searchId: 'test', error: 'regex parse error: unclosed character class' })
  })
  it('keeps exit 1 as a successful empty search', () => {
    child.emit('close', 1)
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('mt::rg::done', { searchId: 'test' })
  })
  it('reports unexpected termination even without stderr', () => {
    child.emit('close', null)
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('mt::rg::error', { searchId: 'test', error: 'Ripgrep exited with code null' })
  })
  it('cancel ignores later process errors and completion', () => {
    const cancel = vi.mocked(ipcMain.on).mock.calls.find(([name]) => name === 'mt::rg::cancel')![1]
    cancel({ sender } as never, 'test')
    child.stderr.emit('data', 'interrupted'); child.emit('close', 2)
    expect(child.kill).toHaveBeenCalledOnce()
    expect(sender.send).toHaveBeenCalledExactlyOnceWith('mt::rg::cancelled', { searchId: 'test' })
  })
})
