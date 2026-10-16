// @vitest-environment happy-dom

import type Content from '../../block/base/content';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../muya';

// Moving the active match (find next / previous) only changes the highlights
// of two blocks — the one holding the previous active match and the one
// holding the new one — so only they may re-render. Re-rendering every matched
// block twice per Enter cost ~3s on a 5MB document with ~9.5k matches
// (2026-10-15). A new search likewise must not paint a still-matching block
// twice (clear pass + highlight pass). These specs count `update()` calls and
// check the resulting highlight DOM is what a full repaint would produce.

const bootedHosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (bootedHosts.length)
        bootedHosts.pop()!.remove();
    vi.restoreAllMocks();
});

function bootMuya(markdown: string): Muya {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    bootedHosts.push(muya.domNode);
    return muya;
}

// Ten paragraphs, each with two `x` matches.
const DOC = `${Array.from({ length: 10 }, (_, i) => `p${i} x and x`).join('\n\n')}\n`;

function matchedBlocks(muya: Muya): Content[] {
    return [...new Set(muya.editor.searchModule.matches.map(m => m.block))];
}

function countUpdates(blocks: Content[]) {
    const calls = new Map<Content, number>();
    for (const block of blocks) {
        const original = block.update.bind(block);
        vi.spyOn(block, 'update').mockImplementation((...args: Parameters<Content['update']>) => {
            calls.set(block, (calls.get(block) ?? 0) + 1);
            return original(...args);
        });
    }

    return calls;
}

// Which block holds `span.mu-highlight`, and how many search spans each block has.
function highlightDom(muya: Muya) {
    const active = muya.domNode.querySelectorAll('span.mu-highlight');
    return {
        activeCount: active.length,
        activeText: active[0]?.closest('p')?.textContent ?? null,
        selectionCount: muya.domNode.querySelectorAll('span.mu-selection').length,
    };
}

describe('search.find() re-renders only the blocks whose highlights change', () => {
    it('moving within one block repaints just that block', () => {
        const muya = bootMuya(DOC);
        const search = muya.editor.searchModule;
        search.search('x');
        const calls = countUpdates(matchedBlocks(muya));

        search.find('next'); // 0 -> 1, both in p0
        expect([...calls.values()].reduce((a, b) => a + b, 0)).toBe(1);
        expect(highlightDom(muya)).toEqual({ activeCount: 1, activeText: 'p0 x and x', selectionCount: 19 });
    });

    it('moving to the next block repaints exactly the old and the new block', () => {
        const muya = bootMuya(DOC);
        const search = muya.editor.searchModule;
        search.search('x');
        search.find('next');
        const blocks = matchedBlocks(muya);
        const calls = countUpdates(blocks);

        search.find('next'); // 1 (p0) -> 2 (p1)
        expect([...calls.keys()].sort()).toEqual([blocks[0], blocks[1]].sort());
        expect(calls.get(blocks[0])).toBe(1);
        expect(calls.get(blocks[1])).toBe(1);
        expect(highlightDom(muya)).toEqual({ activeCount: 1, activeText: 'p1 x and x', selectionCount: 19 });

        search.find('previous'); // 2 (p1) -> 1 (p0)
        expect(highlightDom(muya)).toEqual({ activeCount: 1, activeText: 'p0 x and x', selectionCount: 19 });
        search.find('previous'); // 1 -> 0, still p0
        search.find('previous'); // 0 wraps to 19 (p9)
        expect(highlightDom(muya)).toEqual({ activeCount: 1, activeText: 'p9 x and x', selectionCount: 19 });
    });

    it('a matched block whose highlights were wiped is repainted again', () => {
        const muya = bootMuya(DOC);
        const search = muya.editor.searchModule;
        search.search('x');
        const blocks = matchedBlocks(muya);
        // Simulate an edit-time render, which paints without search highlights.
        blocks[5].update(undefined, []);
        expect(blocks[5].domNode!.querySelector('span.mu-selection')).toBeNull();

        search.find('next');
        expect(blocks[5].domNode!.querySelectorAll('span.mu-selection').length).toBe(2);
        expect(highlightDom(muya).selectionCount).toBe(19);
    });
});

describe('search.search() paints a still-matching block once', () => {
    it('a refined query does not clear-then-repaint blocks that match again', () => {
        const muya = bootMuya(DOC);
        const search = muya.editor.searchModule;
        search.search('x');
        const calls = countUpdates(matchedBlocks(muya));

        search.search('x and');
        expect([...calls.values()].every(n => n === 1)).toBe(true);
        expect(calls.size).toBe(10);
        expect(highlightDom(muya)).toEqual({ activeCount: 1, activeText: 'p0 x and x', selectionCount: 9 });
    });

    it('blocks that stop matching are cleared', () => {
        const muya = bootMuya(DOC);
        const search = muya.editor.searchModule;
        search.search('x');
        search.search('p3');
        expect(highlightDom(muya)).toEqual({ activeCount: 1, activeText: 'p3 x and x', selectionCount: 0 });
        search.search('');
        expect(highlightDom(muya)).toEqual({ activeCount: 0, activeText: null, selectionCount: 0 });
    });
});
