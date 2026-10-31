import { test, expect } from '@playwright/test'
import type { ElectronApplication, Page } from 'playwright'
import { readFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { launchWithMarkdown, sendIpcToRenderer, setSourceMarkdown, getMarkdownContent, expectNoRendererErrors } from './helpers'

// One isolated preview/profile, only temporary documents. No installed app or user preferences.
let app: ElectronApplication
let page: Page
let filePath: string
const markdown = '# 独立验收\n\n中文搜索与保存\n\n| 标题甲 | 标题乙 |\n| --- | --- |\n| 中文甲 | 内容乙 |\n| 保留甲 | 保留乙 |\n'
test.setTimeout(60000)
test.beforeAll(async () => {
  const launch = await launchWithMarkdown(markdown, { suppressErrorDialog: true })
  app = launch.app; page = launch.page; filePath = launch.filePath
  writeFileSync(join(dirname(filePath), 'other.md'), '中文搜索结果\n')
})
test.afterAll(async () => {
  if (!app) return
  try { await expectNoRendererErrors(app) } finally {
    // Only the child process launched with this suite's disposable profile.
    // Native quit/inspector shutdown can remain pending after all assertions.
    const child = app.process()
    if (!child.spawnargs.some(arg => arg.includes('marktext-e2etest-'))) throw new Error('Refusing to terminate a non-test profile')
    await new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode !== null) { resolve(); return }
      const hardStop = setTimeout(() => child.kill('SIGKILL'), 3000)
      const deadline = setTimeout(() => reject(new Error('Isolated test process did not exit')), 8000)
      child.once('exit', () => { clearTimeout(hardStop); clearTimeout(deadline); resolve() })
      child.kill('SIGTERM')
    })
  }
})

test('rename failure retains draft, retry succeeds without saving dirty edits', async () => {
  await setSourceMarkdown(page, app, markdown + '\n尚未保存\n')
  await sendIpcToRenderer(app, 'mt::editor-rename-file')
  const input = page.locator('.rename-name')
  await expect(input).toBeVisible()
  await input.fill('bad/name.md'); await input.press('Enter')
  await expect(input).toHaveValue('bad/name.md')
  await expect(input).toHaveAttribute('aria-invalid', 'true')
  await expect(page.locator('.rename-feedback')).not.toHaveText('')
  await input.fill('重命名验收.md'); await input.press('Enter')
  await expect(input).toBeHidden()
  const target = join(dirname(filePath), '重命名验收.md')
  expect(existsSync(filePath)).toBe(false)
  expect(readFileSync(target, 'utf8')).toBe(markdown)
  filePath = target
  await expect(page.locator('.editor-tabs .tab.active')).toHaveAttribute('title', target)
  await expect(page.locator('.save-state')).toHaveClass(/dirty/)
})

test('save failure feedback and retry write the current document', async () => {
  // Inject only the failed receipt; successful retry uses the real main-process filesystem writer.
  const id = await page.locator('.editor-tabs .tab.active').getAttribute('data-id')
  await sendIpcToRenderer(app, 'mt::tab-save-failure', id, '验收：暂时无法写入')
  await expect(page.locator('.save-retry')).toBeVisible()
  await expect(page.locator('.save-state')).toHaveAttribute('title', /验收：暂时无法写入/)
  await page.locator('.save-retry').click()
  await expect(page.locator('.save-retry')).toBeHidden()
  await expect(page.getByText('保存时发生错误：验收：暂时无法写入', { exact: true })).toBeHidden()
  await expect(page.locator('.save-state')).not.toHaveClass(/dirty/)
  await expect(page.locator('.save-state')).toHaveAttribute('title', new RegExp(filePath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  expect(readFileSync(filePath, 'utf8')).toContain('尚未保存')
})

test('restored folder search uses real backend, reports errors and recovers', async () => {
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'findInFolder')
  const input = page.locator('.side-bar-search .search-input')
  await expect(input).toBeVisible()
  await expect(page.getByRole('tab', { name: /^(搜索|Search)$/ })).toBeVisible()
  await input.fill('中文搜索')
  await expect(page.locator('.search-result-item')).toHaveCount(2)
  await page.locator('.side-bar-search .is-regex').click()
  await input.fill('[')
  await expect(page.locator('.side-bar-search [role=alert]')).toBeVisible()
  await input.fill('没有这个词_xyz')
  await expect(page.locator('.search-result-item')).toHaveCount(0)
  await expect(page.locator('.side-bar-search [role=alert]')).toHaveCount(0)
  await expect(page.locator('.search-message-section')).toContainText(/No results|没有|未找到/)
  await input.fill('中文搜索')
  await expect(page.locator('.search-result-item')).toHaveCount(2)
  await page.screenshot({ path: process.env.UX_EVIDENCE + '/search.png' })
})

test('table menu shows whole-row scope; keyboard activation and undo preserve neighbours', async () => {
  await setSourceMarkdown(page, app, markdown)
  const rows = page.locator('.editor-component table tr')
  await expect(rows).toHaveCount(3)
  const cell = rows.nth(1).locator('td').last()
  const box = await cell.boundingBox()
  if (!box) throw new Error('Missing table cell geometry')
  await page.mouse.move(box.x + box.width + 6, box.y + box.height / 2)
  const bar = page.locator('.mu-table-drag-bar[data-drag="right"]')
  await expect(bar).toBeVisible()
  await bar.click()
  const remove = page.locator('.mu-table-bar-tools li.item[data-label="remove"]')
  await expect(remove).toBeVisible()
  await expect(remove).toHaveText(/2/)
  expect(await remove.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
  expect(await remove.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= window.innerWidth })).toBe(true)
  await expect(page.locator('.mu-table-bar-tools .scope-hint')).toContainText(/文字选区|Text selection/)
  await page.screenshot({ path: process.env.UX_EVIDENCE + '/table-scope.png' })
  await remove.focus(); await remove.press('Enter')
  await expect(rows).toHaveCount(2)
  await expect(rows.last()).toContainText('保留甲')
  await page.locator('.editor-component').click()
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
  await expect(rows).toHaveCount(3)
  expect(await getMarkdownContent(page, app)).toContain('中文甲')
})
