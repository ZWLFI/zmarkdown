import { expect, test } from '@playwright/test'
import {
  launchWithMarkdown,
  waitForMenuReady,
  getMarkdownContent,
  sendIpcToRenderer,
  enterSourceMode
} from './helpers'

// Trigger an editor undo through the same IPC channel the Edit › Undo menu item
// uses (`mt::editor-edit-action` → bus `undo` → editor.undo()).
const undo = async (app: Parameters<typeof sendIpcToRenderer>[0]): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::editor-edit-action', 'undo')
}

// Reproduce the watcher's external-change report: the same `mt::update-file`
// payload shape the main-process watcher sends (a `loadMarkdownFile` result in
// `change.data`). Drives the real renderer reload path
// LISTEN_FOR_FILE_CHANGE → loadChange → bus `file-changed` → handleFileChange.
const reportExternalChange = async (
  app: Parameters<typeof sendIpcToRenderer>[0],
  pathname: string,
  markdown: string
): Promise<void> => {
  await sendIpcToRenderer(app, 'mt::update-file', {
    type: 'change',
    change: {
      pathname,
      mtimeMs: 1,
      data: {
        markdown,
        filename: 'note.md',
        pathname,
        encoding: { encoding: 'utf8', hasBOM: false },
        lineEnding: 'lf',
        adjustLineEndingOnSave: false,
        trimTrailingNewline: 1,
        isMixedLineEndings: false
      }
    }
  })
}

test.describe('External disk reload — undo restores the pre-change document', () => {
  // Legacy muyajs kept a full-state snapshot of the pre-reload document so the
  // first Ctrl+Z after an external reload restored it. The @muyajs/core reload
  // path must record the same single invertible undo boundary (via
  // `Muya.replaceContent`) instead of `setContent` (which clears history).
  test('first undo after an external reload restores the old content', async () => {
    // 紧凑表格（`| a | b |`）刻意不是引擎规范形态：引擎会把它重排成带填充的
    // `| a   | b   |`。重载的保存基线若用磁盘原文（而非引擎序列化）注册，这次
    // replaceContent 的同步 json-change 就会被判成新内容、把标签误标为脏
    // （2026-10-13 用户上报的「刷新后又出现未保存小蓝点」）。用这个夹具让
    // 「重载后保持干净」的断言真正压住该路径。
    const { app, page, filePath } = await launchWithMarkdown(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\nold content here\n'
    )
    await waitForMenuReady(app)

    // Auto-reload only applies silently when autoSave is on AND the tab is
    // unmodified (a freshly-loaded tab is saved). Enable autoSave so the change
    // applies without the manual "Reload" confirmation prompt.
    await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true })
    await page.waitForTimeout(100)

    await reportExternalChange(
      app,
      filePath,
      '| a | b |\n| --- | --- |\n| 1 | 3 |\n\nnew content here\n'
    )
    await page.waitForTimeout(600)

    // The tab now reflects the new on-disk content...
    expect((await getMarkdownContent(page, app)).includes('new content here')).toBe(true)
    // ...and stays clean: the reloaded content matches the file on disk, so the
    // tab must NOT be flagged unsaved (replaceContent fires a json-change that
    // would otherwise mark it dirty against the stale baseline).
    expect(await page.evaluate(() => !!document.querySelector('.editor-tabs .tab.dirty'))).toBe(
      false
    )

    // The first undo reverts the external change in one step, back to the
    // document as it was before the reload.
    await undo(app)
    await page.waitForTimeout(600)
    expect((await getMarkdownContent(page, app)).includes('old content here')).toBe(true)
    // The undone document now diverges from on-disk content, so the tab is dirty.
    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.editor-tabs .tab.dirty')))
      .toBe(true)
    // 收尾：脏标签直接关窗会卡在「未保存更改」对话框上，先把内容保存掉。
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await page.waitForTimeout(400)
    await app.close()
  })
})

