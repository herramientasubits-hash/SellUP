import Foundation
import Vision
import AppKit
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { print("noimg"); exit(1) }
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["es-ES","en-US"]
req.usesLanguageCorrection = false
try VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
var lines: [(CGFloat, CGFloat, String)] = []
for o in req.results ?? [] { if let t = o.topCandidates(1).first { lines.append((o.boundingBox.midY, o.boundingBox.minX, t.string)) } }
lines.sort { abs($0.0 - $1.0) > 0.004 ? $0.0 > $1.0 : $0.1 < $1.1 }
var row: [String] = []; var lastY: CGFloat = -1
for l in lines { if lastY >= 0 && abs(l.0 - lastY) > 0.004 { print(row.joined(separator: " | ")); row = [] }; row.append(l.2); lastY = l.0 }
print(row.joined(separator: " | "))
