#!/usr/bin/env python3
"""
extract-uy-ocds-suppliers.py — proveedores adjudicados del Estado uruguayo
(ARCE, datos abiertos OCDS) agregados por RUT. SOURCES-UY-CLOSE-1.

Lee los zips anuales «ocds-AAAA.zip» (catalogodatos.gub.uy, conjunto
«arce-datos-historicos-de-compras», licencia de datos abiertos del Estado) y el
catálogo de artículos del SICE (imp_catalogo.tgz: ART_SERV_OBRA.sql,
SUBFAMILIA.sql). No llama a ningún servicio: sólo archivos locales.

Salida (JSON Lines, una línea por RUT de 12 dígitos):
  {"rut", "name", "years": {"2024": usd, …}, "awards", "buyers", "amount_usd",
   "classes": [[fami, subf, clase, usd], …] (de mayor a menor)}
y un segundo archivo con los organismos compradores {"id", "name", "awards"}.

El monto es cantidad × precio unitario de cada ítem adjudicado (el OCDS de ARCE
deja `awards[].value` vacío), convertido a dólares con cambios FIJOS y
aproximados (sólo para ordenar por relevancia, no es contabilidad).

Uso:
  python3 -I extract-uy-ocds-suppliers.py --catalog=<dir con *.sql> \
      --out=<suppliers.jsonl> --buyers-out=<buyers.jsonl> ocds-2022.zip …
"""

import argparse
import json
import re
import sys
import zipfile
from collections import defaultdict

# Cambios fijos aproximados a dólares (promedio 2022-2025). UI = unidad indexada.
USD_PER = {"USD": 1.0, "UYU": 1 / 40.0, "EUR": 1.08, "UYI": 6.0 / 40.0, "UI": 6.0 / 40.0, "UR": 1700 / 40.0}

RUT_ID = re.compile(r"^R/?(\d{12})$")
ART_ROW = re.compile(r"values \((\d+),'(?:[^']|'')*',(\d+),(\d+),(\d+),")


def load_article_families(catalog_dir: str) -> dict:
    """Código de artículo → (familia, subfamilia, clase)."""
    families = {}
    with open(f"{catalog_dir}/ART_SERV_OBRA.sql", encoding="latin-1") as handle:
        for line in handle:
            match = ART_ROW.search(line)
            if match:
                families[match.group(1)] = (int(match.group(2)), int(match.group(3)), int(match.group(4)))
    return families


def item_amount_usd(item: dict) -> float:
    value = ((item.get("unit") or {}).get("value") or {})
    amount = value.get("amount")
    quantity = item.get("quantity")
    rate = USD_PER.get(str(value.get("currency") or "").upper())
    if not isinstance(amount, (int, float)) or not isinstance(quantity, (int, float)) or rate is None:
        return 0.0
    total = float(amount) * float(quantity) * rate
    # Un ítem de más de 500 millones de dólares es un error de carga: no cuenta.
    return total if 0 < total < 5e8 else 0.0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--catalog", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--buyers-out", required=True)
    parser.add_argument("zips", nargs="+")
    args = parser.parse_args()

    families = load_article_families(args.catalog)
    suppliers = defaultdict(lambda: {"name": None, "name_date": "", "years": defaultdict(float), "awards": set(),
                                     "buyers": set(), "classes": defaultdict(float)})
    buyers = defaultdict(lambda: {"name": None, "awards": 0})

    for path in args.zips:
        archive = zipfile.ZipFile(path)
        for member in sorted(archive.namelist()):
            if not re.search(r"(^|/)a-\d\d-\d{4}\.json$", member):
                continue
            releases = json.load(archive.open(member)).get("releases") or []
            for release in releases:
                date = str(release.get("date") or "")
                year = date[:4]
                buyer = release.get("buyer") or {}
                buyer_id = str(buyer.get("id") or "")
                if buyer_id:
                    buyers[buyer_id]["name"] = buyer.get("name") or buyers[buyer_id]["name"]
                    buyers[buyer_id]["awards"] += 1
                for award in release.get("awards") or []:
                    if str(award.get("status") or "active") not in ("active", ""):
                        continue
                    for supplier in award.get("suppliers") or []:
                        match = RUT_ID.match(str(supplier.get("id") or ""))
                        if not match:
                            continue
                        record = suppliers[match.group(1)]
                        if supplier.get("name") and date >= record["name_date"]:
                            record["name"], record["name_date"] = supplier["name"], date
                        record["awards"].add(str(release.get("ocid") or release.get("id")))
                        if buyer_id:
                            record["buyers"].add(buyer_id)
                        for item in award.get("items") or []:
                            usd = item_amount_usd(item)
                            record["years"][year] += usd
                            code = str((item.get("classification") or {}).get("id") or "")
                            family = families.get(code)
                            if family is not None:
                                record["classes"][family] += usd
        print(f"{path}: {len(suppliers)} proveedores acumulados", file=sys.stderr)

    with open(args.out, "w", encoding="utf-8") as out:
        for rut, record in sorted(suppliers.items()):
            classes = sorted(record["classes"].items(), key=lambda kv: -kv[1])
            out.write(json.dumps({
                "rut": rut,
                "name": record["name"],
                "years": {year: round(usd) for year, usd in sorted(record["years"].items())},
                "awards": len(record["awards"]),
                "buyers": len(record["buyers"]),
                "amount_usd": round(sum(record["years"].values())),
                "classes": [[fami, subf, clase, round(usd)] for (fami, subf, clase), usd in classes],
            }, ensure_ascii=False) + "\n")
    with open(args.buyers_out, "w", encoding="utf-8") as out:
        for buyer_id, record in sorted(buyers.items()):
            out.write(json.dumps({"id": buyer_id, **record}, ensure_ascii=False) + "\n")
    print(f"proveedores: {len(suppliers)}; compradores: {len(buyers)}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
