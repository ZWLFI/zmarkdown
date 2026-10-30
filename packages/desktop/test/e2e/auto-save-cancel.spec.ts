import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { closeTestApp, launchWithMarkdown, sendIpcToRenderer, setSourceMarkdown } from './helpers'

test('disabling auto save cancels a pending write; a later edit can resume saving', async() => {
  const { app, page, filePath } = await launchWithMarkdown('baseline\n')
  try {
    await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true, autoSaveDelay: 3000 })
    await setSourceMarkdown(page, app, 'pending edit\n')
    await expect(page.locator('.editor-tabs .tab.active')).toHaveClass(/dirty/)
    await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: false })
    // A negative assertion must outlive the cancelled timer's deadline.
    await page.waitForTimeout(3500)
    expect(readFileSync(filePath, 'utf8')).toBe('baseline\n')
    await expect(page.locator('.editor-tabs .tab.active')).toHaveClass(/dirty/)

    await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true, autoSaveDelay: 300 })
    await setSourceMarkdown(page, app, 'resumed edit\n')
    await expect.poll(() => readFileSync(filePath, 'utf8')).toBe('resumed edit\n')
    await expect(page.locator('.editor-tabs .tab.active')).not.toHaveClass(/dirty/)
  } finally {
    await closeTestApp(app)
  }
})
