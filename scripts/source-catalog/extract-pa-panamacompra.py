#!/usr/bin/env python3
"""
extract-pa-panamacompra.py — SOURCES-PA-CLOSE-1.

Junta por RUC lo que publica PanamaCompraEnCifras (DGCP, datos públicos de la Ley 22
de contratación) para el ETL de Panamá (`run-pa-sources-etl.ts`):

  * Actos adjudicados (`BusquedaPorEstado?Estado=4`, 2022-2026) y órdenes de
    Convenio Marco (`Estado=11`, 2024-2026): monto, número de actos, entidades
    distintas y último año, por RUC del proveedor.
  * El buscador de proveedores (`BusquedaProveedor`): razón social, nombre
    comercial, marca AMPYME y SÓLO el dominio del correo registrado (el bajador
    nunca guarda el correo, el nombre ni el teléfono del representante legal).
  * Lo adjudicado por familia UNSPSC (4 dígitos) según los datos OCDS 2022 - abril
    2024 (data.open-contracting.org, publicación 120, licencia PDDL), ya agregado
    por RUC en `ocds_by_ruc.json`.
  * Las entidades compradoras (`BusquedaEntidad`) con su RUC de entidad pública.

Entradas (en --dir): api/estado4_<año>.jsonl, api/estado11_<año>.jsonl,
api/proveedores.jsonl, ocds_by_ruc.json, ent_all.json y, si existe,
pa_legacy_suppliers.jsonl (lo ya cargado en pa_panamacompra_ruc_registry),
pa_convenio_domains.tsv (RUC -> dominio del correo de Convenio Marco) y
v2_suppliers.jsonl (nombre comercial del servicio v2).
Salidas (en --dir): pa_suppliers.jsonl, pa_buyers.jsonl.

Sólo lectura de archivos locales: no sale a la red ni escribe en ninguna base.
Los RUC se dejan como vienen: el ETL los valida (`parsePanamaRuc`) y descarta las
cédulas de personas naturales.
"""

import argparse
import collections
import glob
import json
import os
import re


def clean(text):
    if not isinstance(text, str):
        return None
    text = re.sub(r"\s+", " ", text).strip()
    return text or None


