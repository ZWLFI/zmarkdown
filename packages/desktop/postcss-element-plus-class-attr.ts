import type { Plugin } from 'postcss'

// Element Plus 有几条规则把 `[class*=…]` 放在非最右的复合选择器里，例如
// `.el-input-number.is-controls-right[class*=small] [class*=increase]`。Blink 据此给 class 属性建
// 「后代里凡带 class 的元素都作废」的失效集：页面上任一元素改 class（`#app`、布局层、`.mu-editor`
// 切状态类）都会让整篇文档重算样式，2MB 文档约 0.8s/次。这里按 Element Plus 2.14 的真实 DOM
// 改写成等价的显式类名。只在最右复合里的 `[class*=…]`（如 `.el-step__icon-inner[class*=el-icon]`）
// 只作废元素自身或紧邻兄弟，不在此列。
const REWRITES = new Map<string, string>([
  // 按钮里带 el-icon 字样的只有 ElIcon 组件根 `<i class="el-icon">`；本应用不用旧版 `el-icon-*` 字体图标。
  ['.el-button [class*=el-icon] svg', '.el-button .el-icon svg'],
  [
    '.el-input-number.is-controls-right[class*=large] [class*=increase]',
    '.el-input-number.is-controls-right.el-input-number--large .el-input-number__increase'
  ],
  [
    '.el-input-number.is-controls-right[class*=large] [class*=decrease]',
    '.el-input-number.is-controls-right.el-input-number--large .el-input-number__decrease'
  ],
  [
    '.el-input-number.is-controls-right[class*=small] [class*=increase]',
    '.el-input-number.is-controls-right.el-input-number--small .el-input-number__increase'
  ],
  [
    '.el-input-number.is-controls-right[class*=small] [class*=decrease]',
    '.el-input-number.is-controls-right.el-input-number--small .el-input-number__decrease'
  ],
  // 行上的 `el-table__row--level-<n>` 只在树形数据时出现；本应用不用树形表格，列出 0–9 级已覆盖。
  [
    '.el-table [class*=el-table__row--level] .el-table__expand-icon',
    `.el-table :is(${Array.from({ length: 10 }, (_, i) => `.el-table__row--level-${i}`).join(',')}) .el-table__expand-icon`
  ]
])

const isElementPlusSheet = (file: string | undefined): boolean =>
  !!file && /[\\/]element-plus[\\/]dist[\\/]index\.css$/.test(file)

export function elementPlusClassAttrRewrite(): Plugin {
  return {
    postcssPlugin: 'momark-element-plus-class-attr',
    Once(root) {
      if (!isElementPlusSheet(root.source?.input.file)) return
      const unmatched = new Set(REWRITES.keys())
      root.walkRules((rule) => {
        if (!rule.selector.includes('[class')) return
        rule.selectors = rule.selectors.map((sel) => {
          const next = REWRITES.get(sel)
          if (next === undefined) return sel
          unmatched.delete(sel)
          return next
        })
      })
      // Element Plus 升级改了这些选择器时宁可构建失败，也不要悄悄退回整篇重算。
      if (unmatched.size > 0) {
        throw new Error(`[momark-element-plus-class-attr] 未在 Element Plus 样式中找到：${[...unmatched].join(' | ')}`)
      }
    }
  }
}