test.describe('External disk change — formatting-only rewrites stay silent', () => {
  // 2026-10-13 用户上报：agent 改写 PRD 后墨记提醒「已在磁盘上发生变更」，点重新
  // 加载画面却没有任何变化——磁盘上的紧凑表格与编辑器缓冲的引擎规范形态只差
  // 填充宽度。修复后：渲染语义一致 → 不提示、不置脏；真的改了内容 → 照旧提示。
  test('padding-only rewrite does not raise the banner; a content change still does', async () => {
    const { app, page, filePath } = await launchWithMarkdown(
      '| a | b |\n| --- | --- |\n| 1 | 2 |\n\n正文\n'
    )
    await waitForMenuReady(app)

    // autoSave 保持关闭（种子默认）：走手动确认通道，横幅才会出现。
    await reportExternalChange(
      app,
      filePath,
      '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n\n正文\n'
    )
    await page.waitForTimeout(700)

    const silentState = await page.evaluate(() => ({
      banner: document.querySelector('.editor-notifications')?.textContent ?? null,
      dirty: !!document.querySelector('.editor-tabs .tab.dirty')
    }))
    expect(silentState.banner).toBeNull()
    expect(silentState.dirty).toBe(false)

    // 控制组：真实内容变化必须照旧提示并置脏。
    await reportExternalChange(
      app,
      filePath,
      '| a   | b   |\n| --- | --- |\n| 1   | 3   |\n\n正文\n'
    )
    await page.waitForTimeout(700)

    await expect
      .poll(() => page.evaluate(() => !!document.querySelector('.editor-notifications')))
      .toBe(true)
    expect(await page.evaluate(() => !!document.querySelector('.editor-tabs .tab.dirty'))).toBe(
      true
    )

    // 收尾：保存掉脏内容，避免关闭时卡在「未保存更改」对话框。
    await sendIpcToRenderer(app, 'mt::editor-ask-file-save')
    await page.waitForTimeout(400)
    await app.close()
  })
})

test.describe('External disk reload — source-mode scroll position survives a same-tab reload', () => {
  // Item 258: a same-id `mt::update-file` reload must not yank the CodeMirror
  // view back to the top. sourceCode.vue handleFileChange snapshots every
  // plausible scroll element on `isSameTabReload`, runs `editor.setValue`, then
  // re-applies the captured scrollTop synchronously, on nextTick, and on the
  // next animation frame (because the muya editor.vue file-changed handler
  // relayouts in the same tick). With `muyaIndexCursor: null` on a freshly
  // loaded tab the restore branch — not setSelection — is the one that runs.
  test('258: same-id reload preserves the source-mode scrollTop', async () => {
    // A long body so the CodeMirror content overflows and is actually
    // scrollable. The exact scroll element depends on CodeMirror's height:auto
    // + the outer .source-code overflow:auto interplay, so we discover whichever
    // element holds the scroll rather than assuming.
    const longBody = 'line\n'.repeat(400)
    const { app, page, filePath } = await launchWithMarkdown(longBody)
    await waitForMenuReady(app)

    // Auto-reload only applies silently when autoSave is on AND the tab is
    // unmodified (a freshly-loaded tab is saved) — same gate as the undo test.
    await sendIpcToRenderer(app, 'mt::user-preference', { autoSave: true })
    await page.waitForTimeout(100)

    await enterSourceMode(page, app)

    // Scroll well down the document. Drive both CodeMirror's own API and the
    // outer .source-code container so the scroll lands on whichever element is
    // the real overflow owner.
    const captured = await page.evaluate(() => {
      const container = document.querySelector('.source-code') as HTMLElement | null
      const cmEl = document.querySelector('.source-code .CodeMirror') as
        | (Element & {
            CodeMirror?: {
              scrollTo(x: number, y: number): void
              getScrollerElement(): HTMLElement
            }
          })
        | null
      const cm = cmEl?.CodeMirror
      if (cm) cm.scrollTo(0, 4000)
      if (container) container.scrollTop = 4000
      const scroller = cm?.getScrollerElement?.() ?? null
      return {
        container: container ? container.scrollTop : 0,
        scroller: scroller ? scroller.scrollTop : 0
      }
    })

    // At least one of the candidate elements must have actually scrolled,
    // otherwise the assertion below would be vacuous.
    const maxCaptured = Math.max(captured.container, captured.scroller)
    expect(maxCaptured).toBeGreaterThan(0)

    // Fire a same-tab external reload with slightly different long content. The
    // body must still match what we hand `loadChange` so the tab stays clean and
    // the reload applies silently.
    const reloadedBody = longBody + 'tail line\n'
    await reportExternalChange(app, filePath, reloadedBody)
    await page.waitForTimeout(600)

    // The reload landed (content updated) and CodeMirror is still mounted.
    expect((await getMarkdownContent(page, app)).trim().endsWith('tail line')).toBe(true)
    await enterSourceMode(page, app)

    // The scroll position is restored — not reset to the top. The exact pixel
    // value can drift slightly because the new (longer) content changes layout
    // height, so use a generous tolerance but require it to stay well away from
    // 0. We compare against whichever element actually owned the scroll.
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const container = document.querySelector('.source-code') as HTMLElement | null
            const cmEl = document.querySelector('.source-code .CodeMirror') as
              | (Element & { CodeMirror?: { getScrollerElement(): HTMLElement } })
              | null
            const scroller = cmEl?.CodeMirror?.getScrollerElement?.() ?? null
            return Math.max(container ? container.scrollTop : 0, scroller ? scroller.scrollTop : 0)
          }),
        { timeout: 4000 }
      )
      .toBeGreaterThan(maxCaptured * 0.5)
    await app.close()
  })
})
