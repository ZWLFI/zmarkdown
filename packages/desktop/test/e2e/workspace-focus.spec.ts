import type { ElectronApplication } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'

import { sendIpcToRenderer } from './helpers'
import { closeTestApp } from './helpers'
import { expect, test } from '@playwright/test'
import { launchWithMarkdown, clickMenuById, focusEditor } from './helpers'

// Native Electron accelerators are handled before renderer/CDP keyboard events.
const nativeKey = async(app: ElectronApplication, keyCode: string, modifier: string): Promise<void> => {
  await app.evaluate(({ BrowserWindow }, { keyCode, modifier }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers: [modifier as 'control' | 'meta'] })
    win.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers: [modifier as 'control' | 'meta'] })
  }, { keyCode, modifier })
}

test('fullscreen reading preserves the editor, layout and selection; Command+B remains bold', async() => {
  const { app, page } = await launchWithMarkdown(
    '# Focus\n\nWrite here.\n' + '\nParagraph.\n'.repeat(100)
  )
  try {
    const menu = await app.evaluate(({ Menu }) => {
      const item = Menu.getApplicationMenu()?.getMenuItemById('focusModeMenuItem')
      return item?.accelerator
    })
    if (process.platform === 'darwin') expect(menu).toBe('Ctrl+B')
    if (
      !(await page
        .locator('.tb-toggle')
        .first()
        .evaluate((el) => el.classList.contains('on')))
    ) { await page.locator('.tb-toggle').first().click() }
    await page.waitForTimeout(500)
    const prose = page.locator('.editor-main-col .mu-container')
    const comfortableWidth = await prose.evaluate(el => el.getBoundingClientRect().width)
    await page.locator('.status-actions button').first().click()
    await expect.poll(() => prose.evaluate(el => el.getBoundingClientRect().width)).toBeGreaterThan(comfortableWidth)
    await page.locator('.status-actions button').first().click()
    await expect.poll(() => prose.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(comfortableWidth, 0)
    await focusEditor(page)
    await page.evaluate(() => {
      const paragraph = document.querySelectorAll('.mu-paragraph-content')[80]
      const range = document.createRange()
      range.selectNodeContents(paragraph)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      paragraph.scrollIntoView({ block: 'center' })
      document.dispatchEvent(new Event('selectionchange'))
    })
    const selectionBefore = await page.evaluate(() => window.getSelection()?.toString())
    expect(selectionBefore).toBeTruthy()
    const before = await page.evaluate(() => {
      const editor = document.querySelector('.editor-component') as HTMLElement
      ;(window as unknown as { __focusEditor: HTMLElement }).__focusEditor = editor
      return {
        sidebar: document.querySelector('.side-bar')?.getBoundingClientRect().width,
        tabs: document.querySelectorAll('.tab').length,
        scrollTop: editor.scrollTop
      }
    })
    if (process.platform === 'darwin') await nativeKey(app, 'B', 'control')
    else await clickMenuById(app, 'focusModeMenuItem')
    await expect(page.locator('.editor-container')).toHaveClass(/distraction-free/)
    await expect(page.locator('.editor-chrome')).toBeHidden()
    await expect(page.locator('.workspace-status')).toBeHidden()
    await expect(page.locator('.focus-exit')).toHaveText(/退出全屏阅读|Exit fullscreen reading/)
    await expect(page.locator('.mu-focus-mode, .editor-wrapper.focus')).toHaveCount(0)
    expect(await prose.evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(comfortableWidth, 0)
    expect(await prose.evaluate(el => Array.from(el.children).every(block => getComputedStyle(block).opacity === '1'))).toBe(true)
    expect(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())).toBe(false)
    await page.locator('.focus-exit').click()
    await page.waitForTimeout(500)
    await expect(page.locator('.editor-container')).not.toHaveClass(/distraction-free/)
    expect(
      await page.evaluate(
        () => document.querySelector('.editor-component') === (window as unknown as { __focusEditor: HTMLElement }).__focusEditor
      )
    ).toBe(true)
    expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(selectionBefore)
    expect(await page.locator('.editor-component').evaluate(el => el.scrollTop)).toBe(before.scrollTop)
    expect(await page.locator('.tab').count()).toBe(before.tabs)
    expect(
      await page.locator('.side-bar').evaluate((el) => el.getBoundingClientRect().width)
    ).toBeCloseTo(before.sidebar ?? 0, 0)
    await expect(page.locator('.workspace-status')).toBeVisible()
    const bold = await app.evaluate(
      ({ Menu }) => Menu.getApplicationMenu()?.getMenuItemById('strongMenuItem')?.accelerator
    )
    if (process.platform === 'darwin') {
      expect(bold).toBe('Command+B')
      await focusEditor(page)
      await nativeKey(app, 'B', 'meta')
      await expect(page.locator('.mu-container strong').first()).toBeVisible()
    }
  } finally {
    await closeTestApp(app)
  }
})

test('Chinese composition commits once and survives save, undo and redo', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# 中文\n\n原始段落。\n')
  try {
    await page.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Input.imeSetComposition', { text: '中文输入验证', selectionStart: 6, selectionEnd: 6 })
    await cdp.send('Input.insertText', { text: '中文输入验证' })
    await expect(page.locator('.tab.active')).toHaveClass(/dirty/)
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('中文输入验证')
    await expect(page.locator('.tab.active')).not.toHaveClass(/dirty/)
    expect(readFileSync(filePath, 'utf8').split('中文输入验证')).toHaveLength(2)
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).not.toContain('中文输入验证')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toContain('中文输入验证')
  } finally {
    await closeTestApp(app)
  }
})

