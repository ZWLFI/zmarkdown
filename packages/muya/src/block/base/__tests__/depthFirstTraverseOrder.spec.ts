// @vitest-environment happy-dom

import type TreeNode from '../treeNode';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Muya } from '../../../muya';

// `Parent.depthFirstTraverse` visits nodes in document (pre-)order; search,
// annotation anchoring and cursor-offset mapping rely on it. The traversal was
// rewritten from front-insertion (`shift` + `splice`) to a reversed push / pop
// stack for speed (2026-10-15); the visit order must stay identical.

const hosts: HTMLElement[] = [];

beforeEach(() => {
    window.MUYA_VERSION = 'test';
});

afterEach(() => {
    while (hosts.length)
        hosts.pop()!.remove();
});

function preorder(node: TreeNode, out: TreeNode[] = []): TreeNode[] {
    out.push(node);
    if (node.isParent())
        node.children.forEach(child => preorder(child, out));

    return out;
}

describe('depthFirstTraverse', () => {
    it('visits every node once, in document pre-order, on a nested document', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const muya = new Muya(host, {
            markdown: [
                '# Title',
                '',
                'para **bold**',
                '',
                '- a',
                '  - a.1',
                '    1. a.1.i',
                '- b',
                '',
                '> quote',
                '> - in quote',
                '',
                '| h1 | h2 |',
                '| --- | --- |',
                '| c1 | c2 |',
                '',
                '```js',
                'code',
                '```',
                '',
                'tail',
                '',
            ].join('\n'),
        } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        hosts.push(muya.domNode);

        const root = muya.editor.scrollPage!;
        const visited: TreeNode[] = [];
        root.depthFirstTraverse(node => visited.push(node));

        const expected = preorder(root);
        expect(visited.length).toBe(expected.length);
        expect(visited.every((node, i) => node === expected[i])).toBe(true);
        expect(new Set(visited).size).toBe(visited.length);
    });
});
