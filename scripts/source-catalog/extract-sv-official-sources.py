#!/usr/bin/env python3
"""
SOURCES-SV-CLOSE-1 — extractor de las fuentes oficiales de El Salvador.

Lee ficheros LOCALES ya descargados (este script no sale a la red) y escribe tres
JSONL que consume `run-sv-sources-etl.ts`:

  sv_tax_lists.jsonl     una fila por NIT de cada listado de Hacienda
  sv_transparencia.jsonl una fila por institución del Portal de Transparencia
  sv_comprasal_awards.jsonl una fila por adjudicación pública de COMPRASAL

Entradas:

  --text-dir   textos por FILA VISUAL de los PDF (`sv-pdf-text.swift`), con estos nombres:
     dgii-grandes-2019.txt          Grandes Contribuyentes DGII al 15-01-2019
                                    (web.archive.org/web/20190923155602id_/https://www.mh.gob.sv/
                                     downloads/pdf/700-DGII-AV-2018-20963.pdf)
     hacienda-grandes-2012.txt      PMHDC9235 (Grandes Contribuyentes al 31-07-2012)
     hacienda-medianos-2012.txt     PMHDC9236 (Medianos Contribuyentes al 31-07-2012)
     hacienda-zonas-francas-2014.txt PMHDC9227 (usuarias de Zonas Francas, DPA y Servicios
                                    Internacionales, 09-2014)
     hacienda-entidades-2014.txt    PMHDC9225 (Gobierno Central, autónomas y hospitales, 11-2014)
     hacienda-alcaldias-2014.txt    PMHDC9230 (262 alcaldías municipales, 09-2014)
     (www.mh.gob.sv/wp-content/uploads/2020/11/PMHDC92xx.pdf)
  --transparencia-dir  institucionesCategoriaJSON.php?id_tipo=N guardado como t<N>.json
  --comprasal-dir      páginas de /api/v1/publico/obtener/procesos/publicos guardadas como
                       pages/NNNN.jsonl (sólo id, proveedor, monto, fecha, proceso, institución)

Datos personales: del Portal de Transparencia NO se guarda el nombre del oficial de
información (sólo el DOMINIO de su correo). De COMPRASAL nunca se leen accionistas ni
beneficiarios. Los listados de Hacienda traen personas naturales: el extractor las
copia tal cual a su salida LOCAL y el ETL las descarta antes de escribir.

Uso: python3 -I scripts/source-catalog/extract-sv-official-sources.py \
       --text-dir=… --transparencia-dir=… --comprasal-dir=… --out-dir=…
"""

import glob
import json
import os
import re
import sys

NIT_DIGITS = re.compile(r"^\d{14}$")
NIT_DASHED = re.compile(r"\b(\d{4}-\d{6}-\d{3}-\d)\b")
# «1,033 06142410901022 | NOMBRE», «36 | 0614-… | NOMBRE», «0614-… | NOMBRE».
ROW = re.compile(r"^(?:(?P<n>[\d,]+)\s*\|?\s*)?(?P<nit>\d{14}|\d{4}-\d{6}-\d{3}-\d)\s*\|\s*(?P<rest>.+)$")

TAX_LISTS = [
    ("dgii-grandes-2019.txt", "dgii_large_2019", 2019),
    ("hacienda-grandes-2012.txt", "hacienda_large_2012", 2012),
    ("hacienda-medianos-2012.txt", "hacienda_medium_2012", 2012),
    ("hacienda-zonas-francas-2014.txt", "hacienda_free_zone_2014", 2014),
    ("hacienda-entidades-2014.txt", "hacienda_public_2014", 2014),
    ("hacienda-alcaldias-2014.txt", "hacienda_municipality_2014", 2014),
]

LINK_END = re.compile(r"\b(de|del|la|las|los|el|y|e|en|para|por|a|al|con)$", re.I)


def arg(name, required=True):
    for a in sys.argv[1:]:
        if a.startswith(f"--{name}="):
            return a.split("=", 1)[1]
    if required:
        sys.exit(f"falta --{name}=")
    return None


def clean(text):
    return re.sub(r"\s+", " ", (text or "").replace(" ", " ")).strip()


def digits(nit):
    return nit.replace("-", "")


def regime_of(line, current):
    upper = line.upper()
    if "USUARIOS DE ZONAS FRANCAS" in upper:
        return "zona_franca"
    if "PERFECCIONAMIENTO ACTIVO" in upper:
        return "dpa"
    if "SERVICIOS INTERNACIONALES" in upper:
        return "servicios_internacionales"
    return current


PUBLIC_SECTIONS = [
    ("GOBIERNO CENTRAL", "gobierno_central"),
    ("INSTITUCIONES AUTONOMAS", "autonoma"),
    ("HOSPITALES NACIONALES", "hospital"),
    # Las cuentas de «fondos de actividades especiales» no son entidades: aquí se para.
    ("FONDOS DE ACTIVIDADES ESPECIALES", None),
]


def unbalanced(name):
    return name.count("(") > name.count(")") or name.count('"') % 2 == 1


