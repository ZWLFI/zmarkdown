import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// 滚动条淡入曾靠给 body 加减 .scroll-engaged 类名（规则
// `body.scroll-engaged ::-webkit-scrollbar-thumb`）。全局样式里有 Element Plus 的
// `[class*=…]` 后代选择器，任何 class 变化都会让 Blink 把带 class 的后代全部作废
// 重算：2MB 文档每次滚动开始/结束各约 0.8s（2026-10-15 实测 37.5 万元素）。
// 现在改为在滚动容器自身标 data-scroll-engaged 属性、规则只命中它自己的滑块。
// 这里按源码形态钉住，防止改回 class 或改回后代选择器。

const here = dirname(fileURLToPath(import.meta.url))
const rendererSrc = resolve(here, '../../../src/renderer/src')

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? walk(p) : [p]
  })

const styleText = (file: string): string => {
  const raw = readFileSync(file, 'utf8')
  const css = file.endsWith('.vue')
    ? [...raw.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n')
    : raw
  return css.replace(/\/\*[\s\S]*?\*\//g, () => '')
}

const selectorsMentioning = (needle: string): string[] => {
  const out: string[] = []
  for (const file of walk(rendererSrc).filter((p) => /\.(css|vue)$/.test(p))) {
    for (const m of styleText(file).matchAll(/([^{}]*)\{/g)) {
      if (m[1].includes(needle)) out.push(...m[1].split(',').map((s) => s.trim()))
    }
  }
  return out.filter((s) => s.includes(needle))
}

describe('scroll-engaged scrollbar fade — no whole-document style invalidation', () => {
  it('the fade rule targets the scroller’s own scrollbar via a data attribute', () => {
    const selectors = selectorsMentioning('scroll-engaged')
    expect(selectors.length).toBeGreaterThan(0)
    for (const sel of selectors) {
      // Compound selector only — no class, no combinator, nothing on body.
      expect(sel, sel).toMatch(/^\[data-scroll-engaged\]::-webkit-scrollbar-[a-z-]+$/)
    }
  })

  it('the scroll listener marks the scrolling element with an attribute, not a class', () => {
    const app = readFileSync(resolve(rendererSrc, 'pages/app.vue'), 'utf8')
    expect(app).not.toMatch(/classList\.(add|toggle)\(\s*'scroll-engaged'/)
    expect(app).toMatch(/scroller\.setAttribute\('data-scroll-engaged'/)
  })
})
