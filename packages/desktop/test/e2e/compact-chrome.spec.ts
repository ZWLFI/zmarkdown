import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getElectronPath, closeTestApp } from './helpers'

test('compact Mac chrome preserves window operations and status/width preferences across restart', async() => {
  test.skip(process.platform !== 'darwin', 'Native Mac chrome')
  test.setTimeout(60000)
  const dir = mkdtempSync(join(tmpdir(), 'momark-compact-'))
  const file = join(dir, '验收.md')
  writeFileSync(file, '# 阅读宽度\n\n中文 English 123。\n\n```js\n' + 'const wide = 123; '.repeat(90) + '\n```\n')
  const launch = () => _electron.launch({
    executablePath: getElectronPath(),
    args: [resolve(__dirname, '../..'), '--user-data-dir', join(dir, 'profile'), file],
    env: { ...process.env, PERF_TESTING: 'true' }
  })
  let app: ElectronApplication | undefined
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    await expect(page.locator('.title-bar')).toHaveCount(0)
    expect(await page.locator('.editor-chrome').evaluate(e => e.getBoundingClientRect().top)).toBe(0)
    expect(await page.locator('.workspace-status').evaluate(e => e.getBoundingClientRect().height)).toBe(24)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getWindowButtonPosition())).toEqual({ x: 12, y: 13 })
    expect(await page.locator('.window-drag-region').evaluate(e => getComputedStyle(e).getPropertyValue('-webkit-app-region'))).toBe('drag')
    expect(await page.locator('.tabstrip').evaluate(e => getComputedStyle(e).getPropertyValue('-webkit-app-region'))).toBe('no-drag')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].minimize())
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(true)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].restore())
    await expect.poll(() => app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMinimized())).toBe(false)
    const comfortable = await page.locator('.mu-container').evaluate(e => getComputedStyle(e).maxWidth)
    await page.locator('.status-actions button').first().click()
    await expect.poll(() => page.locator('.mu-container').evaluate(e => getComputedStyle(e).maxWidth)).toBe('100%')
    expect(await page.locator('.mu-container').evaluate(e => getComputedStyle(e).paddingLeft)).toBe('16px')
    const wideWidth = await page.locator('.mu-container').evaluate(e => e.clientWidth)
    for (let i = 0; i < 2; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        for (const type of ['keyDown', 'keyUp'] as const) {
          w.webContents.sendInputEvent({ type, keyCode: 'B', modifiers: ['control'] })
        }
      })
      await expect(page.locator('.distraction-free')).toHaveCount(i === 0 ? 1 : 0)
      expect(await page.locator('.mu-container').evaluate(e => e.clientWidth)).toBe(wideWidth)
    }
    await page.locator('.status-actions button').first().click()
    await expect.poll(() => page.locator('.mu-container').evaluate(e => getComputedStyle(e).maxWidth)).toBe(comfortable)
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { showStatusBar: false }))
    await expect(page.locator('.workspace-status')).toHaveCount(0)
    for (let i = 0; i < 2; i++) {
      await app.evaluate(({ BrowserWindow }) => {
        const w = BrowserWindow.getAllWindows()[0]
        w.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'B', modifiers: ['control'] })
        w.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'B', modifiers: ['control'] })
      })
      await expect(page.locator('.distraction-free')).toHaveCount(i === 0 ? 1 : 0)
    }
    await expect(page.locator('.workspace-status')).toHaveCount(0)
    await closeTestApp(app)
    app = await launch()
    page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    await expect(page.locator('.workspace-status')).toHaveCount(0)
    expect(await page.locator('.mu-container').evaluate(e => getComputedStyle(e).maxWidth)).toBe(comfortable)
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { showStatusBar: true }))
    await expect(page.locator('.workspace-status')).toBeVisible()
  } finally {
    if (app) await closeTestApp(app)
    rmSync(dir, { recursive: true, force: true })
  }
})
