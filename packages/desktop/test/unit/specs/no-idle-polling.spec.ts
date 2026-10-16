import { afterEach, describe, expect, it, vi } from 'vitest'

// 设置页侧栏的搜索配置模块（被路由静态引入，所以每个窗口——编辑器 / 欢迎页 / 设置——
// 都会加载）曾在模块顶层 setInterval 每秒轮询一次界面语言，派发一个没有任何监听方的
// `languageChanged` 事件：渲染进程每秒被白白唤醒一次（2026-10-15 空闲 trace：
// 10 秒 10 次 TimerFire，全部来自这里）。钉住：加载该模块不再登记任何周期定时器。

afterEach(() => {
  vi.restoreAllMocks()
})

describe('preference sidebar search config — no idle polling', () => {
  it('importing the module registers no interval timer', async () => {
    const spy = vi.spyOn(globalThis, 'setInterval')
    vi.resetModules()
    await import('@/prefComponents/sideBar/config')
    expect(spy).not.toHaveBeenCalled()
  })
})
