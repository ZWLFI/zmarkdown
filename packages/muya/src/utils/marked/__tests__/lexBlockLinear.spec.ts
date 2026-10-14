import type { Token, TokenizerExtension } from 'marked';
import type { ILexOption } from '../types';
import { Marked } from 'marked';
import { describe, expect, it } from 'vitest';
import compatibleTaskList from '../compatibleTaskList';
import footnoteExtension from '../extensions/footnote';
import mathExtension from '../extensions/math';
import { lexBlock } from '../lexBlock';
import walkTokens from '../walkTokens';

// Large-file performance: `lexBlock` used to be quadratic in two places —
// marked's `walkTokens` (concats every callback result into one growing
// array) and the block extensions' `start()` (scanned the whole rest of the
// document once per paragraph). Both were rewritten to linear forms; this
// spec pins that the token output is unchanged against the original
// implementation on a mixed corpus.

function lexBlockReference(src: string, options: ILexOption): Token[] {
    src = src.replace(/\r\n?/g, '\n');
    const m = new Marked();
    if (options.math) {
        const ext = mathExtension({ throwOnError: false, useKatexRender: false });
        ext.extensions[1]!.start = (s: string) => s.indexOf('\n$');
        m.use(ext);
    }
    if (options.footnote) {
        const ext = footnoteExtension();
        (ext.extensions![0] as TokenizerExtension).start = (s: string) => {
            const match = /\n\[\^[^^[\]\s]+(?<!\\)\]:/.exec(s);
            return match ? match.index + 1 : undefined;
        };
        m.use(ext);
    }
    let tokens = new m.Lexer(m.defaults).blockTokens(src) as Token[];
    tokens = compatibleTaskList(tokens);
    m.walkTokens(tokens, walkTokens(options));

    return tokens;
}

const CASES: Record<string, string> = {
    'math block right after a paragraph line': 'some text\n$$\na^2\n$$\n\nafter\n',
    'math block far below many paragraphs': `${'para line\n\n'.repeat(30)}$$\nx\n$$\n`,
    'single-dollar block and inline math': 'intro $a$ text\n$\nb\n$\n',
    'paragraph lines starting with $ inside': 'cost\n$5 only\nend\n\nnext\n',
    'gitlab math nested in list and quote':
        '- item\n\n  ```math\n  a+b\n  ```\n\n> ```math\n> c\n> ```\n',
    'tables, task lists, headings': [
        '# Title',
        '',
        'Setext',
        '===',
        '',
        '| a | b |',
        '| --- | --- |',
        '| `x` | **y** |',
        '',
        '- [ ] todo',
        '- [x] done',
        '  1. nested',
        '',
        '```js',
        'const a = 1',
        '```',
        '',
        '    indented code',
        '',
    ].join('\n'),
    'footnote definitions after paragraphs':
        'text with ref[^1]\n[^1]: the note\n\nmore[^b]\n\n[^b]:\n    indented body\n',
};

describe('lexBlock linear rewrite matches the original implementation', () => {
    for (const footnote of [false, true]) {
        for (const [name, src] of Object.entries(CASES)) {
            it(`${name} (footnote: ${footnote})`, () => {
                const options: ILexOption = {
                    footnote,
                    math: true,
                    isGitlabCompatibilityEnabled: true,
                    frontMatter: false,
                };

                expect(JSON.stringify(lexBlock(src, options))).toBe(
                    JSON.stringify(lexBlockReference(src, options)),
                );
            });
        }
    }

    it('math block after a paragraph line still interrupts it', () => {
        const types = lexBlock('some text\n$$\na^2\n$$\n').map(token => token.type);

        expect(types).toEqual(['paragraph', 'multiplemath']);
    });

    it('stays fast on a large document', () => {
        const chunk = '段落文字 **加粗** 与 `代码`。\n\n- 列表项\n- [ ] 任务\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\n';
        const src = `${chunk.repeat(4000)}$$\nx\n$$\n`;
        const t0 = performance.now();
        lexBlock(src);

        // The quadratic version takes several seconds on this input.
        expect(performance.now() - t0).toBeLessThan(1500);
    });
});
