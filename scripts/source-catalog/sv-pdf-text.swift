// sv-pdf-text — texto de un PDF por FILA VISUAL (PDFKit, macOS sin pdftotext).
//
// SOURCES-SV-CLOSE-1. Las tablas de Hacienda salen con `page.string` en columnas
// (todos los NIT, luego todos los nombres). Aquí cada trozo de texto se agrupa con
// los que están a la misma altura y se ordena de izquierda a derecha, separado por
// « | », así que cada fila de la tabla sale en una línea.
//
// Uso: swiftc -O sv-pdf-text.swift -o sv-pdf-text && ./sv-pdf-text entrada.pdf salida.txt
import Foundation
import PDFKit

let args = CommandLine.arguments
guard args.count >= 3, let doc = PDFDocument(url: URL(fileURLWithPath: args[1])) else {
  FileHandle.standardError.write("uso: sv-pdf-text <entrada.pdf> <salida.txt>\n".data(using: .utf8)!)
  exit(1)
}

struct Piece { let x: CGFloat; let y: CGFloat; let h: CGFloat; let text: String }

var out = ""
for i in 0..<doc.pageCount {
  out += "=====PAGE \(i + 1)\n"
  guard let page = doc.page(at: i), let all = page.selection(for: page.bounds(for: .mediaBox)) else { continue }
  var pieces: [Piece] = []
  for line in all.selectionsByLine() {
    let text = (line.string ?? "").replacingOccurrences(of: "\n", with: " ").trimmingCharacters(in: .whitespaces)
    if text.isEmpty { continue }
    let b = line.bounds(for: page)
    pieces.append(Piece(x: b.minX, y: b.midY, h: max(b.height, 1), text: text))
  }
  // De arriba abajo; una fila = trozos cuya altura media cae a menos de 40 % de la altura de letra.
  pieces.sort { $0.y > $1.y }
  var rows: [[Piece]] = []
  for p in pieces {
    if let last = rows.last, let ref = last.first, abs(ref.y - p.y) < 0.4 * min(ref.h, p.h) {
      rows[rows.count - 1].append(p)
    } else {
      rows.append([p])
    }
  }
  for row in rows {
    out += row.sorted { $0.x < $1.x }.map { $0.text }.joined(separator: " | ") + "\n"
  }
}
try out.write(toFile: args[2], atomically: true, encoding: .utf8)
