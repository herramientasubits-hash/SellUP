#!/usr/bin/env python3
"""
extract-pa-dgi-large-taxpayers.py — SOURCES-PA-CLOSE-1.

Lista de Grandes Contribuyentes de la DGI de Panamá (Resolución 201-3486 de
17-04-2025, Gaceta Oficial 30271-A del 06-05-2025; ingresos >= B/.20 millones Y
activos >= B/.60 millones en 2023) -> pa_large_taxpayers.jsonl para
`run-pa-sources-etl.ts`.

El PDF de la DGI (https://dgi.mef.gob.pa/Graco/graco-Norma.php) es ESCANEADO, sin
texto: se lee con el OCR de macOS (Vision), sin servicios externos.

  * Páginas 6 a 13 = «2. LISTADO DE GRANDES CONTRIBUYENTES 2025» (298 filas).
    Las páginas 14 a 19 son «3. LISTADO DE CONTRIBUYENTES A LOS QUE SE REVOCA LA
    CATEGORÍA»: NUNCA se leen (no son grandes).
  * Un RUC sólo entra si al menos DOS lecturas independientes de la columna (con
    distinta ampliación) lo leen igual. El nombre sale de la lectura de la columna
    del nombre, a la misma altura.
  * Correcciones de lectura: «5 A» -> «S A», «S A» pegado («KADIMAS A»), número de
    fila pegado delante, y una tabla a mano para los nombres que el OCR destrozó
    (el RUC de esas filas sí está confirmado por dos lecturas).
  * Fuera: la fila del FIDEICOMISO VERSALLES (RUC de entidad, no es una empresa).

Uso (macOS):
  swiftc -O scripts/source-catalog/pa-ocr/render-pdf-pages.swift -o /tmp/pa-render
  swiftc -O scripts/source-catalog/pa-ocr/ocr-column.swift -o /tmp/pa-ocr-column
  /tmp/pa-render <resolucion.pdf> <dir>/p          # p1.png … p20.png
  python3 scripts/source-catalog/extract-pa-dgi-large-taxpayers.py \
      --pages=<dir> --ocr-column=/tmp/pa-ocr-column --out=<dir>/pa_large_taxpayers.jsonl \
      [--words=<pa_suppliers.jsonl>]   # palabras de PanamaCompra para despegar «XS A»

Sólo lee y escribe archivos locales: no sale a la red ni escribe en ninguna base.
"""

import argparse
import collections
import json
import os
import re
import subprocess
import unicodedata

LIST_PAGES = range(6, 14)
RUC = re.compile(r"(\d{1,9})\s?-\s?(\d{1,4}|4D)\s?-\s?(\d{1,7})")

# Nombres que el OCR destrozó; el RUC está confirmado por dos lecturas.
NAME_FIXES = {
    "1485831-1-644680": "BBP BANK S A",
    "155661286-2-2018": "FARMACAM, S.A.",
    "1058454-1-549254": "LONDON & REGIONAL PANAMA S A",
    "1422698-1-1095": "3M PANAMA PACIFICO S DE R L",
    "155602452-2-2015": "SKECHERS LATIN AMERICA LLC",
    "2403790-1-2258": "COMPAÑIA UNIVERSAL DE PERFUMERIA FRANCESA (CUPFSA) S DE RL",
    "155648085-2-2017": "LIEBHERR PANAMA S.A.",
    "2679372-1-844914": "DELIVERY HERO PANAMA (E-COMMERCE) S.A.",
    "32330-72-247193": "METROBANK S A",
    "37405-45-267330": "CREDICORP BANK S A",
    "39-35-5021": "CITIBANK N A",
    "25680-2-219880": "CENTRO TEXTIL INTERNACIONAL ZL S A",
    "297-154-64691": "REFINERIA PANAMA S DE RL",
    "2318210-1-792556": "UEP PENONOME II S A",
    "407361-1-425412": "BCT BANK INTERNATIONAL S A",
    "722-40-141442": "SONY INTER AMERICAN SA",
    "1722702-1-1624": "IBT, LLC.",
    "57983-20-340437": "AES PANAMA, S.R.L.",
}

