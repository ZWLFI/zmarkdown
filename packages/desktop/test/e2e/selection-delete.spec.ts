import { expect, test, type Page } from '@playwright/test'
import type { Editor as CodeMirrorEditor } from 'codemirror'
import {
  closeTestApp,
  enterSourceMode,
  expectNoRendererErrors,
  launchWithMarkdown,
  sendIpcToRenderer
} from './helpers'

const fixture =
  '前文保留\n\n左边 hello 中文 right 尾部\n\n| 表头 | 邻格 |\n| --- | --- |\n| 左边 hello 中文 right 尾部 | 邻格保留 |\n| 下一行保留 | next |\n\n后文保留\n'

async function selectText(page: Page, selector: string, text: string, mouse: boolean, reverse = false) {
  await page.bringToFront()
  await page.locator(selector).click()
  await page.waitForTimeout(250)
  const points = await page.locator(selector).evaluate((el, selected) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
    let node: Node | null
    while ((node = walker.nextNode())) {
      const offset = (node.textContent ?? '').indexOf(selected)
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + selected.length)
      const start = range.cloneRange()
      start.collapse(true)
      const end = range.cloneRange()
      end.collapse(false)
      const a = start.getBoundingClientRect()
      const b = end.getBoundingClientRect()
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
      return { x1: a.x, y1: a.y + a.height / 2, x2: b.x, y2: b.y + b.height / 2 }
    }
    throw new Error(`Text not found: ${selected}`)
  }, text)
  if (mouse) {
    await page.evaluate(() => window.getSelection()?.removeAllRanges())
    await page.mouse.move(reverse ? points.x2 : points.x1, reverse ? points.y2 : points.y1)
    await page.mouse.down()
    await page.mouse.move(reverse ? points.x1 : points.x2, reverse ? points.y1 : points.y2, { steps: 12 })
    await page.mouse.up()
  }
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text)
}

for (const key of ['Backspace', 'Delete', 'x']) {
  test(`whole cell text + ${key} preserves the table and undo`, async() => {
    const { app, page } = await launchWithMarkdown(fixture, { suppressErrorDialog: true })
    const selector = '.editor-component .mu-table-cell-content >> nth=2'
    try {
      await selectText(page, selector, '左边 hello 中文 right 尾部', true)
      await page.keyboard.press(key)
      await expect.poll(() => textOf(page, selector)).toBe(key === 'x' ? 'x' : '')
      await expect(page.locator('.editor-component .mu-table-cell')).toHaveCount(6)
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
      await expect.poll(() => textOf(page, selector)).toBe('左边 hello 中文 right 尾部')
      await expectNoRendererErrors(app)
    } finally {
      await closeTestApp(app)
    }
  })

  test(`source table selection + ${key} preserves unselected source`, async() => {
    const { app, page } = await launchWithMarkdown(fixture, { suppressErrorDialog: true })
    try {
      await enterSourceMode(page, app)
      const before = await page.evaluate(() => {
        const cm = (document.querySelector('.source-code .CodeMirror') as Element & { CodeMirror: CodeMirrorEditor }).CodeMirror
        const text = cm.getValue() as string
        const start = text.indexOf('hello 中文', text.indexOf('| ---'))
        cm.focus()
        cm.setSelection(cm.posFromIndex(start), cm.posFromIndex(start + 'hello 中文'.length))
        return { text, start }
      })
      await page.keyboard.press(key)
      await expect
        .poll(() =>
          page.evaluate(() =>
            (document.querySelector('.source-code .CodeMirror') as Element & { CodeMirror: CodeMirrorEditor }).CodeMirror.getValue()
          )
        )
        .toBe(
          before.text.slice(0, before.start) +
            (key === 'x' ? 'x' : '') +
            before.text.slice(before.start + 'hello 中文'.length)
        )
      await expectNoRendererErrors(app)
    } finally {
      await closeTestApp(app)
    }
  })
}

