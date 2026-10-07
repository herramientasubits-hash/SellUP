#!/usr/bin/env python3
"""
CR — resumen de SICOP para el directorio gratuito de Costa Rica (SOURCES-CR-CLOSE-1).

Lee los archivos oficiales y gratuitos de Hacienda en datos.go.cr (licencia CC-BY):
  --ofertas=<xlsx|csv>[,<xlsx|csv>...]  «Ofertas anuales» 2022, 2023 y 2024
                                         (CEDULA_INSTITUCION, INSTITUCION, CEDULA_PROVEEDOR,
                                         FECHA_PRESENTA_OFERTA, CODIGO_PRODUCTO,
                                         CANTIDAD_OFERTADA, PRECIO_UNITARIO_OFERTADO,
                                         TIPO_MONEDA, TIPO_CAMBIO_CRC).
  --solicitudes=<xlsx|csv>              «Solicitudes de contratación» 2022-2024
                                         (CEDULA_INSTITUCION, INSTITUCION).

Escribe (JSON por línea):
  --out-suppliers=<jsonl>  {"cedula", "fam": {familia UNSPSC 4 dígitos: monto CRC},
                            "buyers", "offers", "last_year"}
  --out-institutions=<jsonl> {"cedula", "name", "requests"}

Sólo lee archivos locales; no sale a la red; no lee ni escribe personas (la cédula
del proveedor de una persona física queda fuera: sólo 10 dígitos que empiezan por
2, 3 o 4).

datos.go.cr exige un User-Agent de navegador y a veces responde 522: descargar a
mano o con curl y reintentar.
"""

import argparse
import csv
import json
import re
from collections import defaultdict

JURIDICAL = re.compile(r"^[234]\d{9}$")


def rows(path):
    if path.lower().endswith(".csv"):
        with open(path, newline="", encoding="utf-8") as fh:
            yield from csv.DictReader(fh)
        return
    import openpyxl  # sólo si hace falta leer el XLSX original

    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb.worksheets[0]
    it = ws.iter_rows(values_only=True)
    header = [str(h) if h is not None else "" for h in next(it)]
    for values in it:
        yield {header[i]: ("" if v is None else v) for i, v in enumerate(values) if i < len(header)}


def num(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def digits(value):
    return re.sub(r"\D", "", str(value or ""))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ofertas", required=True)
    ap.add_argument("--solicitudes")
    ap.add_argument("--out-suppliers", required=True)
    ap.add_argument("--out-institutions")
    a = ap.parse_args()

    fam = defaultdict(lambda: defaultdict(float))
    buyers = defaultdict(set)
    offers = defaultdict(int)
    last_year = defaultdict(int)
    institutions = {}
    requests = defaultdict(int)

    for path in a.ofertas.split(","):
        for r in rows(path):
            inst = digits(r.get("CEDULA_INSTITUCION"))
            if JURIDICAL.match(inst):
                institutions.setdefault(inst, str(r.get("INSTITUCION") or "").strip())
            ced = digits(r.get("CEDULA_PROVEEDOR"))
            if not JURIDICAL.match(ced):
                continue
            offers[ced] += 1
            if inst:
                buyers[ced].add(inst)
            m = re.search(r"(\d{4})\s*$", str(r.get("FECHA_PRESENTA_OFERTA") or "").split(" ")[0])
            if m:
                last_year[ced] = max(last_year[ced], int(m.group(1)))
            code = digits(r.get("CODIGO_PRODUCTO"))
            if len(code) < 4:
                continue
            amount = num(r.get("CANTIDAD_OFERTADA")) * num(r.get("PRECIO_UNITARIO_OFERTADO"))
            if str(r.get("TIPO_MONEDA") or "").strip().upper() not in ("", "CRC"):
                amount *= num(r.get("TIPO_CAMBIO_CRC")) or 1.0
            if amount > 0:
                fam[ced][code[:4]] += amount

    if a.solicitudes:
        for r in rows(a.solicitudes):
            inst = digits(r.get("CEDULA_INSTITUCION"))
            if not JURIDICAL.match(inst):
                continue
            institutions.setdefault(inst, str(r.get("INSTITUCION") or "").strip())
            requests[inst] += 1

    with open(a.out_suppliers, "w", encoding="utf-8") as out:
        for ced in sorted(offers):
            out.write(
                json.dumps(
                    {
                        "cedula": ced,
                        "fam": {k: round(v, 2) for k, v in sorted(fam[ced].items())},
                        "buyers": len(buyers[ced]),
                        "offers": offers[ced],
                        "last_year": last_year[ced] or None,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    if a.out_institutions:
        with open(a.out_institutions, "w", encoding="utf-8") as out:
            for ced in sorted(institutions):
                out.write(
                    json.dumps({"cedula": ced, "name": institutions[ced], "requests": requests[ced]}, ensure_ascii=False)
                    + "\n"
                )
    print(f"proveedores={len(offers)} instituciones={len(institutions)}")


if __name__ == "__main__":
    main()
