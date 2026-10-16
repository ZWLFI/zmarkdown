import type { Token, Tokens } from 'marked';
import type { IFrontmatterToken, ILexOption, TLexedToken } from './types';
import { Marked } from 'marked';
import compatibleTaskList from './compatibleTaskList';
import footnoteExtension from './extensions/footnote';
import mathExtension from './extensions/math';
import fm from './frontMatter';
import { DEFAULT_OPTIONS } from './options';
import walkTokens from './walkTokens';

type TChildTokens = Record<string, string[]> | undefined;

// Same visiting order as `Marked#walkTokens` (callback first, then table cells,
// list items, extension `childTokens` or `tokens`). marked's version concats
// every callback result into one array as it goes — copying the accumulated
// array once per token — which is quadratic in document size; we only need the
// side effects, so visit in place.
export function visitTokens(tokens: Token[], visit: (token: Token) => void, childTokens: TChildTokens) {
    for (const token of tokens) {
        visit(token);
        switch (token.type) {
            case 'table': {
                const { header, rows } = token as Tokens.Table;
                for (const cell of header)
                    visitTokens(cell.tokens, visit, childTokens);
                for (const row of rows) {
                    for (const cell of row)
                        visitTokens(cell.tokens, visit, childTokens);
                }
                break;
            }

            case 'list':
                visitTokens((token as Tokens.List).items, visit, childTokens);
                break;

            default: {
                const names = childTokens?.[token.type];
                if (names) {
                    for (const name of names) {
                        const children = (token as Record<string, unknown>)[name] as unknown[];
                        visitTokens(children.flat(Infinity) as Token[], visit, childTokens);
                    }
                }
                else if ('tokens' in token && token.tokens) {
                    visitTokens(token.tokens, visit, childTokens);
                }
            }
        }
    }
}

export function lexBlock(
    src: string,
    options: ILexOption = DEFAULT_OPTIONS,
): TLexedToken[] {
    options = Object.assign({}, DEFAULT_OPTIONS, options);
    // `marked.lex()` normalizes CRLF/CR before tokenizing; calling
    // `Lexer.blockTokens` directly bypasses that step, so a CRLF document kept a
    // `\r` glued to the end of every heading / fence / front-matter line — which
    // defeat the `^`-anchored block starts and misparse the document (C-11).
    // Normalize once, at the single entry, so every downstream consumer
    // (front matter included) sees LF.
    src = src.replace(/\r\n?/g, '\n');
    const { math, frontMatter, footnote } = options;
    let tokens: (Token | IFrontmatterToken)[] = [];

    // Use a per-call Marked instance so extensions don't bleed across calls.
    // marked.use() on the global singleton would make math / footnote sticky:
    // any consumer that once passed `math: true` would get math parsing forever.
    const m = new Marked();

    if (math) {
        m.use(
            mathExtension({
                throwOnError: false,
                useKatexRender: false,
            }),
        );
    }

    if (footnote) {
        m.use(footnoteExtension());
    }

    if (frontMatter) {
        const { token, src: newSrc } = fm(src);
        if (token) {
            tokens.push(token);
            src = newSrc;
        }
    }

    // Pass `m.defaults` to the Lexer so the extensions registered via m.use()
    // are picked up; the no-arg constructor would fall back to global defaults.
    tokens.push(...new m.Lexer(m.defaults).blockTokens(src));
    tokens = compatibleTaskList(tokens as Token[]);
    visitTokens(tokens as Token[], walkTokens(options), m.defaults.extensions?.childTokens);

    // After walkTokens / compatibleTaskList run, marked's Heading/List/ListItem
    // tokens have been augmented with muya-specific fields (headingStyle,
    // marker, listType, listItemType, bulletMarkerOrDelimiter). The wider
    // TLexedToken union captures that runtime shape.
    return tokens as TLexedToken[];
}