test('fullscreen reading follows the right document and restores the split layout', async() => {
  const { app, page, filePath } = await launchWithMarkdown('# Left\n\nLeft document.\n')
  try {
    await page.locator('.status-actions button').first().click()
    const rightPath = join(dirname(filePath), 'right.md')
    writeFileSync(rightPath, '# Right\n\nRight document.\n')
    await page.evaluate((path) => window.electron.ipcRenderer.send('mt::open-file', path, {}), rightPath)
    await expect(page.locator('.tab')).toHaveCount(2)
    await page.locator('.tab').filter({ hasText: 'right.md' }).dragTo(page.locator('.split-drop-zone'), { force: true })
    const right = page.locator('.bpanel .editor-component')
    await expect(right).toBeVisible()
    await right.locator('.mu-paragraph-content').first().click()
    await page.keyboard.press('End')
    await page.waitForTimeout(500)
    const chosenWidth = await page.locator('.editor-main-col .mu-container').evaluate(el => getComputedStyle(el).maxWidth)
    const panelWidth = await page.locator('.bpanel').evaluate(el => el.getBoundingClientRect().width)
    const readingWidth = await right.locator('.mu-container').evaluate(el => el.getBoundingClientRect().width)
    await nativeKey(app, 'B', 'control')
    await expect(page.locator('.editor-container')).toHaveClass(/focus-right/)
    await expect(right).toBeVisible()
    expect(await right.locator('.mu-container').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(readingWidth, 0)
    expect(await right.locator('.mu-container').evaluate(el => Array.from(el.children).every(block => getComputedStyle(block).opacity === '1'))).toBe(true)
    await expect(page.locator('.mu-focus-mode')).toHaveCount(0)
    await expect(page.locator('.editor-main-col')).toBeHidden()
    await page.keyboard.type(' focused-right')
    await expect(right).toContainText('focused-right')
    await page.locator('.focus-exit').click()
    await expect(page.locator('.editor-main-col')).toBeVisible()
    await expect(right).toBeVisible()
    await page.waitForTimeout(500)
    expect(await page.locator('.bpanel').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(panelWidth, 0)
    expect(await right.locator('.mu-container').evaluate(el => el.getBoundingClientRect().width)).toBeCloseTo(readingWidth, 0)
    expect(await page.locator('.editor-main-col .mu-container').evaluate(el => getComputedStyle(el).maxWidth)).toBe(chosenWidth)
    await expect(page.locator('.editor-main-col')).not.toContainText('focused-right')
  } finally {
    await closeTestApp(app)
  }
})