# Filas que la lectura por columnas no separa bien; confirmadas por la lectura de
# líneas de la página (dos lecturas) — el «D» de «722-4D-…» es un 0.
EXTRA_ROWS = {"722-40-141442", "1722702-1-1624"}


def ascii_upper(text):
    return unicodedata.normalize("NFD", text).encode("ascii", "ignore").decode().upper()


def ocr(binary, png, x0, x1, scale):
    out = subprocess.run([binary, png, str(x0), str(x1), str(scale)], check=True, capture_output=True).stdout
    return json.loads(out)


def rucs_in(observations):
    found = []
    for o in observations:
        y = o["y"] + o["h"] / 2
        if not 0.06 < y < 0.86:
            continue
        for m in RUC.finditer(o["t"]):
            folio = "40" if m.group(2) == "4D" else m.group(2)
            found.append((y, f"{m.group(1)}-{folio}-{m.group(3)}"))
    return found


def fix_name(name, words):
    n = re.sub(r"^\d{3,}\s+", "", name.strip())
    n = re.sub(r"\b5 A\b", "S A", n)
    n = re.sub(r"\s+F FUSION/CAMBIO:.*$", "", n)
    m = re.match(r"^(.*?)([A-Z]{3,})S A$", n)
    if m and not n.endswith(" S A") and (words[m.group(2)] >= 1 or words[m.group(2) + "S"] == 0):
        n = f"{m.group(1)}{m.group(2)} S A"
    m = re.match(r"^(.*?)([A-Z]{3,})SA$", n)
    if m and words[m.group(2)] >= 3 and words[m.group(2) + "SA"] == 0:
        n = f"{m.group(1)}{m.group(2)} SA"
    return n


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--pages", required=True)
    parser.add_argument("--ocr-column", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--words", default=None)
    args = parser.parse_args()

    words = collections.Counter()
    if args.words and os.path.exists(args.words):
        for line in open(args.words, encoding="utf-8"):
            row = json.loads(line)
            for name in [row.get("name")] + list(row.get("names") or []):
                for w in re.findall(r"[A-Z]{3,}", ascii_upper(name or "")):
                    words[w] += 1

    rows = {}
    for page in LIST_PAGES:
        png = os.path.join(args.pages, f"p{page}.png")
        passes = [rucs_in(ocr(args.ocr_column, png, 0.05, 0.42, scale)) for scale in (2, 2.6, 3.2)]
        names = []
        for o in ocr(args.ocr_column, png, 0.26, 0.97, 2):
            y = o["y"] + o["h"] / 2
            t = o["t"].strip()
            if 0.06 < y < 0.86 and re.search(r"[A-Za-z]{2}", t) and not t.upper().startswith(("NOMBRE", "RUC")):
                names.append((y, t))
        votes = collections.defaultdict(list)
        for found in passes:
            for y, ruc in set(found):
                votes[ruc].append(y)
        for ruc, ys in votes.items():
            if len(ys) < 2 and ruc not in EXTRA_ROWS:
                continue
            y = sum(ys) / len(ys)
            near = min(names, key=lambda n: abs(n[0] - y)) if names else None
            name = near[1] if near and abs(near[0] - y) < 0.006 else None
            rows[ruc] = NAME_FIXES.get(ruc) or (fix_name(name, words) if name else None)

    for ruc in EXTRA_ROWS:
        rows.setdefault(ruc, NAME_FIXES[ruc])

    written = 0
    with open(args.out, "w", encoding="utf-8") as out:
        for ruc in sorted(rows):
            name = rows[ruc]
            if name is None or "-NT-" in ruc or name.upper().startswith("FIDEICOMISO"):
                continue
            out.write(json.dumps({"ruc": ruc, "name": name}, ensure_ascii=False) + "\n")
            written += 1
    print(json.dumps({"large_taxpayers": written}))


if __name__ == "__main__":
    main()
