// 生成墨记 DMG 安装窗口背景图（1x + 2x）。
//
// 用法: swift scripts/make-dmg-background.swift <输出目录>
//   产出 <输出目录>/background.png 与 background@2x.png，目标位置
//   packages/desktop/build/ —— electron-builder 的 dmg 段会读这两个文件
//   （background@2x.png 存在时自动用 tiffutil 合成视网膜 TIFF）。
//
// 尺寸铁律：electron-builder 会用背景图的像素尺寸作为 Finder 窗口 bounds。
//   本图 600×448 → 窗口 600×448；其中标题栏 32pt + 底部信息栏 28pt 会盖住图片，
//   实际可见区域只有顶部 600×388。所有内容必须画在 y ∈ [0, 384]，
//   底部留作出血（bleed），越界的部分在用户机器上被裁掉。
//   图标位置（packages/desktop/electron-builder.yml 的 dmg.contents）：
//     y = 110 是图标顶边，图标视觉中心约 y+33 -> 箭头画在 y=143 对齐。
//
// 视觉沿用墨记自己的语言：墨蓝 #3D5A80、近白暖灰画布 #FCFCFB、Anthropic 字体族。
// 字体依赖本机已装的 AnthropicSansVariable-*（缺省回落到系统字体，重新生成前先确认）。
import AppKit

let outDir = CommandLine.arguments.dropFirst().first ?? "."

let W: CGFloat = 600, H: CGFloat = 448          // 图片 = Finder 窗口 bounds
let ICON_Y: CGFloat = 110                       // 与 electron-builder.yml dmg.contents 的 y 一致
let ICON_CENTER_Y: CGFloat = 143                // 图标视觉中心，箭头所在行
let ICON_L_X: CGFloat = 160, ICON_R_X: CGFloat = 440

// 调色板：与 renderer/src/assets/styles/tokens.css 的 claude-light 段同源
func color(_ hex: String, _ alpha: CGFloat = 1) -> NSColor {
    var v = UInt64(0)
    Scanner(string: hex.replacingOccurrences(of: "#", with: "")).scanHexInt64(&v)
    return NSColor(srgbRed: CGFloat((v >> 16) & 0xFF) / 255,
                   green: CGFloat((v >> 8) & 0xFF) / 255,
                   blue: CGFloat(v & 0xFF) / 255, alpha: alpha)
}
let canvas = color("#FCFCFB")          // --bg
let canvasTint = color("#F4F7FA")      // 画布底部的淡墨蓝
let muted = color("#65645F")           // --muted
let faint = color("#898781")           // --faint
let accent = color("#3D5A80")          // --accent 墨蓝

func font(_ name: String, _ size: CGFloat) -> NSFont {
    NSFont(name: name, size: size) ?? NSFont.systemFont(ofSize: size)
}
let sans = "AnthropicSansVariable-Text"           // 正文光学尺寸
let sansDisplay = "AnthropicSansVariable-Display" // 大字号光学尺寸
let serif = "AnthropicSerifVariable-Display"

let centered = NSMutableParagraphStyle()
centered.alignment = .center

// NSGraphicsContext 原点在左下，绘图统一用「距顶部」坐标再换算
func rect(_ x: CGFloat, _ topY: CGFloat, _ w: CGFloat, _ h: CGFloat) -> NSRect {
    NSRect(x: x, y: H - topY - h, width: w, height: h)
}
func draw(_ text: String, font f: NSFont, color c: NSColor, topY: CGFloat, height: CGFloat,
          tracking: CGFloat = 0, style: NSTextAlignment = .center, width: CGFloat = W, x: CGFloat = 0) {
    let p = NSMutableParagraphStyle()
    p.alignment = style
    var attrs: [NSAttributedString.Key: Any] = [.font: f, .foregroundColor: c, .paragraphStyle: p]
    if tracking != 0 { attrs[.kern] = tracking }
    NSAttributedString(string: text, attributes: attrs).draw(in: rect(x, topY, width, height))
}

