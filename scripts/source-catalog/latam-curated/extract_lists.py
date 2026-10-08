#!/usr/bin/env python3
"""
LATAM — extractores de la capa común de listas curadas (SOURCES-LATAM-CURATED-1).

Cada lista pública ya descargada (curl con User-Agent de navegador) se convierte
en entradas JSONL con la forma de `LatamCuratedEntry`
(src/server/source-catalog/connectors/latam-curated/latam-curated-rows.ts):

  {"country", "list", "list_label", "year", "name", "tax_id", "tax_type",
   "website", "kind", "is_public", "sector", "size_large", "workers",
   "city", "region"}

Uso:
  python3 extract_lists.py <lista> --input=<archivo> --out=<jsonl>

Listas:
  co_snies      datos.gov.co n5yy-8nav (JSON de la API): instituciones de educación superior.
  pe_sunedu     sunedu.gob.pe «lista de universidades licenciadas» (HTML).
  ar_ssn        datosabiertos.ssn.gob.ar «entidades-activas.csv»: aseguradoras.
  cl_cmf_seguros  cmfchile.cl «descargar_consulta» de aseguradoras (CSV; varios con coma).
  ec_direx      sgrn.proecuadorb2b.com.ec DIREX «SearchResults» (HTML): exportadores.
  py_cones      carpeta con cones.gov.py/{universidades,institutos-superiores}/page/N guardadas como
                <tipo>_<N>.html: universidades e institutos habilitados (públicos si el
                nombre dice «Nacional», es militar o policial, o la web es .mil/.gov/.gob.py).
  pe_bvl        carpeta con las respuestas JSON de dataondemand.bvl.com.pe/v1/issuers/search
                (una por letra): emisores de la Bolsa de Valores de Lima, sin fondos ni ETF.
  wikidata_universities  respuesta JSON de query.wikidata.org (consulta en
                scripts/source-catalog/latam-curated/wikidata-universities.rq): universidades con
                web (CC0). Pública si Wikidata lo dice o el nombre lo indica; sin campus sueltos.
  co_ips_camas  datos.gov.co s2ru-bqt6 agregado por NIT (camas ≥ 50; consulta en el README de
                la carpeta): IPS de Colombia con su número de camas. Sin gerente, correo ni teléfono.
  statista_mx   rankings.statista.com «Mejores empleadores de México <año>» (HTML): sólo
                nombres (≥250 empleados), sin sector ⇒ suma marca de grande a lo que otra lista
                ya clasificó.
  merco         carpeta con merco.info/<pais>/ranking-merco-{empresas,talento} guardados como
                <pais>_{empresas,talento}.html (curl con cookies): ranking general + sector
                de las tablas sectoriales. Todas son empresas grandes (size_large).

Sólo lee archivos locales; no sale a la red. NO escribe teléfonos, correos,
direcciones ni nombres de personas.
"""

from __future__ import annotations

import argparse
import csv
import html
import io
import json
import re
import sys


def clean(value: object) -> str | None:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", html.unescape(str(value))).strip()
    return text or None


def strip_tags(fragment: str) -> str:
    return clean(re.sub(r"<[^>]+>", " ", fragment)) or ""


def entry(**fields: object) -> dict:
    return {key: value for key, value in fields.items() if value is not None}


def co_snies(path: str) -> list[dict]:
    rows = json.load(open(path, encoding="utf-8"))
    out = []
    for row in rows:
        if "activa" not in (row.get("estado") or "").lower():
            continue
        web = clean(row.get("p_gina_web"))
        out.append(entry(
            country="CO", list="co_snies", list_label="SNIES – MinEducación", year=2025,
            name=clean(row.get("nombre_instituci_n")),
            tax_id=clean(row.get("n_mero_identificaci_n")), tax_type="NIT",
            website=web if web and web.upper() not in {"NA", "N/A"} else None,
            kind="university",
            is_public=(row.get("sector") or "").strip().lower() == "oficial",
            sector=clean(row.get("car_cter_acad_mico")),
            city=clean(row.get("municipio_domicilio")), region=clean(row.get("departamento_domicilio")),
        ))
    return out


