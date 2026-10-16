import type { ILexOption } from '../types';
import { Marked } from 'marked';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fm, { frontMatterRender } from '../frontMatter';
import { createHtmlMarked, getHighlightHtml } from '../getHighlightHtml';
import { DEFAULT_OPTIONS } from '../options';

// HTML export / copy-as-HTML / static rendering go through `getHighlightHtml`.
// It used to let marked run its own `walkTokens`, which concatenates every
// callback result into one growing array — quadratic in document size (1.4s of
// a 2.3s HTML export of a 2MB document, 2026-10-15). The walk now runs through
// the in-place `visitTokens` from a `processAllTokens` hook. These specs pin
// that the HTML is byte-identical to marked's own walk on a mixed corpus, that
// marked's walk is no longer used, and that the cost stays linear.

function reference(src: string, options: ILexOption): string {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    let html = '';
    if (options.frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            html = frontMatterRender(token);
            src = newSrc;
        }
    }

    return html + (createHtmlMarked(options).parse(src) as string);
}

const CORPUS = [
    '---',
    'title: 前置元数据',
    '---',
    '',
    '# 标题 **粗体** 与 `code`',
    '',
    'Setext 标题',
    '===',
    '',
    '中文**"加粗"**中文，行内公式 $a^2 + b^2$，上标 ^sup^ 与下标 ~sub~，emoji :smile:。',
    '',
    '```js',
    'const answer = 42 // 注释',
    'function f(x) { return x * 2 }',
    '```',
    '',
    '```python',
    'def g(y):',
    '    return y ** 2',
    '```',
    '',
    '    indented code keeps no language',
    '',
    '```math',
    'E = mc^2',
    '```',
    '',
    '$$',
    '\\int_0^1 x\\,dx',
    '$$',
    '',
    '```mermaid',
    'flowchart LR',
    '  A --> B',
    '```',
    '',
    '- 列表 `inline`',
    '  - 嵌套 **粗体**',
    '    1. 有序 [链接](https://example.com)',
    '- [ ] 任务',
    '- [x] 完成',
    '',
    '> 引用里的代码：',
    '> ```ts',
    '> let t: number = 1',
    '> ```',
    '',
    '| 列 A | 列 B |',
    '| --- | :-: |',
    '| `a` | **b** |',
    '| $x$ | 脚注[^1] |',
    '',
    '<div class="raw"><b>html</b></div>',
    '',
    '[^1]: 脚注内容，含 `code` 与 *强调*。',
    '',
].join('\n');

const OPTION_SETS: ILexOption[] = [
    {},
    { math: true, isGitlabCompatibilityEnabled: true },
    { math: true, footnote: true, superSubScript: true },
    { frontMatter: true, math: false, footnote: true },
];

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getHighlightHtml walks tokens linearly', () => {
    it.each(OPTION_SETS.map(o => [JSON.stringify(o), o] as const))(
        'renders byte-identical HTML to marked\'s own walkTokens (%s)',
        (_name, options) => {
            expect(getHighlightHtml(CORPUS, options)).toBe(reference(CORPUS, options));
        },
    );

    it('highlights fenced code (the walk actually ran)', () => {
        const html = getHighlightHtml(CORPUS, {});
        expect(html).toContain('<code class="language-js">');
        expect(html).toMatch(/<span class="token keyword">const<\/span>/);
        expect(html).not.toContain('class="language-indented');
    });

    it('does not use marked\'s quadratic walkTokens', () => {
        const spy = vi.spyOn(Marked.prototype, 'walkTokens');
        getHighlightHtml(CORPUS, { math: true, footnote: true });
        expect(spy).not.toHaveBeenCalled();
    });

    it('scales linearly with document size', () => {
        const block = '段落 **粗体** `code` [链接](https://e.com)\n\n```js\nconst a = 1\n```\n\n- 项目 *强调*\n- 项目二\n\n';
        const time = (n: number) => {
            const src = block.repeat(n);
            getHighlightHtml(src, {}); // warm-up
            const t0 = performance.now();
            getHighlightHtml(src, {});
            return performance.now() - t0;
        };
        const small = time(500);
        const large = time(4000);
        // 8x the input; a quadratic walk lands near 30–60x here.
        expect(large / small).toBeLessThan(20);
    });
});
