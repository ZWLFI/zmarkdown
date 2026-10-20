import { expect, test } from '@playwright/test'
import { launchWithMarkdown, closeTestApp } from './helpers'

test('wide blocks stay inside prose; keyboard copy reports success and preserves code', async() => {
  const code = 'const mixed = "中文 ABC 123 '.repeat(35) + '";'
  const table = '|' + Array(10).fill('Column 中文').join('|') + '|\n|' + Array(10).fill('---').join('|') + '|\n|' + Array(10).fill('Long cell 123').join('|') + '|'
  const { app, page } = await launchWithMarkdown('# 混排\n\n正文 English 123 `code`。\n\n```js\n' + code + '\n```\n\n' + table)
  try {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 800))
    const container = page.locator('.editor-main-col .mu-container')
    await expect.poll(() => container.evaluate(e => e.scrollWidth <= e.clientWidth + 2)).toBe(true)
    for (const selector of ['.mu-table', '.mu-code-block .mu-code']) {
      await expect.poll(() => container.locator(selector).evaluate(e => e.scrollWidth > e.clientWidth)).toBe(true)
    }
    const copy = container.locator('.mu-code-copy')
    await expect(copy).toHaveAttribute('aria-label', /.+/)
    await copy.focus()
    await copy.press('Enter')
    await expect(copy).toHaveAttribute('data-copied', 'true')
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(code)
    await expect(copy).not.toHaveAttribute('data-copied', 'true', { timeout: 3000 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(await copy.evaluate(e => parseFloat(getComputedStyle(e).transitionDuration))).toBeLessThan(0.001)
  } finally { await closeTestApp(app) }
})