def parse_public_entities(lines):
    """PMHDC9225: entidad con número, dependencias sin número debajo de su ministerio."""
    out, section, parent, pending_row = [], None, None, None
    for raw in lines:
        line = clean(raw)
        upper = line.upper()
        hit = next((s for s in PUBLIC_SECTIONS if upper.startswith(s[0])), None)
        if hit is not None:
            section = hit[1]
            if section is None:
                break
            continue
        if section is None or not line or line.startswith("=====") or upper.startswith(("FUENTE", "NO ", "NO.", "N°", "Nº")):
            continue
        # «18» solo en su línea: el número es de la fila con NIT que viene debajo.
        if re.fullmatch(r"\d{1,3}", line):
            pending_row = int(line)
            continue
        m = ROW.match(line)
        if m:
            name = clean(m.group("rest"))
            row_number = int(m.group("n").replace(",", "")) if m.group("n") else pending_row
            pending_row = None
            numbered = row_number is not None
            record = {"nit": digits(m.group("nit")), "name": name, "section": section, "row": row_number}
            if numbered:
                parent = name
            elif parent is not None and section == "gobierno_central":
                record["parent"] = parent
            out.append(record)
            continue
        # Nombre partido en dos líneas: sigue en minúscula, abre con «(», o la línea
        # anterior dejó un paréntesis/comilla abierto o terminó en una palabra de enlace.
        if out and (line[:1].islower() or line.startswith("(") or unbalanced(out[-1]["name"]) or LINK_END.search(out[-1]["name"])):
            out[-1]["name"] = clean(out[-1]["name"] + " " + line)
            if out[-1].get("row") is not None:
                parent = out[-1]["name"]
    return out


def parse_tax_list(path, list_key, year):
    with open(path, encoding="utf-8") as fh:
        lines = fh.read().split("\n")
    if list_key == "hacienda_public_2014":
        rows = parse_public_entities(lines)
    else:
        rows, regime = [], None
        for raw in lines:
            line = clean(raw)
            regime = regime_of(line, regime)
            m = ROW.match(line)
            if not m:
                continue
            rest = [clean(p) for p in m.group("rest").split("|")]
            record = {"nit": digits(m.group("nit")), "row": int(m.group("n").replace(",", "")) if m.group("n") else None}
            if list_key == "hacienda_municipality_2014":
                if len(rest) < 2:
                    continue
                record.update({"name": f"Alcaldía Municipal de {rest[0]}", "municipality": rest[0], "department": rest[1]})
            else:
                record["name"] = clean(" ".join(rest)).strip(' "').rstrip(",").strip()
                if list_key == "hacienda_free_zone_2014":
                    record["regime"] = regime
            rows.append(record)
    for record in rows:
        record.update({"list": list_key, "year": year})
    return [r for r in rows if NIT_DIGITS.match(r["nit"]) and r.get("name")]


def email_domain(email):
    m = re.search(r"@([A-Za-z0-9.-]+\.[A-Za-z]{2,})", email or "")
    return m.group(1).lower() if m else None


def read_transparencia(folder):
    out = []
    for path in sorted(glob.glob(os.path.join(folder, "t*.json"))):
        m = re.search(r"t(\d+)\.json$", path)
        if not m:
            continue
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
        items = data.get("data", []) if isinstance(data, dict) else data
        for item in items if isinstance(items, list) else []:
            if not isinstance(item, dict) or not clean(item.get("nombre_institucion")):
                continue
            out.append(
                {
                    "category_id": int(m.group(1)),
                    "id": item.get("id_institucion"),
                    "acronym": clean(item.get("acronym")) or None,
                    "name": clean(item.get("nombre_institucion")),
                    # Sólo el dominio: el correo y el nombre del oficial son datos personales.
                    "email_domain": email_domain(item.get("officer_email")),
                    "site_url": clean(item.get("external_transparency_site_url")) or None,
                }
            )
    return out


def read_comprasal(folder):
    seen, out = set(), []
    for path in sorted(glob.glob(os.path.join(folder, "pages", "*.jsonl"))):
        with open(path, encoding="utf-8") as fh:
            for line in fh:
                if not line.strip():
                    continue
                a = json.loads(line)
                if a.get("id") in seen or a.get("sid") is None or not clean(a.get("name")):
                    continue
                seen.add(a.get("id"))
                monto = a.get("monto")
                out.append(
                    {
                        "id": a.get("id"),
                        "sid": a.get("sid"),
                        "name": clean(a.get("name")),
                        "trade": clean(a.get("trade")) or None,
                        "amount_usd": float(monto) if isinstance(monto, (int, float)) else None,
                        "date": (a.get("date") or "")[:10] or None,
                        "process": clean(a.get("proc")) or None,
                        "institution": clean(a.get("inst")) or None,
                        "institution_code": a.get("inst_code"),
                    }
                )
    return out


def write_jsonl(path, rows):
    with open(path, "w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def main():
    text_dir, out_dir = arg("text-dir"), arg("out-dir")
    os.makedirs(out_dir, exist_ok=True)
    tax = []
    for filename, list_key, year in TAX_LISTS:
        path = os.path.join(text_dir, filename)
        if not os.path.exists(path):
            sys.exit(f"no existe {path}")
        rows = parse_tax_list(path, list_key, year)
        print(f"  {list_key}: {len(rows)} filas")
        tax.extend(rows)
    write_jsonl(os.path.join(out_dir, "sv_tax_lists.jsonl"), tax)

    transparencia = read_transparencia(arg("transparencia-dir"))
    print(f"  transparencia: {len(transparencia)} instituciones")
    write_jsonl(os.path.join(out_dir, "sv_transparencia.jsonl"), transparencia)

    comprasal_dir = arg("comprasal-dir", required=False)
    awards = read_comprasal(comprasal_dir) if comprasal_dir else []
    print(f"  comprasal: {len(awards)} adjudicaciones")
    write_jsonl(os.path.join(out_dir, "sv_comprasal_awards.jsonl"), awards)


if __name__ == "__main__":
    main()
