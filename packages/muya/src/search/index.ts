import type Content from '../block/base/content';
import type TreeNode from '../block/base/treeNode';
import type { IHighlight } from '../inlineRenderer/types';
import type { Muya } from '../muya';
import type { IMatch } from './types';
import { CLASS_NAMES, DEFAULT_SEARCH_OPTIONS } from '../config';
import { buildRegexValue, matchString } from '../utils/search';

// Search highlight spans (`Renderer.getHighlightClassName`): the active match
// and every other match. Annotation highlights use their own classes.
const SEARCH_HIGHLIGHT_SELECTOR = `span.${CLASS_NAMES.MU_HIGHLIGHT}, span.${CLASS_NAMES.MU_SELECTION}`;

export class Search {
    private _value: string = '';
    public matches: IMatch[] = [];
    public index: number = -1;

    get value() {
        return this._value;
    }

    private get _scrollPage() {
        return this._muya.editor.scrollPage;
    }

    constructor(private _muya: Muya) {}

    // Drop match state when the document is replaced (e.g. a tab switch), so
    // stale matches don't reference the previous document's blocks (#1932).
    reset() {
        this._value = '';
        this.matches = [];
        this.index = -1;
    }

    private _highlightsByBlock(): Map<Content, IHighlight[]> {
        const { matches, index } = this;
        const matchesMap = new Map<Content, IHighlight[]>();

        for (let i = 0; i < matches.length; i++) {
            const { block, start, end } = matches[i];
            const highlight: IHighlight = { start, end, active: i === index };
            const highlights = matchesMap.get(block);

            if (highlights)
                highlights.push(highlight);
            else
                matchesMap.set(block, [highlight]);
        }

        return matchesMap;
    }

    // `skipRender`: blocks the caller is about to re-render anyway, so a clear
    // pass need not paint them twice. Blur / focus bookkeeping still runs for
    // every block.
    private _updateMatches(isClear = false, skipRender?: Set<Content>) {
        for (const [block, highlights] of this._highlightsByBlock()) {
            const isActive = highlights.some(h => h.active);

            if (!skipRender?.has(block))
                block.update(undefined, isClear ? [] : highlights);

            if (block.parent?.active && !isActive)
                block.blurHandler();

            if (isActive && !isClear)
                block.focusHandler();
        }
    }

    // After `find()` moves the active match only two blocks change highlights:
    // the one holding the previous active match and the one holding the new
    // one. Re-rendering every matched block (twice — a clear pass, then a
    // highlight pass) cost ~3s per Enter on a 5MB document with ~9.5k matches.
    // A matched block whose highlights an edit has since wiped is re-rendered
    // as well, so it comes back highlighted exactly as before. Blur / focus
    // calls are the same as a full `_updateMatches()` pass.
    private _moveActiveMatch(prevIndex: number) {
        const changed = new Set<Content>([this.matches[this.index].block]);
        if (this.matches[prevIndex])
            changed.add(this.matches[prevIndex].block);

        for (const [block, highlights] of this._highlightsByBlock()) {
            const isActive = highlights.some(h => h.active);

            if (changed.has(block) || !block.domNode?.querySelector(SEARCH_HIGHLIGHT_SELECTOR))
                block.update(undefined, highlights);

            if (block.parent?.active && !isActive)
                block.blurHandler();

            if (isActive)
                block.focusHandler();
        }
    }

    // `values[i]` is the replacement text for `matches[i]`: one entry per match
    // because a regex replacement expands `$N` against ITS OWN capture groups —
    // expanding once from the active match and pasting that text into every
    // occurrence replaced the wrong groups everywhere else (C-6). Literal
    // (non-regexp) callers pass the same string N times.
    private _innerReplace(matches: IMatch[], values: string[]) {
        if (!matches.length)
            return;

        let tempText = '';
        let lastBlock = matches[0].block;
        let lastEnd = 0;

        for (let i = 0; i < matches.length; i++) {
            const { start, end, block } = matches[i];
            if (lastBlock !== block) {
                if (lastBlock)
                    lastBlock.text = tempText + lastBlock.text.substring(lastEnd);

                tempText = '';
                lastEnd = 0;
                lastBlock = block;
            }

            tempText += block.text.substring(lastEnd, start);
            tempText += values[i];
            lastEnd = end;
        }

        lastBlock.text = tempText + lastBlock.text.substring(lastEnd);
    }