def pe_sunedu(path: str) -> list[dict]:
    page = open(path, encoding="utf-8", errors="ignore").read()
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page, re.S):
        cells = [strip_tags(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if len(cells) < 5 or not cells[0]:
            continue
        department, _, province = cells[3].partition("/")
        out.append(entry(
            country="PE", list="pe_sunedu", list_label="SUNEDU – universidades licenciadas", year=2026,
            name=cells[0], kind="university", is_public=cells[4].lower().startswith("pública") or cells[4].lower().startswith("publica"),
            city=clean(province), region=clean(department),
        ))
    return out


def ar_ssn(path: str) -> list[dict]:
    text = open(path, encoding="utf-8-sig", errors="ignore").read()
    out = []
    for row in csv.DictReader(io.StringIO(text)):
        if (row.get("cia_pais_id") or "").strip() not in {"", "ARG"}:
            continue
        out.append(entry(
            country="AR", list="ar_ssn", list_label="SSN – aseguradoras activas", year=2026,
            name=clean(row.get("cia_denominacion")), tax_id=clean(row.get("cia_cuit")), tax_type="CUIT",
            kind="insurer", sector=clean(row.get("cia_actividad_principal")),
        ))
    return out


def cl_cmf_seguros(paths: str) -> list[dict]:
    out = []
    for path in paths.split(","):
        text = open(path, encoding="utf-8-sig", errors="ignore").read()
        for row in csv.reader(io.StringIO(text)):
            if len(row) < 3 or not re.match(r"^\d{6,9}-[\dK]$", row[0].strip().upper()):
                continue
            if "vigente" not in row[2].lower():
                continue
            out.append(entry(
                country="CL", list="cl_cmf_seguros", list_label="CMF – aseguradoras vigentes", year=2026,
                name=clean(row[1]), tax_id=row[0].strip().upper(), tax_type="RUT", kind="insurer",
                size_large=None,
            ))
    return out


def ec_direx(path: str) -> list[dict]:
    page = open(path, encoding="utf-8", errors="ignore").read()
    out = []
    for block in re.findall(r'<div class="resultado"[^>]*>(.*?)</div>\s*</div>', page, re.S):
        name = re.search(r'class="razonsocial[^"]*">\s*Raz(?:&oacute;|ó)n Social:\s*(.*?)</p>', block, re.S)
        ruc = re.search(r"<strong>RUC:</strong>\s*(\d{13})", block)
        if not name or not ruc:
            continue
        sectors = [strip_tags(s) for s in re.findall(r'<p class="subsector">(.*?)</p>', block, re.S)]
        web = re.search(r'<a href="(https?://[^"]+)"', block)
        place = None
        for para in re.findall(r"<p\s*>(.*?)</p>", block, re.S):
            text = strip_tags(para)
            if " - " in text and text.isupper() and not text.startswith("KM"):
                place = text
                break
        city, _, region = (place or "").partition(" - ")
        out.append(entry(
            country="EC", list="ec_direx", list_label="Pro Ecuador – directorio de exportadores", year=2026,
            name=strip_tags(name.group(1)).rstrip("."), tax_id=ruc.group(1), tax_type="RUC",
            website=web.group(1) if web else None, kind="exporter",
            sector=sectors[0] if sectors else None,
            city=clean(city), region=clean(region),
        ))
    return out


def py_cones(folder: str) -> list[dict]:
    import glob
    import os

    out = []
    for path in sorted(glob.glob(os.path.join(folder, "*.html"))):
        page = open(path, encoding="utf-8", errors="ignore").read()
        for card in re.findall(r'<div class="dc-card-body">(.*?)</div>', page, re.S):
            name = re.search(r"<h3>(.*?)</h3>", card, re.S)
            if not name:
                continue
            body = strip_tags(card)
            city = re.search(r"Ciudad:\s*(.*?)\s*URL:", body)
            web = re.search(r"URL:\s*(\S+)", body)
            label = strip_tags(name.group(1))
            out.append(entry(
                country="PY", list="py_cones", list_label="CONES – educación superior habilitada", year=2026,
                name=re.split(r"\s+[–-]\s+", label)[0], website=web.group(1) if web else None,
                kind="university",
                is_public=bool(
                    re.search(r"\b(nacional|armada|militar|polic[ií]a|ej[eé]rcito|fuerza a[eé]rea|naval)", label, re.I)
                    or re.search(r"\.(mil|gov|gob)\.py", web.group(1) if web else "")
                ),
                city=clean(city.group(1)) if city else None,
            ))
    return out


def pe_bvl(folder: str) -> list[dict]:
    import glob
    import os

    skip = {"fondos de inversión", "fondos de inversion", "etfs"}
    out = []
    for path in sorted(glob.glob(os.path.join(folder, "*.json"))):
        for row in json.load(open(path, encoding="utf-8")):
            sector = clean(row.get("sectorDescription"))
            if not row.get("companyName") or (sector or "").lower() in skip:
                continue
            out.append(entry(
                country="PE", list="pe_bvl", list_label="BVL – emisores", year=2026,
                name=clean(row.get("companyName")), kind="listed_company", sector=sector,
            ))
    return out


PUBLIC_NAME = re.compile(r"\b(nacional|estatal|p[uú]blica|polit[eé]cnic[oa]|benem[eé]rita|del estado de)\b", re.I)


def wikidata_universities(path: str) -> list[dict]:
    out = []
    for row in json.load(open(path, encoding="utf-8"))["results"]["bindings"]:
        name = clean(row.get("name", {}).get("value"))
        country = clean(row.get("cc", {}).get("value"))
        if not name or not country or re.search(r"\bcampus\b", name, re.I):
            continue
        flagged_public = row.get("isPublic", {}).get("value") == "1"
        flagged_private = row.get("isPrivate", {}).get("value") == "1"
        out.append(entry(
            country=country.upper(), list="wikidata_universities", list_label="Wikidata – universidades", year=2026,
            name=name, website=clean(row.get("site", {}).get("value")), kind="university",
            is_public=flagged_public or (not flagged_private and bool(PUBLIC_NAME.search(name))),
        ))
    return out


def co_ips_camas(path: str) -> list[dict]:
    out = []
    for row in json.load(open(path, encoding="utf-8")):
        nit = clean(row.get("nit_ips"))
        beds = row.get("camas")
        if not nit:
            continue
        dv = clean(row.get("dv"))
        out.append(entry(
            country="CO", list="co_reps_camas", list_label="MinSalud REPS – IPS con 50+ camas", year=2022,
            name=clean(row.get("nombre")), tax_id=f"{nit}-{dv}" if dv else nit, tax_type="NIT",
            kind="health_provider", is_public=(row.get("naturaleza") or "").startswith("P\u00fablica"),
            sector=f"Prestador de salud ({int(float(beds))} camas)" if beds else "Prestador de salud",
            city=clean(row.get("municipio")), region=clean(row.get("departamento")),
        ))
    return out


def statista_mx(path: str) -> list[dict]:
    page = open(path, encoding="utf-8", errors="ignore").read()
    # Los datos de la página (Nuxt) son una lista plana de valores referenciados por
    # posición: el objeto {"name": i, "industry": j} apunta a la lista de índices de
    # los nombres. La industria es sólo el filtro de la página, no la de cada empresa.
    block = re.search(r'<script[^>]*id="__NUXT_DATA__"[^>]*>(.*?)</script>', page, re.S)
    if not block:
        return []
    data = json.loads(block.group(1))
    names: list = []
    for value in data:
        if isinstance(value, dict) and "name" in value and "industry" in value:
            ref = data[value["name"]]
            if isinstance(ref, list):
                names = [data[i] for i in ref if isinstance(i, int)]
                break
    year = re.search(r"mejores-empleadores-mexico-(\d{4})", page)
    out = []
    for name in names:
        if isinstance(name, str) and clean(name):
            out.append(entry(
                country="MX", list="statista_mx", list_label="Forbes/Statista – Mejores empleadores de México",
                year=int(year.group(1)) if year else None, name=clean(name), kind="ranking", size_large=True,
            ))
    return out


def merco(folder: str) -> list[dict]:
    import glob
    import os

    out = []
    for path in sorted(glob.glob(os.path.join(folder, "*_*.html"))):
        country, _, kind = os.path.basename(path)[:-5].partition("_")
        page = open(path, encoding="utf-8", errors="ignore").read()
        tables = re.findall(r"<table[^>]*>(.*?)</table>", page, re.S)
        if not tables:
            continue
        year_match = re.search(r'edicion=(\d{4})"\s*class="selected"', page)
        year = int(year_match.group(1)) if year_match else None
        sector_by_name: dict[str, str] = {}
        start = page.find('id="ranking-sectorial"')
        end = page.find('id="ranking-documentos"')
        if start >= 0:
            heading = ""
            for part in re.split(r"(<table[^>]*>.*?</table>)", page[start:end if end > 0 else None], flags=re.S):
                if part.startswith("<table"):
                    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", part, re.S):
                        cells = [strip_tags(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
                        if len(cells) >= 2 and cells[1]:
                            sector_by_name.setdefault(cells[1].upper(), heading)
                else:
                    heading = strip_tags(part).split(">")[-1].strip()
        label = "Merco Empresas" if kind == "empresas" else "Merco Talento"
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", tables[0], re.S):
            cells = [strip_tags(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
            if len(cells) < 2 or not cells[0].isdigit() or not cells[1]:
                continue
            out.append(entry(
                country=country.upper(), list=f"merco_{kind}_{country}_{year}",
                list_label=f"{label} {year}" if year else label, year=year,
                name=cells[1], kind="ranking", sector=sector_by_name.get(cells[1].upper()) or None,
                size_large=True,
            ))
    return out


EXTRACTORS = {
    "co_snies": co_snies,
    "pe_sunedu": pe_sunedu,
    "ar_ssn": ar_ssn,
    "cl_cmf_seguros": cl_cmf_seguros,
    "ec_direx": ec_direx,
    "merco": merco,
    "py_cones": py_cones,
    "pe_bvl": pe_bvl,
    "wikidata_universities": wikidata_universities,
    "co_ips_camas": co_ips_camas,
    "statista_mx": statista_mx,
}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("list", choices=sorted(EXTRACTORS))
    parser.add_argument("--input", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    entries = [e for e in EXTRACTORS[args.list](args.input) if e.get("name")]
    with open(args.out, "w", encoding="utf-8") as fh:
        for item in entries:
            fh.write(json.dumps(item, ensure_ascii=False) + "\n")
    print(f"{args.list}: {len(entries)} entradas", file=sys.stderr)


if __name__ == "__main__":
    main()
