import { test, expect } from '@playwright/test'
import { _electron, type ElectronApplication } from 'playwright'
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { getElectronPath, closeTestApp } from './helpers'

test('sidebars share chrome and preserve width, tree errors and annotation actions', async () => {
  test.setTimeout(120000)
  const dir = mkdtempSync(join(tmpdir(), 'zmarkdown-unified-'))
  const file = join(dir, '侧栏验收.md')
  const missing = join(dir, '删除后读取失败')
  mkdirSync(missing)
  writeFileSync(file, '# 统一侧栏\n\n正文中文 English 123。\n\n## 第二节\n\n' + '滚动正文。\n\n'.repeat(80))
  const launch = () => _electron.launch({ executablePath: process.env.PANEL_APP || getElectronPath(),
    args: [...(process.env.PANEL_APP ? [] : [resolve(__dirname, '../..')]), '--user-data-dir', join(dir, 'profile'), file], env: { ...process.env, PERF_TESTING: 'true' } })
  let app: ElectronApplication | undefined
  try {
    app = await launch()
    let page = await app.firstWindow()
    await page.waitForSelector('.mu-container')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280,800))
    if (!(await page.locator('.left-panel-header').isVisible())) await page.locator('.sidebar-toggle').click()
    await page.locator('.panel-toggle').click()
    await page.getByRole('tab', {name:'标注',exact:true}).click()
    await page.getByRole('tab', {name:'大纲',exact:true}).click()
    const metrics = await page.evaluate(() => {
      const r=(s:string)=>document.querySelector(s)!.getBoundingClientRect().toJSON()
      const bg=(s:string)=>getComputedStyle(document.querySelector(s)!).backgroundColor
      return {left:r('.left-panel-header'),right:r('.right-panel-header'),tabs:r('.editor-tabs'),side:r('.side-bar'),lb:bg('.sb-inner'),rb:bg('.bp-body')}
    })
    expect(metrics.left.width).toBe(260)
    expect(metrics.left.bottom).toBe(metrics.tabs.bottom)
    expect(metrics.right.bottom).toBe(metrics.tabs.bottom)
    expect(metrics.left.right).toBe(metrics.side.right)
    expect(metrics.lb).toBe(metrics.rb)
    await expect(page.locator('.side-bar-toc .sb-head')).toHaveAttribute('title','统一侧栏')
    await expect(page.locator('.ann-foot > .btn-primary')).toBeDisabled()
    await page.locator('.ann-foot > .btn-ghost').click()
    await page.locator('.ann-composer textarea').fill('独立验收全局备注')
    await page.locator('.ann-composer .btn-primary').click()
    await expect(page.locator('.ann-list')).toContainText('独立验收全局备注')
    await expect(page.locator('.ann-foot > .btn-primary')).toBeEnabled()
    await page.getByRole('tab',{name:'历史',exact:true}).click()
    await page.getByRole('tab',{name:'当前',exact:true}).click()
    await expect(page.locator('.ann-list')).toContainText('独立验收全局备注')
    await page.screenshot({path:resolve(__dirname,'../../../../../evidence/unified-light.png')})
    const h=await page.locator('.sb-resize-handle').boundingBox()
    await page.mouse.move(h!.x+4,h!.y+100);await page.mouse.down();await page.mouse.move(300,h!.y+100);await page.mouse.up()
    await expect.poll(()=>page.locator('.side-bar').evaluate(e=>e.getBoundingClientRect().width)).toBe(300)
    await page.getByRole('tab',{name:'文件',exact:true}).click()
    await expect(page.locator('.sb-row').filter({hasText:'删除后读取失败'})).toBeVisible()
    rmSync(missing,{recursive:true})
    await page.locator('.sb-row').filter({hasText:'删除后读取失败'}).click()
    await expect(page.locator('.tree-message')).toContainText('无法读取目录')
    await page.locator('.sidebar-toggle').click()
    await expect(page.locator('.left-panel-header')).toHaveCount(0)
    await expect(page.locator('.right-panel-header')).toBeVisible()
    await page.locator('.sidebar-toggle').click()
    await page.locator('.panel-collapse').click()
    await expect(page.locator('.left-panel-header')).toBeVisible()
    await page.locator('.panel-toggle').click()
    await page.evaluate(()=>window.electron.ipcRenderer.send('mt::set-user-preference',{theme:'dark',showStatusBar:false}))
    await expect(page.locator('html')).toHaveAttribute('data-theme','dark')
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(760,700))
    await page.screenshot({path:resolve(__dirname,'../../../../../evidence/unified-dark-narrow.png')})
    const fits=await page.evaluate(()=>[...document.querySelectorAll('.left-panel-header button,.right-panel-header button')].every(e=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.width>=24}))
    expect(fits).toBe(true)
    await closeTestApp(app)
    app=await launch();page=await app.firstWindow();await page.waitForSelector('.mu-container')
    await expect.poll(()=>page.locator('.side-bar').evaluate(e=>e.getBoundingClientRect().width)).toBe(300)
    await expect(page.locator('.workspace-status')).toHaveCount(0)
  } finally { if(app) await closeTestApp(app);rmSync(dir,{recursive:true,force:true}) }
})