def ruc_key(raw):
    """Clave de unión: RUC sin espacios, sin «DV» y sin el cuarto tramo (DV)."""
    if not isinstance(raw, str):
        return None
    compact = re.sub(r"D\.?\s*V\.?", "-", raw.upper())
    compact = re.sub(r"\s+", "", compact)
    compact = re.sub(r"-{2,}", "-", compact).strip("-")
    m = re.match(r"^(\d{3,})-(\d{1,4})-(\d{1,7})(?:-\d{1,2})?$", compact)
    if m:
        tomo, folio, asiento = (str(int(part)) for part in m.groups()[:3])
        return None if len(tomo) < 3 else f"{tomo}-{folio}-{asiento}"
    m = re.match(r"^(\d{1,2})-?NT-?(\d{1,4})-(\d{1,7})(?:-\d{1,2})?$", compact)
    if m:
        return f"{int(m.group(1))}-NT-{int(m.group(2))}-{m.group(3)}"
    return None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dir", required=True)
    args = parser.parse_args()
    base = args.dir

    agg = collections.defaultdict(lambda: {
        "names": collections.Counter(), "awards": 0, "amount": 0.0, "buyers": set(), "last_year": 0,
    })
    for path in sorted(glob.glob(os.path.join(base, "api", "estado*_*.jsonl"))):
        for line in open(path, encoding="utf-8"):
            row = json.loads(line)
            key = ruc_key(row.get("proveedorAdjudicadoRuc"))
            if key is None:
                continue
            a = agg[key]
            name = clean(row.get("proveedorAdjudicadoNombre"))
            if name:
                a["names"][name] += 1
            a["awards"] += 1
            amount = row.get("montoAdjudicado")
            if isinstance(amount, (int, float)) and amount > 0:
                a["amount"] += float(amount)
            if row.get("entidadId") is not None:
                a["buyers"].add(row["entidadId"])
            year = row.get("anio")
            if isinstance(year, int) and year > a["last_year"]:
                a["last_year"] = year

    suppliers = {}
    prov_path = os.path.join(base, "api", "proveedores.jsonl")
    for line in open(prov_path, encoding="utf-8"):
        row = json.loads(line)
        key = ruc_key(row.get("ruc"))
        if key is None or "-NT-" in key:
            continue
        years = [y.get("anio") for y in (row.get("proveedorAnios") or []) if isinstance(y, dict)]
        suppliers[key] = {
            "name": clean(row.get("razonSocial")),
            "trade_name": clean(row.get("nombreComercial")),
            "ampyme": row.get("isAmpyme") if isinstance(row.get("isAmpyme"), bool) else None,
            "email_domain": clean(row.get("email_domain")),
            "years": [y for y in years if isinstance(y, int)],
        }

    # Lo ya cargado en Prod (pa_panamacompra_ruc_registry, buscador de proveedores
    # del 05-10, exportado por lectura): sólo nombre y última participación, para no
    # perder a quien el buscador ya traía si hoy no responde.
    legacy_path = os.path.join(base, "pa_legacy_suppliers.jsonl")
    if os.path.exists(legacy_path):
        for line in open(legacy_path, encoding="utf-8"):
            row = json.loads(line)
            key = ruc_key(row.get("ruc"))
            if key is None or "-NT-" in key:
                continue
            last = row.get("last_process") or ""
            entry = suppliers.setdefault(key, {"name": None, "trade_name": None, "ampyme": None, "email_domain": None, "years": []})
            if entry["name"] is None:
                entry["name"] = clean(row.get("name"))
            if re.match(r"^\d{4}", last):
                entry["years"].append(int(last[:4]))

    # Dominio del correo de las proveedoras de Convenio Marco ya cargadas en Prod
    # (pa_panamacompra_convenio, exportado por lectura SÓLO como RUC -> dominio).
    domains_path = os.path.join(base, "pa_convenio_domains.tsv")
    if os.path.exists(domains_path):
        for line in open(domains_path, encoding="utf-8"):
            parts = line.rstrip("\n").split("\t")
            key = ruc_key(parts[0]) if len(parts) == 2 else None
            if key is None or "-NT-" in key:
                continue
            entry = suppliers.setdefault(key, {"name": None, "trade_name": None, "ampyme": None, "email_domain": None, "years": []})
            if entry["email_domain"] is None:
                entry["email_domain"] = clean(parts[1])

    # Nombre comercial («additionalIdentifiers») del servicio v2 de PanamaCompraEnCifras.
    v2_path = os.path.join(base, "v2_suppliers.jsonl")
    if os.path.exists(v2_path):
        for line in open(v2_path, encoding="utf-8"):
            row = json.loads(line)
            key = ruc_key(row.get("ruc"))
            if key is None or "-NT-" in key:
                continue
            entry = suppliers.setdefault(key, {"name": None, "trade_name": None, "ampyme": None, "email_domain": None, "years": []})
            if entry["name"] is None:
                entry["name"] = clean(row.get("name"))
            trade = [clean(t) for t in (row.get("trade_names") or []) if clean(t)]
            trade = [t for t in trade if t != entry["name"]]
            if entry["trade_name"] is None and trade:
                entry["trade_name"] = trade[0]
            last = row.get("last_process") or ""
            if re.match(r"^\d{4}", last):
                entry["years"].append(int(last[:4]))

    ocds = json.load(open(os.path.join(base, "ocds_by_ruc.json"), encoding="utf-8"))
    ocds_by_key = {}
    for raw, value in ocds.items():
        key = ruc_key(raw)
        if key is not None:
            ocds_by_key[key] = value

    keys = set(agg) | set(suppliers) | set(ocds_by_key)
    written = 0
    with open(os.path.join(base, "pa_suppliers.jsonl"), "w", encoding="utf-8") as out:
        for key in sorted(keys):
            if "-NT-" in key:
                continue
            a = agg.get(key)
            s = suppliers.get(key, {})
            o = ocds_by_key.get(key)
            names = []
            if a:
                names.extend(n for n, _ in a["names"].most_common(5))
            if o and o.get("name"):
                names.append(clean(o["name"]))
            name = s.get("name") or (names[0] if names else None)
            if name is None:
                continue
            years = list(s.get("years") or [])
            if a and a["last_year"]:
                years.append(a["last_year"])
            out.write(json.dumps({
                "ruc": key,
                "name": name,
                "names": sorted({n for n in names if n and n != name}),
                "trade_name": s.get("trade_name"),
                "ampyme": s.get("ampyme"),
                "email_domain": s.get("email_domain"),
                "awards": a["awards"] if a else 0,
                "awarded_pab": round(a["amount"], 2) if a else 0,
                "buyers": len(a["buyers"]) if a else 0,
                "last_year": max(years) if years else None,
                "fam": {k: round(v, 2) for k, v in (o.get("fam") or {}).items()} if o else {},
            }, ensure_ascii=False) + "\n")
            written += 1

    entities = json.load(open(os.path.join(base, "ent_all.json"), encoding="utf-8"))
    if isinstance(entities, dict):
        entities = next(v for v in entities.values() if isinstance(v, list))
    buyers = 0
    with open(os.path.join(base, "pa_buyers.jsonl"), "w", encoding="utf-8") as out:
        for row in entities:
            key = ruc_key(row.get("ruc"))
            if key is None:
                continue
            out.write(json.dumps({
                "ruc": key,
                "name": clean(row.get("nameEntity")),
                "area": clean(row.get("nameArea")),
                "region": clean(row.get("direccion")),
            }, ensure_ascii=False) + "\n")
            buyers += 1
    print(json.dumps({"suppliers": written, "buyers": buyers, "award_rucs": len(agg), "ocds_rucs": len(ocds_by_key)}))


if __name__ == "__main__":
    main()
