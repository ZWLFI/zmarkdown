// @vitest-environment happy-dom

import type { Muya } from '../../../muya';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya as MuyaClass } from '../../../muya';
import { InlineFormatToolbar } from '../index';

// GitHub issue #1（Sunjian0617，1.5.5 实测）：在**代码块里选中文字**（双击选词 /
// 拖选）会让渲染进程抛
//   TypeError: block.getFormatsInRange is not a function
// 链路：原生 selectionchange 通道 → 同块选区 → 取 `selection.anchor.block`
// 发 `muya-format-picker` → 工具条订阅里直接调 `block.getFormatsInRange()`。
// 代码块正文是 `CodeBlockContent extends Content`（不是 `Format`），没有这个方法
// ——同文件 `_handleKeydown` 早就有 `instanceof Format` 防护，这条通道漏了。
//
// 行为口径：非 Format 块（代码块正文、语言输入）内的选区**不弹格式工具条**
// （格式按钮对它们无意义；1.5.1 之前就是如此），且任何路径下订阅端都不再炸。

const RECT = { x: 10, y: 20, width: 120, height: 18, top: 20, left: 10, right: 130, bottom: 38 };

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
    if (typeof globalThis.ResizeObserver === 'undefined') {
        globalThis.ResizeObserver = class {
            observe() {}
            unobserve() {}
            disconnect() {}
        } as never;
    }
});

afterEach(() => {
    while (bootedHosts.length) bootedHosts.pop()!.remove();
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new MuyaClass(host, { markdown } as ConstructorParameters<typeof MuyaClass>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);

    return muya;
}

/** 非折叠的原生选区，`anchorNode` 落在编辑器内（selectionchange 通道的前置条件）。 */
function stubNativeSelection(muya: Muya): void {
    const range = {
        cloneRange: () => range,
        getClientRects: () => [RECT],
        getBoundingClientRect: () => RECT,
        toString: () => 'const a = 1',
    };
    vi.spyOn(document, 'getSelection').mockReturnValue({
        rangeCount: 1,
        isCollapsed: false,
        anchorNode: muya.domNode,
        getRangeAt: () => range,
        removeAllRanges: () => {},
        toString: () => 'const a = 1',
    } as unknown as Selection);
}

/** 代码块里第一个 Content 叶子是语言输入；正文叶子要按 blockName 找。 */
function findContentByBlockName(node: unknown, name: string): unknown {
    const parent = node as {
        children?: { map?: (fn: (child: unknown) => unknown) => unknown[] };
        blockName?: string;
    };
    const kids = parent.children?.map?.(child => child) ?? [];
    if (!kids.length)
        return parent.blockName === name ? node : null;
    for (const kid of kids) {
        const hit = findContentByBlockName(kid, name);
        if (hit)
            return hit;
    }

    return null;
}

/** 引擎侧实时选区：同块、非折叠，锚点块由调用方指定。 */
function stubEngineSelection(muya: Muya, block: unknown): void {
    Object.defineProperty(muya.editor.selection, 'getSelection', {
        value: () => ({
            anchor: { offset: 0, block, path: (block as { path: unknown }).path },
            focus: { offset: 5, block, path: (block as { path: unknown }).path },
            isCollapsed: false,
            isSelectionInSameBlock: true,
        }),
        configurable: true,
    });
}

const flushRaf = () => new Promise(resolve => setTimeout(resolve, 50));

describe('inlineFormatToolbar · selection inside a code block (issue #1)', () => {
    it('does not emit muya-format-picker for a same-block selection in code-block content', async () => {
        const muya = bootMuya('```js\nconst a = 1\n```\n');
        const leaf = findContentByBlockName(muya.editor.scrollPage, 'codeblock.content') as {
            blockName: string;
            path: unknown;
            getFormatsInRange?: unknown;
        };
        expect(leaf).toBeTruthy();
        expect(leaf.blockName).toBe('codeblock.content');
        expect(typeof leaf.getFormatsInRange).toBe('undefined');

        const toolbar = new InlineFormatToolbar(muya);
        const emitSpy = vi.spyOn(muya.eventCenter, 'emit');
        stubNativeSelection(muya);
        stubEngineSelection(muya, leaf);

        document.dispatchEvent(new Event('selectionchange'));
        await flushRaf();

        const pickerEmits = emitSpy.mock.calls.filter(([name]) => name === 'muya-format-picker');
        expect(pickerEmits).toHaveLength(0);
        expect(toolbar.status).toBe(false);
    });

    it('keeps the muya-format-picker subscriber safe for any non-Format block', () => {
        const muya = bootMuya('```js\nconst a = 1\n```\n');
        const leaf = findContentByBlockName(muya.editor.scrollPage, 'codeblock.content');
        const toolbar = new InlineFormatToolbar(muya);

        expect(() =>
            muya.eventCenter.emit('muya-format-picker', {
                reference: {
                    getBoundingClientRect: () => RECT,
                    clientWidth: RECT.width,
                    clientHeight: RECT.height,
                },
                block: leaf,
            }),
        ).not.toThrow();
        expect(toolbar.status).toBe(false);
    });
});