    replace(replaceValue: string, opt = { isSingle: true, isRegexp: false }) {
        const { isSingle, isRegexp, ...rest } = opt;
        const options = Object.assign({}, DEFAULT_SEARCH_OPTIONS, rest);
        const { matches, index } = this;
        const value = this._value;

        if (matches.length) {
            // Expand `$N` per match, against that match's own groups. A regex
            // replacement is inserted verbatim: `$&` / `$$` in the expansion are
            // the user's text, never a second round of replacement syntax (C-5).
            const expand = (match: IMatch) => isRegexp ? buildRegexValue(match, replaceValue) : replaceValue;

            if (isSingle) {
                // replace one
                this._innerReplace([matches[index]], [expand(matches[index])]);
            }
            else {
                // replace all
                this._innerReplace(matches, matches.map(expand));
            }
            const highlightIndex = index < matches.length - 1 ? index : index - 1;

            this.search(value, {
                ...options,
                highlightIndex: isSingle ? highlightIndex : -1,
            });
        }

        return this;
    }

    /**
     * Find preview or next value, and highlight it.
     * @param {string} action : previous or next.
     */
    find(action: 'previous' | 'next'): this {
        const { matches } = this;
        let { index } = this;
        const len = matches.length;

        if (!len)
            return this;

        index = action === 'next' ? index + 1 : index - 1;

        if (index < 0)
            index = len - 1;

        if (index >= len)
            index = 0;

        const prevIndex = this.index;
        this.index = index;

        this._moveActiveMatch(prevIndex);

        return this;
    }

    /**
     * Search value in current document.
     * @param {string} value
     * @param {object} opts
     */
    search(value: string, opts = {}) {
        const matches: IMatch[] = [];
        const options = Object.assign({}, DEFAULT_SEARCH_OPTIONS, opts);
        const { highlightIndex, selectHighlight } = options;
        let index = -1;

        // The currently active match, captured before it is cleared below, so a
        // `selectHighlight` request can drop the cursor back onto it when the
        // new search has no match of its own (e.g. closing the search bar).
        const prevActiveMatch = this.matches[this.index];

        // Highlight current search.
        if (value) {
            this._scrollPage?.depthFirstTraverse((block: TreeNode) => {
                if (block.isContent()) {
                    const { text } = block;
                    if (text && typeof text === 'string') {
                        const strMatches = matchString(text, value, options);
                        matches.push(
                            ...strMatches.map(({ index, match, subMatches }) => {
                                return {
                                    block,
                                    start: index,
                                    end: index + match.length,
                                    match,
                                    subMatches,
                                };
                            }),
                        );
                    }
                }
            });
        }

        if (highlightIndex !== -1) {
            // If set the highlight index, then highlight the highlighIndex
            index = highlightIndex;
        }
        else if (matches.length) {
            // highlight the first word that matches.
            index = 0;
        }

        // Empty last search. Blocks that match again are repainted by the
        // highlight pass right below, so the clear pass skips painting them.
        this._updateMatches(true, new Set(matches.map(m => m.block)));

        Object.assign(this, { _value: value, matches, index });

        this._updateMatches();

        // Restore the editor cursor onto the active match. Mirrors muyajs's
        // `render(selectHighlight)` -> `setCursor()` path: closing the search
        // bar empties the search with `selectHighlight`, which must place the
        // cursor where the highlight was so the user can keep typing there.
        if (selectHighlight) {
            const activeMatch = matches[index] ?? prevActiveMatch;
            if (activeMatch) {
                const { block, start, end } = activeMatch;
                block.setCursor(start, end, true);
            }
        }

        return this;
    }
}
