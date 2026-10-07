import Foundation
import Vision
import AppKit
import CoreImage
// uso: ocr-column <png> x0 x1 [escala=2] (fracciones del ancho); devuelve JSON con y en coordenadas de la página
let a = CommandLine.arguments
guard let img = NSImage(contentsOfFile: a[1]), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let x0 = Double(a[2])!, x1 = Double(a[3])!
let scale = a.count > 4 ? CGFloat(Double(a[4])!) : 2
let W = Double(cg.width), H = Double(cg.height)
let rect = CGRect(x: x0*W, y: 0, width: (x1-x0)*W, height: H)
let crop = cg.cropping(to: rect)!
// ampliar x2
let ci = CIImage(cgImage: crop).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
let ctx = CIContext()
let big = ctx.createCGImage(ci, from: ci.extent)!
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.usesLanguageCorrection = false
req.minimumTextHeight = 0.003
try VNImageRequestHandler(cgImage: big, options: [:]).perform([req])
var out: [[String: Any]] = []
for o in req.results ?? [] { if let t = o.topCandidates(1).first { let b = o.boundingBox; out.append(["t": t.string, "x": x0 + b.minX*(x1-x0), "y": b.minY, "w": b.width*(x1-x0), "h": b.height]) } }
FileHandle.standardOutput.write(try JSONSerialization.data(withJSONObject: out))