func render(scale: CGFloat, to file: String) {
    let px = Int(W * scale), py = Int(H * scale)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: py,
                               bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                               colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
    rep.size = NSSize(width: W, height: H)   // 点坐标系 = 逻辑尺寸，像素 = 点 × scale
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

    // ── 画布：近白暖灰自上而下过渡到极淡墨蓝，克制不出戏
    NSGradient(colors: [canvas, color("#FAFAF9"), canvasTint],
               atLocations: [0, 0.45, 1], colorSpace: .sRGB)!
        .draw(in: NSRect(x: 0, y: 0, width: W, height: H), angle: -90)

    // ── 顶部：拉丁字标 + 一道极细的横线（呼应文档页眉；标题栏已是中文产品名，这里不重复）
    draw("MOMARK", font: font(serif, 11), color: accent.withAlphaComponent(0.55), topY: 28, height: 18, tracking: 5)
    let ruleW: CGFloat = 104
    let rule = NSBezierPath()
    rule.move(to: NSPoint(x: (W - ruleW) / 2, y: H - 58))
    rule.line(to: NSPoint(x: (W + ruleW) / 2, y: H - 58))
    rule.lineWidth = 1
    accent.withAlphaComponent(0.16).setStroke()
    rule.stroke()

    // ── 中间：拖拽箭头（两个图标由 Finder 画在 (160,110) 与 (440,110)）
    let arrowY = H - ICON_CENTER_Y
    let arrow = NSBezierPath()
    arrow.move(to: NSPoint(x: ICON_L_X + 62, y: arrowY))
    arrow.line(to: NSPoint(x: ICON_R_X - 74, y: arrowY))
    arrow.lineWidth = 2.2
    arrow.lineCapStyle = .round
    accent.withAlphaComponent(0.42).setStroke()
    arrow.stroke()

    let headLen: CGFloat = 12, headHalf: CGFloat = 7.5
    let tipX = ICON_R_X - 62
    let head = NSBezierPath()
    head.move(to: NSPoint(x: tipX - headLen, y: arrowY + headHalf))
    head.line(to: NSPoint(x: tipX, y: arrowY))
    head.line(to: NSPoint(x: tipX - headLen, y: arrowY - headHalf))
    head.lineWidth = 2.2
    head.lineCapStyle = .round
    head.lineJoinStyle = .round
    accent.withAlphaComponent(0.42).setStroke()
    head.stroke()

    // ── 主提示：拖进 Applications
    draw("把「墨记」拖进 Applications 完成安装",
         font: font(sansDisplay + "Semibold", 15.5), color: accent, topY: 232, height: 24)

    // ── 引导卡：首次打开被 macOS 拦下时的放行路径
    let card = NSRect(x: 48, y: H - 372, width: W - 96, height: 104)
    let cardPath = NSBezierPath(roundedRect: card, xRadius: 12, yRadius: 12)
    color("#FFFFFF", 0.78).setFill()
    cardPath.fill()
    color("#0B0B0B", 0.10).setStroke()
    cardPath.lineWidth = 1
    cardPath.stroke()

    draw("首次打开若提示「无法验证开发者」或「已损坏」：",
         font: font(sans + "Medium", 11.5), color: muted, topY: 286, height: 17)
    draw("打开「系统设置 › 隐私与安全性」，在「安全性」一栏点「仍要打开」",
         font: font(sans + "Semibold", 12.5), color: accent, topY: 309, height: 18)
    draw("Open System Settings › Privacy & Security  ›  \"Open Anyway\"",
         font: font(sans + "Regular", 10.5), color: faint, topY: 335, height: 15)

    NSGraphicsContext.restoreGraphicsState()
    let url = URL(fileURLWithPath: outDir).appendingPathComponent(file)
    try! rep.representation(using: .png, properties: [:])!.write(to: url)
    print("wrote \(url.path) \(px)x\(py)")
}

render(scale: 1, to: "background.png")
render(scale: 2, to: "background@2x.png")
