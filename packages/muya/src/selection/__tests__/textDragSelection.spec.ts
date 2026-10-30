// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { Muya } from '../../muya';

let muya: Muya | undefined;
afterEach(() => muya?.destroy());

it.each([true, false])('uses the final native range after returning to the starting paragraph (last move observed: %s)', (lastMoveObserved) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    muya = new Muya(host, { markdown: 'before HELLO after\n\nsecond untouched\n' });
    muya.init();
    const paragraphs = muya.domNode.querySelectorAll('.mu-paragraph-content');
    const first = document.createTreeWalker(paragraphs[0], NodeFilter.SHOW_TEXT).nextNode()!;
    const second = document.createTreeWalker(paragraphs[1], NodeFilter.SHOW_TEXT).nextNode()!;
    const select = (end: Node, offset: number) => {
        const range = document.createRange();
        range.setStart(first, 7);
        range.setEnd(end, offset);
        document.getSelection()!.removeAllRanges();
        document.getSelection()!.addRange(range);
    };
    const mouse = (type: string) => {
        const event = new MouseEvent(type, { bubbles: true, button: 0 });
        if (!('x' in event))
            Object.defineProperty(event, 'x', { value: 0 });
        paragraphs[0].dispatchEvent(event);
    };

    mouse('mousedown');
    select(second, 6);
    mouse('mousemove');
    select(first, 12);
    if (lastMoveObserved)
        mouse('mousemove');
    expect(document.getSelection()!.toString()).toBe('HELLO');
    mouse('mouseup');
    expect(document.getSelection()!.toString()).toBe('HELLO');
    expect(muya.editor.selection.getSelection()?.isSelectionInSameBlock).toBe(true);
});