for (const key of ['Backspace', 'Delete', 'x']) {
  test(`text selection after a cell rectangle + ${key} preserves the table`, async() => {
    const { app, page } = await launchWithMarkdown(fixture, { suppressErrorDialog: true })
    const selector = '.editor-component .mu-table-cell-content >> nth=2'
    try {
      await page.locator(selector).click()
      await sendIpcToRenderer(app, 'mt::editor-edit-action', 'selectAll')
      await expect(page.locator('.mu-table-cell-selected')).toHaveCount(1)
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('Shift+ArrowLeft')
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('前')
      await page.keyboard.press(key)
      await expect(page.locator('.editor-component .mu-paragraph-content').first()).toHaveText(
        `${key === 'x' ? 'x' : ''}文保留`
      )
      await expect.poll(() => textOf(page, selector)).toBe('左边 hello 中文 right 尾部')
      await expect(page.locator('.editor-component .mu-table-cell')).toHaveCount(6)
      await expectNoRendererErrors(app)
    } finally {
      await closeTestApp(app)
    }
  })
}

const textOf = (page: Page, selector: string) =>
  page
    .locator(selector)
    .textContent()
    .then((text) => (text ?? '').replace(/[*\u200b]/g, '').replace(/\u00a0/g, ' '))

for (const formatted of [false, true]) {
  for (const target of ['paragraph', 'cell'] as const) {
    for (const key of ['Backspace', 'Delete', 'x']) {
      test(`${formatted ? 'bold DOM' : 'plain mouse'} ${target}: selected text + ${key} preserves surrounding content`, async() => {
        const { app, page } = await launchWithMarkdown(
          formatted ? fixture.replaceAll('hello 中文', '**hello 中文**') : fixture,
          { suppressErrorDialog: true }
        )
        try {
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
          await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: false })
          const selector =
            target === 'cell'
              ? '.editor-component .mu-table-cell-content >> nth=2'
              : '.editor-component .mu-paragraph-content >> nth=1'
          await selectText(page, selector, 'hello 中文', !formatted)
          await page.keyboard.press(key)
          const expected = `左边 ${key === 'x' ? 'x' : ''} right 尾部`
          await expect.poll(() => textOf(page, selector)).toBe(expected)
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await expect.poll(() => textOf(page, selector)).toBe('左边 hello 中文 right 尾部')
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'redo')
          await expect.poll(() => textOf(page, selector)).toBe(expected)
          await expect(page.locator('.editor-component .mu-table-cell')).toHaveCount(6)
          await expect(page.locator('.editor-component')).toContainText('邻格保留')
          await expect(page.locator('.editor-component')).toContainText('下一行保留')
          await expect(page.locator('.editor-component')).toContainText('后文保留')
          await expectNoRendererErrors(app)
        } finally {
          await closeTestApp(app)
        }
      })
    }
  }
}

test('cross-cell drag clears selected cells without removing the row', async() => {
  const { app, page } = await launchWithMarkdown(fixture, { suppressErrorDialog: true })
  try {
    const cells = page.locator('.editor-component .mu-table-cell-content')
    await cells.nth(2).click()
    const a = await cells.nth(2).boundingBox()
    const b = await cells.nth(3).boundingBox()
    if (!a || !b) throw new Error('Missing cell bounds')
    await page.mouse.move(a.x + 5, a.y + a.height / 2)
    await page.mouse.down()
    await page.mouse.move(b.x + 5, b.y + b.height / 2, { steps: 12 })
    await page.mouse.up()
    await expect(page.locator('.mu-table-cell-selected')).toHaveCount(2)
    await page.keyboard.press('Backspace')
    await expect
      .poll(() => textOf(page, '.editor-component .mu-table-cell-content >> nth=2'))
      .toBe('')
    await expect
      .poll(() => textOf(page, '.editor-component .mu-table-cell-content >> nth=3'))
      .toBe('')
    await expect(cells).toHaveCount(6)
    await expect(cells.nth(4)).toHaveText('下一行保留')
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(cells.nth(2)).toHaveText('左边 hello 中文 right 尾部')
    await expect(cells.nth(3)).toHaveText('邻格保留')
    await expectNoRendererErrors(app)
  } finally {
    await closeTestApp(app)
  }
})

