import { expect, test } from '@playwright/test'
import { _electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getElectronPath, closeTestApp, setTestFullscreen } from './helpers'

test('embedded panel aligns, remembers width and retains documents across modes', async () => {
  test.setTimeout(120000)
  const dir = mkdtempSync(join(tmpdir(), 'zmarkdown-embedded-'))
  const file = join(dir, '独立验收.md')
  writeFileSync(file, '# 独立验收\n\n' + '中文 English 123 混排正文。\n\n'.repeat(100))
  const launch = () => _electron.launch({
    executablePath: process.env.PANEL_APP || getElectronPath(),
    args: [...(process.env.PANEL_APP ? [] : [resolve(__dirname, '../..')]), '--user-data-dir', join(dir, 'profile'), file],
    env: { ...process.env, PERF_TESTING: 'true' }
  })
  let app: ElectronApplication | undefined
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    await page.locator('.panel-toggle').click()
    await expect(page.locator('.right-panel-header')).toBeVisible()
    await page.getByRole('tab', { name: '文档', exact: true }).click()
    await expect(page.locator('.bp-doc-toolbar')).toBeVisible()
    expect(await page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(360)
    const geometry = await page.evaluate(() => {
      const rect = (s: string) => document.querySelector(s)!.getBoundingClientRect().toJSON()
      const inner = getComputedStyle(document.querySelector('.bp-inner')!)
      return { header: rect('.right-panel-header'), tabs: rect('.editor-tabs'), body: rect('.bpanel'), status: rect('.workspace-status'), radius: inner.borderRadius, shadow: inner.boxShadow, margin: inner.margin }
    })
    expect(geometry.header.top).toBe(geometry.tabs.top)
    expect(geometry.header.bottom).toBe(geometry.tabs.bottom)
    expect(geometry.header.left).toBe(geometry.body.left)
    expect(geometry.body.bottom).toBe(geometry.status.top)
    expect(geometry.radius).toBe('0px')
    expect(geometry.shadow).toBe('none')
    expect(geometry.margin).toBe('0px')
    await page.locator('.bp-doc-toolbar .open-files').selectOption({ index: 1 })
    await expect(page.locator('.bp-doc-editor .mu-container')).toBeVisible()
    await page.locator('.bp-doc-editor').evaluate(e => e.setAttribute('data-retained', 'yes'))
    const splitter = await page.locator('.splitter').boundingBox()
    await page.mouse.move(splitter!.x, splitter!.y + 100)
    await page.mouse.down()
    await page.mouse.move(splitter!.x - 60, splitter!.y + 100)
    await page.mouse.up()
    await expect.poll(() => page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(420)
    await page.getByRole('tab', { name: '网页', exact: true }).click()
    expect(await page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(420)
    await page.getByRole('tab', { name: '文档', exact: true }).click()
    await expect(page.locator('.bp-doc-editor')).toHaveAttribute('data-retained', 'yes')
    await page.getByRole('tab', { name: '标注', exact: true }).click()
    await expect(page.locator('.ann-panel')).toBeVisible()
    await page.getByRole('tab', { name: '文档', exact: true }).click()
    await page.locator('.bp-doc-editor .editor-component').evaluate(e => { e.scrollTop = 400 })
    expect(await page.locator('.editor-main-col .editor-component').evaluate(e => e.scrollTop)).toBe(0)
    await page.locator('.panel-collapse').click()
    await page.locator('.panel-toggle').click()
    await expect(page.locator('.bp-doc-editor')).toHaveAttribute('data-retained', 'yes')
    await page.screenshot({ path: resolve(__dirname, '../../../../../evidence/embedded-light.png') })
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { showStatusBar: false, theme: 'dark' }))
    await expect(page.locator('.workspace-status')).toHaveCount(0)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(760, 700))
    await expect.poll(() => page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().bottom)).toBe(700)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.screenshot({ path: resolve(__dirname, '../../../../../evidence/embedded-narrow.png') })
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 700))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(640)
    const fits = await page.locator('.right-panel-header').evaluate(e => {
      const boundary = e.getBoundingClientRect()
      return [...e.querySelectorAll('button')].every(button => {
        const r = button.getBoundingClientRect()
        return r.left >= boundary.left && r.right <= boundary.right && r.width >= 24
      })
    })
    expect(fits).toBe(true)
    await page.getByRole('tab', { name: '网页', exact: true }).click()
    await expect(page.locator('.bp-browserbar')).toBeVisible()
    await page.screenshot({ path: resolve(__dirname, '../../../../../evidence/embedded-web.png') })
    await setTestFullscreen(app, true)
    await expect(page.locator('.editor-tabs')).toHaveClass(/native-fullscreen/)
    expect(await page.locator('.right-panel-header').evaluate(e => e.getBoundingClientRect().top)).toBe(0)
    await page.screenshot({ path: resolve(__dirname, '../../../../../evidence/embedded-fullscreen.png') })
    await setTestFullscreen(app, false)
    await expect(page.locator('.editor-tabs')).not.toHaveClass(/native-fullscreen/)
    await closeTestApp(app)
    app = await launch()
    page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    if (await page.locator('.panel-toggle').isVisible()) await page.locator('.panel-toggle').click()
    await expect.poll(() => page.locator('.bpanel').evaluate(e => e.getBoundingClientRect().width)).toBe(420)
  } finally {
    if (app) await closeTestApp(app)
    rmSync(dir, { recursive: true, force: true })
  }
})
