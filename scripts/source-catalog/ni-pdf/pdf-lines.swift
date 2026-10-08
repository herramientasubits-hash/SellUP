// SOURCES-NI-CLOSE-2 — líneas de texto de un PDF con su posición (macOS PDFKit).
// Salida TSV: página, x, y (origen abajo a la izquierda), texto.
// Uso: swift scripts/source-catalog/ni-pdf/pdf-lines.swift archivo.pdf > lineas.tsv
import Foundation
import PDFKit

guard CommandLine.arguments.count > 1, let doc = PDFDocument(url: URL(fileURLWithPath: CommandLine.arguments[1])) else {
  FileHandle.standardError.write("uso: pdf-lines.swift archivo.pdf\n".data(using: .utf8)!)
  exit(1)
}
if doc.isLocked { _ = doc.unlock(withPassword: "") }
for index in 0..<doc.pageCount {
  guard let page = doc.page(at: index), let all = page.selection(for: page.bounds(for: .mediaBox)) else { continue }
  for line in all.selectionsByLine() {
    let text = (line.string ?? "").replacingOccurrences(of: "\t", with: " ").trimmingCharacters(in: .whitespacesAndNewlines)
    if text.isEmpty { continue }
    let box = line.bounds(for: page)
    print("\(index + 1)\t\(Int(box.minX))\t\(Int(box.maxY))\t\(text)")
  }
}
