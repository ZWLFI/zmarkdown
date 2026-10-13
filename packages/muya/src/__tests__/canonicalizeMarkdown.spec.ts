// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../muya';

// 2026-10-13：桌面侧判定「外部改动是不是纯格式差异」要用引擎自己的规范化
// （store 通过 `SET_MARKDOWN_CANONICALIZER` 注册本方法）。语义要点：
//  - 结果 = 引擎对任意文本的 parse→serialize（与 getMarkdown 同一管线/参数）；
//  - 不触碰当前文档（不能为了比较把正在编辑的内容洗一遍）；
//  - 幂等：规范形态再过一遍仍是自己（否则比较会永远判「有变化」）。

const bootedHosts: HTMLElement[] = [];
let originalVersion: string | undefined;
let hadVersion = false;

beforeEach(() => {
    hadVersion = 'MUYA_VERSION' in window;
    originalVersion = window.MUYA_VERSION;
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length) {
        const host = bootedHosts.pop()!;
        host.remove();
    }
    if (hadVersion)
        window.MUYA_VERSION = originalVersion as string;
    else
        delete (window as Partial<Window>).MUYA_VERSION;
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

describe('muya.canonicalizeMarkdown()', () => {
    it('normalizes compact table padding to the engine form', () => {
        const muya = bootMuya('hello\n');
        expect(muya.canonicalizeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n')).toBe(
            '| a   | b   |\n| --- | --- |\n| 1   | 2   |\n'
        );
    });

    it('does not touch the live document', () => {
        const muya = bootMuya('live content stays\n');
        muya.canonicalizeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
        expect(muya.getMarkdown()).toBe('live content stays\n');
    });

    it('is idempotent over its own output', () => {
        const muya = bootMuya('');
        const once = muya.canonicalizeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
        expect(muya.canonicalizeMarkdown(once)).toBe(once);
    });

    it('keeps real content differences', () => {
        const muya = bootMuya('');
        const before = muya.canonicalizeMarkdown('| a | b |\n| --- | --- |\n| 1 | 2 |\n');
        const after = muya.canonicalizeMarkdown('| a | b |\n| --- | --- |\n| 1 | 3 |\n');
        expect(after).not.toBe(before);
    });
});
