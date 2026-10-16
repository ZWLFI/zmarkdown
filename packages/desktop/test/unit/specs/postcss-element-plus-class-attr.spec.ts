import { readFileSync } from 'fs'
import { createRequire } from 'module'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { elementPlusClassAttrRewrite } from '../../../postcss-element-plus-class-attr'

const require = createRequire(import.meta.url)
const cssFile = require.resolve('element-plus/dist/index.css')

const run = (css: string, from: string) =>
  postcss([elementPlusClassAttrRewrite()]).process(css, { from }).css

// `[class…]` 出现在后代/子代组合符左侧的复合选择器里，才会让任一元素改 class 时作废整棵子树。
const hasAncestorClassAttr = (selector: string) =>
  /\[class[*^$|~]?=[^\]]*\][^,]*?[\s>+~]+[^\s>+~,]/.test(selector)

describe('Element Plus [class*=…] 选择器改写', () => {
  it('改写后 Element Plus 样式里不再有祖先位置的 class 属性选择器', () => {
    const out = postcss.parse(run(readFileSync(cssFile, 'utf8'), cssFile))
    const offenders: string[] = []
    out.walkRules((rule) =>
      rule.selectors.filter(hasAncestorClassAttr).forEach((s) => offenders.push(s))
    )
    // 剩下的 `[class*=el-icon]+span` 是兄弟组合：只作废紧邻的下一个 span，不波及整棵子树
    expect(offenders.filter((s) => !/\]\s*\+\s*span$/.test(s))).toEqual([])
  })

  it('输入框数字控件按尺寸类改写为显式类名', () => {
    const css =
      '.el-input-number.is-controls-right[class*=small] [class*=increase],.el-input-number.is-controls-right[class*=small] [class*=decrease]{--h:11px}'
    expect(() => run(css, cssFile)).toThrow(/未在 Element Plus 样式中找到/)
    const full = run(readFileSync(cssFile, 'utf8'), cssFile)
    expect(full).toContain(
      '.el-input-number.is-controls-right.el-input-number--small .el-input-number__increase'
    )
    expect(full).not.toContain('[class*=small] [class*=increase]')
  })

  it('不碰其它来源的样式', () => {
    const css = '.a[class*=small] [class*=increase]{color:red}'
    expect(run(css, '/x/app.css')).toBe(css)
  })
})
