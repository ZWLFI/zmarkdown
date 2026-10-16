// @vitest-environment happy-dom

import type { Muya } from '../../muya';
import type { TState } from '../types';
import { describe, expect, it } from 'vitest';
import JSONState from '../index';
import { MarkdownToState } from '../markdownToState';

// `JSONState.getMarkdown()` serializes the LIVE state array instead of a
// `structuredClone` of it (the desktop calls it on every keystroke; the clone
// was 29ms of the 39ms on a 2MB document). That is only safe while the
// serializer never writes through its input — these specs pin it by
// serializing a deep-frozen document (any write throws in strict mode) that
// exercises every block type, including the list paths that rewrite the
// marker (`markerOverride`) and advance the ordered-list `start` counter.

const MARKDOWN = [
    '---',
    'title: front matter',
    '---',
    '',
    '# Heading',
    '',
    'Setext heading',
    '---',
    '',
    'A paragraph with **bold**, `code`, [link](https://example.com) and $x^2$.',
    '',
    '1. first',
    '2. second',
    '   - nested bullet',
    '   - another',
    '     1. deep ordered',
    '     2. deep ordered 2',
    '3. third',
    '',
    '7) start at seven',
    '8) eight',
    '',
    '- bullet one',
    '- bullet two',
    '',
    '* star list starts a new list',
    '',
    '- [ ] task',
    '- [x] done task',
    '',
    '> quote',
    '> - list in quote',
    '',
    '| a | b |',
    '| --- | :-: |',
    '| 1 | 2 |',
    '',
    '```js',
    'const x = 1',
    '```',
    '',
    '$$',
    'E = mc^2',
    '$$',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '<div class="html">',
    '<b>html block</b>',
    '</div>',
    '',
    '***',
    '',
    'Last paragraph.',
    '',
].join('\n');

function deepFreeze<T>(value: T): T {
    if (value && typeof value === 'object') {
        for (const key of Object.keys(value))
            deepFreeze((value as Record<string, unknown>)[key]);
        Object.freeze(value);
    }

    return value;
}

function makeState(markdown: string) {
    const blocks = new MarkdownToState({
        footnote: false,
        math: true,
        isGitlabCompatibilityEnabled: false,
        trimUnnecessaryCodeBlockEmptyLines: false,
        frontMatter: true,
    }).generate(markdown);
    const muya = {
        options: { listIndentation: 1 },
        eventCenter: { emit: () => {} },
    } as unknown as Muya;

    return new JSONState(muya, blocks);
}

describe('jsonState.getMarkdown() serializes the live state without cloning', () => {
    it('never writes through the document (deep-frozen state serializes fine)', () => {
        const state = makeState(MARKDOWN);
        const expected = state.getMarkdownFromState(state.getState());
        deepFreeze(state.getStateRef());

        expect(() => state.getMarkdown()).not.toThrow();
        expect(state.getMarkdown()).toBe(expected);
    });

    it('is repeatable: list counters and markers do not leak between calls', () => {
        const state = makeState(MARKDOWN);
        const snapshot: TState[] = JSON.parse(JSON.stringify(state.getStateRef()));

        const first = state.getMarkdown();
        const second = state.getMarkdown();

        expect(second).toBe(first);
        expect(first).toContain('7) start at seven\n8) eight');
        expect(state.getStateRef()).toEqual(snapshot);
    });
});
