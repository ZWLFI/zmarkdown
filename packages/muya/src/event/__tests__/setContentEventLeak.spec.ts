// @vitest-environment happy-dom

import { afterEach, describe, expect, it } from 'vitest';
import { Muya } from '../../muya';

// 切换标签 = 同一引擎反复 setContent。标题的复制链接按钮、任务列表复选框在
// 构造时往 eventCenter 登记 DOM 监听；整篇替换时这些块不会逐个 remove()，
// 登记表若只增不减，旧文档的 DOM 与块树会被闭包一直拽住，且每次登记的
// 查重是线性扫描，切换越多越慢。
function doc(n: number) {
    return Array.from({ length: n }, (_, i) => `## 标题 ${i}\n\n- [ ] 任务 ${i}\n`).join('\n');
}

let muya: Muya | null = null;

afterEach(() => {
    muya?.destroy();
    muya = null;
    document.body.innerHTML = '';
});

describe('eventCenter across setContent', () => {
    it('does not accumulate DOM listener registrations of replaced blocks', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        muya = new Muya(host, { markdown: doc(20) } as ConstructorParameters<typeof Muya>[1]);
        muya.init();
        muya.setContent(doc(20));
        const afterFirst = muya.eventCenter.events.length;

        for (let i = 0; i < 5; i++)
            muya.setContent(doc(20));

        expect(muya.eventCenter.events.length).toBe(afterFirst);
    });
});
