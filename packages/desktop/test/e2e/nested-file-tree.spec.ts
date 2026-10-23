import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getElectronPath, closeTestApp, setTestFullscreen } from './helpers'

test('nested tree loads on demand, opens exact paths, restores state and aligns fullscreen toggle', async() => {
  test.setTimeout(90000)
  const dir = mkdtempSync(join(tmpdir(), 'zmarkdown-tree-'))
  const root = join(dir, '文档')
  const nested = join(root, '中文目录', '三级')
  mkdirSync(nested, { recursive: true })
  mkdirSync(join(root, '空目录'))
  mkdirSync(join(root, '大量文件'))
  writeFileSync(join(root, '首页.md'), '# 本地目录验收\n\n中英文混排与正文。')
  writeFileSync(join(root, '同名.md'), '# 根文件')
  writeFileSync(join(nested, '同名.md'), '# 深层文件\n\n正确路径。')
  for (let i = 0; i < 1000; i++) writeFileSync(join(root, '大量文件', `${i}.md`), '# test')
  symlinkSync(root, join(nested, '循环链接'))
  const launch = () => _electron.launch({
    executablePath: process.env.TREE_APP || getElectronPath(),
    args: [...(process.env.TREE_APP ? [] : [resolve(__dirname, '../..')]), '--user-data-dir', join(dir, 'profile'), join(root, '首页.md')],
    env: { ...process.env, PERF_TESTING: 'true' }
  })
  let app: ElectronApplication | undefined
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    const toggle = page.locator('.sidebar-toggle').first()
    if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.click()
    await expect(page.locator('.side-bar')).toHaveClass(/open/)
    await page.getByRole('tab', { name: '文件', exact: true }).click()
    const byPath = (p: string) => page.locator(`.sb-row[data-path=${JSON.stringify(p)}]`)
    await expect(page.locator('.side-bar-files .sb-row')).toHaveCount(5)
    await byPath(join(root, '中文目录')).click()
    await byPath(nested).click()
    await expect(byPath(join(nested, '循环链接'))).toBeDisabled()
    await byPath(join(nested, '同名.md')).click()
    await expect(page.locator('.mu-container')).toContainText('深层文件')
    await expect(page.locator('.side-bar-files .sb-head')).toHaveAttribute('title', root)
    await expect(byPath(join(nested, '同名.md'))).toHaveClass(/sel/)
    expect(await byPath(join(nested, '同名.md')).evaluate(e => getComputedStyle(e).paddingLeft)).toBe('44px')
    await byPath(join(root, '空目录')).click()
    await expect(page.locator('.tree-message')).toContainText('空目录')
    await byPath(join(root, '大量文件')).click()
    await expect(page.locator('.side-bar-files .sb-row')).toHaveCount(1008)
    await byPath(join(root, '大量文件')).click()
    await expect(page.locator('.side-bar-files .sb-row')).toHaveCount(8)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    const left = await page.locator('.sidebar-toggle').first().evaluate(e => e.getBoundingClientRect().left)
    expect(left).toBe(88)
    await page.screenshot({ path: resolve(__dirname, '../../../../..', 'evidence/tree-window.png') })
    await setTestFullscreen(app, true)
    await expect(page.locator('.editor-tabs')).toHaveClass(/native-fullscreen/, { timeout: 15000 })
    expect(await page.locator('.sidebar-toggle').first().evaluate(e => e.getBoundingClientRect().left)).toBe(8)
    await page.screenshot({ path: resolve(__dirname, '../../../../..', 'evidence/tree-fullscreen.png') })
    await setTestFullscreen(app, false)
    await expect(page.locator('.editor-tabs')).not.toHaveClass(/native-fullscreen/)
    await page.evaluate(() => window.electron.ipcRenderer.send('mt::set-user-preference', { theme: 'dark' }))
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(640, 800))
    await expect.poll(() => page.evaluate(() => innerWidth)).toBe(640)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    await page.screenshot({ path: resolve(__dirname, '../../../../..', 'evidence/tree-dark-narrow.png') })
    await closeTestApp(app)
    app = await launch()
    page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    await expect(page.locator(`.sb-row[data-path="${nested}"]`)).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator(`.sb-row[data-path="${join(nested, '同名.md')}"]`)).toBeVisible()
  } finally {
    if (app) await closeTestApp(app)
    rmSync(dir, { recursive: true, force: true })
  }
})