test('cross-paragraph text deletion keeps the unselected head and tail', async() => {
  const { app, page } = await launchWithMarkdown('before LEFT\n\nRIGHT after\n\nuntouched\n', {
    suppressErrorDialog: true
  })
  try {
    await page.locator('.editor-component .mu-paragraph-content').first().click()
    await page.evaluate(() => {
      const blocks = document.querySelectorAll('.editor-component .mu-paragraph-content')
      const range = document.createRange()
      const start = document.createTreeWalker(blocks[0], NodeFilter.SHOW_TEXT).nextNode()
      const end = document.createTreeWalker(blocks[1], NodeFilter.SHOW_TEXT).nextNode()
      if (!start || !end) throw new Error('Missing paragraph text nodes')
      range.setStart(start, 'before '.length)
      range.setEnd(end, 'RIGHT'.length)
      window.getSelection()?.removeAllRanges()
      window.getSelection()?.addRange(range)
    })
    await page.keyboard.press('Backspace')
    await expect(page.locator('.editor-component .mu-paragraph-content').first()).toHaveText(
      'before  after'
    )
    await expect(page.locator('.editor-component .mu-paragraph-content').last()).toHaveText(
      'untouched'
    )
    await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
    await expect(page.locator('.editor-component .mu-paragraph-content').first()).toHaveText(
      'before LEFT'
    )
    await expectNoRendererErrors(app)
  } finally {
    await closeTestApp(app)
  }
})

for (const target of ['paragraph', 'cell'] as const) {
  for (const formatted of [false, true]) {
    for (const key of ['Backspace', 'Delete']) {
      test(`reverse mouse drag ${formatted ? 'bold' : 'plain'} ${target} + ${key}`, async() => {
        const { app, page } = await launchWithMarkdown(formatted ? fixture.replaceAll('hello 中文', '**hello 中文**') : fixture, { suppressErrorDialog: true })
        try {
          await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].focus())
          await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true, autoSaveDelay: 5000, editorLineWidth: '100%', fontSize: 16, lineHeight: 1.6, theme: 'claude-light' })
          const selector = target === 'cell' ? '.editor-component .mu-table-cell-content >> nth=2' : '.editor-component .mu-paragraph-content >> nth=1'
          await selectText(page, selector, 'llo 中', true, true)
          await page.keyboard.press(key)
          await expect.poll(() => textOf(page, selector)).toBe('左边 he文 right 尾部')
          await expect(page.locator('.editor-component .mu-table-cell')).toHaveCount(6)
          await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
          await expect.poll(() => textOf(page, selector)).toBe('左边 hello 中文 right 尾部')
          await expectNoRendererErrors(app)
        } finally { await closeTestApp(app) }
      })
    }
  }
}

for (const steps of [1, 12]) {
  test(`mouse drag returning from another paragraph keeps final text selection (${steps} moves)`, async() => {
    const { app, page } = await launchWithMarkdown('before HELLO after\n\nsecond paragraph untouched\n\nlast untouched\n', { suppressErrorDialog: true })
    try {
      const blocks = page.locator('.editor-component .mu-paragraph-content')
      await blocks.first().click()
      await page.waitForTimeout(250)
      const points = await page.evaluate(() => {
        const blocks = document.querySelectorAll('.editor-component .mu-paragraph-content')
        const caret = (el: Element, offset: number) => {
          const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()
          if (!text) throw new Error('Missing text')
          const r = document.createRange(); r.setStart(text, offset); r.collapse(true)
          const box = r.getBoundingClientRect(); return { x: box.x, y: box.y + box.height / 2 }
        }
        return { start: caret(blocks[0], 7), end: caret(blocks[0], 12), overshoot: caret(blocks[1], 8) }
      })
      await page.mouse.move(points.start.x, points.start.y)
      await page.mouse.down()
      await page.mouse.move(points.overshoot.x, points.overshoot.y, { steps: 12 })
      await page.mouse.move(points.end.x, points.end.y, { steps })
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('HELLO')
      await page.mouse.up()
      await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('HELLO')
      await page.keyboard.press('Backspace')
      await expect(blocks.first()).toHaveText('before  after')
      await expect(blocks.nth(1)).toHaveText('second paragraph untouched')
      await expectNoRendererErrors(app)
    } finally { await closeTestApp(app) }
  })
}
