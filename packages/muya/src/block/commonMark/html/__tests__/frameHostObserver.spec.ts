// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Muya } from '../../../../muya';

// 脚本 HTML 块的外壳要跟随正文栏（宿主 .mu-container）宽度。宿主比块活得久：切标签 /
// 撤销重做 / 外部重载只换块、不换宿主。原先每个块各建一个 ResizeObserver 去 observe
// 宿主，宿主就经观察器强引用住块的闭包与整棵已丢弃的旧文档 DOM（2026-10-15 实测：
// 12 个脚本块的文档每切一次标签多留约 2 万个节点、690 个监听器，GC 收不回）。
// 现在宿主只登记在一个共享观察器上，宿主变化时按当前 DOM 找出仍在宿主里的外壳。
// 这里钉住：块自己的观察器只看自己的 iframe；宿主只被观察一次；宿主变宽时仍在的块
// 跟随，已丢弃的块不再被调用。

const SCRIPT_BLOCK = (id: string) => `<div id="${id}">hi</div><script>document.getElementById("${id}").textContent = "1";</script>`;

class RecordingResizeObserver {
    static instances: RecordingResizeObserver[] = [];
    readonly cb: ResizeObserverCallback;
    readonly targets: Element[] = [];

    constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        RecordingResizeObserver.instances.push(this);
    }

    observe(target: Element): void {
        this.targets.push(target);
    }

    unobserve(): void {}
    disconnect(): void {}
}

let originalRO: typeof ResizeObserver;

beforeAll(() => {
    originalRO = globalThis.ResizeObserver;
    globalThis.ResizeObserver = RecordingResizeObserver as unknown as typeof ResizeObserver;
});

afterAll(() => {
    globalThis.ResizeObserver = originalRO;
});

function flushFrames(times = 4): Promise<void> {
    return new Promise((resolve) => {
        let count = 0;
        const step = () => {
            count += 1;
            if (count >= times)
                resolve();
            else
                requestAnimationFrame(step);
        };
        requestAnimationFrame(step);
    });
}

async function boot(markdown: string) {
    window.MUYA_VERSION = 'test';
    const host = document.createElement('div');
    document.body.appendChild(host);
    const muya = new Muya(host, { markdown } as ConstructorParameters<typeof Muya>[1]);
    muya.init();
    await vi.waitFor(() => {
        if (muya.domNode.querySelectorAll('.mu-html-frame').length < 2)
            throw new Error('frame shells not mounted');
    });

    return muya;
}

function mountShells(muya: Muya, hostWidth: number) {
    const shells = [...muya.domNode.querySelectorAll<HTMLElement>('.mu-html-frame')];
    const layoutHost = shells[0].closest('figure')!.parentElement as HTMLElement;
    Object.defineProperty(layoutHost, 'clientWidth', { configurable: true, value: hostWidth });
    for (const shell of shells) {
        const frame = shell.querySelector('iframe') as HTMLElement;
        Object.defineProperty(frame, 'offsetWidth', { configurable: true, value: 1200 });
        Object.defineProperty(frame, 'offsetHeight', { configurable: true, value: 360 });
        frame.dispatchEvent(new Event('load'));
    }

    return { shells, layoutHost };
}

function hostEntries(observer: RecordingResizeObserver, target: Element) {
    observer.cb([{ target } as unknown as ResizeObserverEntry], observer as unknown as ResizeObserver);
}

describe('script HTML frames observe their host through one shared observer', () => {
    it('per-block observers only watch their own iframe; the host is observed once', async () => {
        const muya = await boot(`<!--momark-frame w=1200 h=360-->\n${SCRIPT_BLOCK('a')}\n\n<!--momark-frame w=1200 h=360-->\n${SCRIPT_BLOCK('b')}\n`);
        const { shells, layoutHost } = mountShells(muya, 800);
        await flushFrames();

        const hostWatchers = RecordingResizeObserver.instances.filter(o => o.targets.includes(layoutHost));
        expect(hostWatchers.length).toBe(1);
        expect(hostWatchers[0].targets.filter(t => t === layoutHost).length).toBe(1);

        const blockObservers = RecordingResizeObserver.instances.filter(o => o !== hostWatchers[0] && o.targets.length);
        expect(blockObservers.length).toBe(2);
        for (const o of blockObservers)
            expect(o.targets.every(t => t.tagName === 'IFRAME')).toBe(true);

        // 宿主变宽 → 仍在宿主里的块回到用户尺寸（经共享观察器）。
        expect(shells.map(s => s.style.width)).toEqual(['700px', '700px']);
        Object.defineProperty(layoutHost, 'clientWidth', { configurable: true, value: 1400 });
        hostEntries(hostWatchers[0], layoutHost);
        await flushFrames();
        expect(shells.map(s => s.style.width)).toEqual(['1200px', '1200px']);

        // 换文档后旧外壳已脱离宿主：宿主再变也不会再碰它们。
        muya.setContent('plain paragraph\n');
        Object.defineProperty(layoutHost, 'clientWidth', { configurable: true, value: 600 });
        hostEntries(hostWatchers[0], layoutHost);
        await flushFrames();
        expect(shells.map(s => s.style.width)).toEqual(['1200px', '1200px']);
        expect(shells.every(s => !s.isConnected)).toBe(true);

        muya.domNode.remove();
    });
});
