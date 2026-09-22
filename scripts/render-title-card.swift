#!/usr/bin/swift
import AppKit
import Foundation

guard CommandLine.arguments.count == 6,
      let width = Double(CommandLine.arguments[2]),
      let height = Double(CommandLine.arguments[3]) else {
  fputs("usage: render-title-card.swift output.png width height text.txt style.json\n", stderr)
  exit(2)
}

struct TitleCardStyle: Decodable {
  let backgroundColor: String
  let titleColor: String
  let bodyColor: String
  let captionColor: String
  let alignment: String
  let titleScale: String
}

func color(_ hex: String, fallback: NSColor) -> NSColor {
  let value = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
  guard value.count == 6, let number = Int(value, radix: 16) else { return fallback }
  return NSColor(
    calibratedRed: CGFloat((number >> 16) & 0xff) / 255,
    green: CGFloat((number >> 8) & 0xff) / 255,
    blue: CGFloat(number & 0xff) / 255,
    alpha: 1
  )
}

let outputURL = URL(fileURLWithPath: CommandLine.arguments[1])
let textURL = URL(fileURLWithPath: CommandLine.arguments[4])
let styleURL = URL(fileURLWithPath: CommandLine.arguments[5])
let text = try String(contentsOf: textURL, encoding: .utf8)
let style = try JSONDecoder().decode(TitleCardStyle.self, from: Data(contentsOf: styleURL))
let size = NSSize(width: width, height: height)
let image = NSImage(size: size)

image.lockFocus()
color(style.backgroundColor, fallback: NSColor(calibratedRed: 0.035, green: 0.043, blue: 0.055, alpha: 1)).setFill()
NSBezierPath(rect: NSRect(origin: .zero, size: size)).fill()

let lines = text.split(separator: "\n", omittingEmptySubsequences: true).map(String.init)
let inset = width * 0.11
let availableWidth = width - inset * 2
let paragraph = NSMutableParagraphStyle()
paragraph.alignment = style.alignment == "left" ? .left : .center
paragraph.lineSpacing = max(8, height * 0.008)
let scale = style.titleScale == "compact" ? 0.82 : style.titleScale == "large" ? 1.18 : 1.0

func block(_ value: String, size: Double, weight: NSFont.Weight, color: NSColor) -> (NSAttributedString, NSRect) {
  let font = NSFont(name: "PingFang SC", size: size) ?? NSFont.systemFont(ofSize: size, weight: weight)
  let attributed = NSAttributedString(string: value, attributes: [
    .font: font,
    .foregroundColor: color,
    .paragraphStyle: paragraph
  ])
  let bounds = attributed.boundingRect(
    with: NSSize(width: availableWidth, height: height * 0.45),
    options: [.usesLineFragmentOrigin, .usesFontLeading]
  )
  return (attributed, bounds)
}

let specs: [(Double, NSFont.Weight, NSColor)] = [
  (min(72, width * 0.095) * scale, .bold, color(style.titleColor, fallback: NSColor(calibratedRed: 0.86, green: 0.19, blue: 0.16, alpha: 1))),
  (min(38, width * 0.052) * scale, .medium, color(style.bodyColor, fallback: NSColor(calibratedWhite: 0.96, alpha: 1))),
  (min(28, width * 0.036) * scale, .regular, color(style.captionColor, fallback: NSColor(calibratedWhite: 0.65, alpha: 1)))
]
let blocks = lines.prefix(3).enumerated().map { index, value in
  let spec = specs[min(index, specs.count - 1)]
  return block(value, size: spec.0, weight: spec.1, color: spec.2)
}
let gap = height * 0.035
let totalHeight = blocks.reduce(0) { $0 + $1.1.height } + gap * Double(max(0, blocks.count - 1))
var cursor = (height - totalHeight) / 2
for (attributed, bounds) in blocks.reversed() {
  attributed.draw(
    with: NSRect(x: inset, y: cursor, width: availableWidth, height: bounds.height),
    options: [.usesLineFragmentOrigin, .usesFontLeading]
  )
  cursor += bounds.height + gap
}
image.unlockFocus()

guard let tiff = image.tiffRepresentation,
      let bitmap = NSBitmapImageRep(data: tiff),
      let png = bitmap.representation(using: .png, properties: [:]) else {
  fputs("failed to encode title card PNG\n", stderr)
  exit(1)
}
try png.write(to: outputURL)
