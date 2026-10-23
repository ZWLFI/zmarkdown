import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getElectronPath, closeTestApp, setTestFullscreen } from './helpers'

for (const scenario of ['interrupted resize', 'keyboard tabs']) {
  test(scenario, async () => {
    test.setTimeout(60000)
    const dir = mkdtempSync(join(tmpdir(), 'zmarkdown-interaction-'))
    const file = join(dir, '中文 English 123.md')
    writeFileSync(file, '# 阅读与交互\n\n保留正文选择和编辑内容。\n\n' + '中文 English 123。\n\n'.repeat(50))
    const screenshots = resolve(__dirname, '../../../../../evidence/optimization-preview')
    mkdirSync(screenshots, { recursive: true })
    let app: ElectronApplication | undefined
    try {
      app = await _electron.launch({ executablePath: process.env.PANEL_APP || getElectronPath(), args: [...(process.env.PANEL_APP ? [] : [resolve(__dirname, '../..')]), '--user-data-dir', join(dir, 'profile'), file], env: { ...process.env, PERF_TESTING: 'true' } })
      const page = await app.firstWindow()
      await page.waitForSelector('.mu-container')
      await app.evaluate(({ BrowserWindow }) => { const w = BrowserWindow.getAllWindows()[0]; w.setSize(1280, 800); w.focus() })
      if (scenario === 'interrupted resize') {
        await page.locator('.panel-toggle').click()
        const rect = await page.locator('.splitter').boundingBox()
        await page.mouse.move(rect!.x, rect!.y + 100)
        await page.mouse.down()
        await expect(page.locator('.win-body')).toHaveClass(/dragging-split/)
        // Closing the panel while capture is active must clear global selection suppression.
        await page.locator('.panel-collapse').evaluate((e: HTMLElement) => e.click())
        await expect(page.locator('.win-body')).not.toHaveClass(/dragging-split/)
        await page.mouse.up()
        await page.locator('.panel-toggle').click()
        const handle = page.locator('.splitter')
        await handle.focus()
        await page.keyboard.press('ArrowLeft')
        await expect.poll(() => page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(376)
        // A constrained presentation must respond immediately, not consume invisible preferred-width steps.
        for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowLeft')
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(900, 800))
        const before = await page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)
        await handle.focus()
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(before - 16)
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
        for (let i = 0; i < 3; i++) {
          const width = await page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)
          const r = await handle.boundingBox()
          await page.mouse.move(r!.x, r!.y + 100)
          await page.mouse.down()
          await expect(page.locator('.win-body')).toHaveClass(/dragging-split/)
          await page.mouse.move(r!.x - 20, r!.y + 100, { steps: 3 })
          await page.mouse.up()
          await expect.poll(() => page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(width + 20)
          await expect(page.locator('.win-body')).not.toHaveClass(/dragging-split/)
        }
        const r = await handle.boundingBox()
        await page.mouse.move(r!.x, r!.y + 100); await page.mouse.down()
        await handle.dispatchEvent('lostpointercapture', { pointerId: 1 })
        await expect(page.locator('.win-body')).not.toHaveClass(/dragging-split/)
        await page.mouse.up()
        await page.screenshot({ path: join(screenshots, 'resize-light.png') })
      } else {
        await page.locator('.tab-new').click()
        const tabs = page.locator('.tabstrip > .tab')
        await expect(tabs).toHaveCount(2)
        await expect(tabs.last()).toHaveAttribute('tabindex', '0')
        await tabs.last().focus()
        await page.keyboard.press('ArrowLeft')
        await expect(tabs.first()).toBeFocused()
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
        await page.keyboard.press('Tab')
        await expect(tabs.first().locator('.tclose')).toBeFocused()
        await expect(tabs.first().locator('.tclose')).toHaveCSS('opacity', '1')
        await tabs.first().focus()
        await page.keyboard.press('End')
        await expect(tabs.last()).toBeFocused()
        await expect(tabs.last()).toHaveAttribute('aria-selected', 'true')
        for (let i = 0; i < 8; i++) await page.locator('.tab-new').click()
        await tabs.last().focus()
        await page.keyboard.press('Home')
        await expect(tabs.first()).toBeFocused()
        await expect(tabs.first()).toHaveAttribute('aria-selected', 'true')
        await page.locator('.panel-toggle').click()
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700))
        await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { theme: 'dark' }))
        await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
        await tabs.first().focus()
        await page.keyboard.press('End')
        await expect(tabs.last()).toBeFocused()
        const visible = await tabs.last().evaluate(e => {
          const r = e.getBoundingClientRect(), parent = e.parentElement!.getBoundingClientRect()
          return r.left >= parent.left && r.right <= parent.right + 1
        })
        expect(visible).toBe(true)
        await expect(page.locator('.tabstrip')).toHaveCSS('mask-image', 'none')
        await page.screenshot({ path: join(screenshots, 'keyboard-dark-narrow.png') })
        await setTestFullscreen(app, true)
        await expect(page.locator('.editor-tabs')).toHaveClass(/native-fullscreen/)
        await expect.poll(() => tabs.last().evaluate(e => {
          const r = e.getBoundingClientRect(), parent = e.parentElement!.getBoundingClientRect()
          return r.left >= parent.left && r.right <= parent.right + 1
        })).toBe(true)
        await page.screenshot({ path: join(screenshots, 'keyboard-fullscreen.png') })
        await setTestFullscreen(app, false)
        await expect(page.locator('.editor-tabs')).not.toHaveClass(/native-fullscreen/)
      }
    } finally { if (app) await closeTestApp(app); rmSync(dir, { recursive: true, force: true }) }
  })
}
