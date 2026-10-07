#!/usr/bin/env python3
"""
CR — fichas de MIDEPLAN «Organización del Sector Público Costarricense» (SOURCES-CR-CLOSE-1).

Lee el índice público por naturaleza jurídica (Google Sites oficial de MIDEPLAN) y
cada ficha de institución, a una petición por segundo, y escribe una línea JSON por
institución: {"path", "name", "web", "nature"}. El nombre trae la sigla oficial entre
paréntesis («Instituto Costarricense de Electricidad (ICE)»); la carga
(`run-cr-company-registry-etl.ts --mideplan=…`) la cruza por nombre con las
instituciones de SICOP, que sí traen la cédula.

Uso:
  python3 scripts/source-catalog/extract-cr-mideplan-fichas.py --out=mideplan_fichas.jsonl

Sólo lee páginas públicas; no envía formularios ni se identifica; no guarda personas.
"""

import argparse
import html
import json
import re
import time
import urllib.parse
import urllib.request

INDEX = "https://sites.google.com/expedientesmideplan.go.cr/organizacion-sector-publico/indice-por-naturaleza-jur%C3%ADdica"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36"
PAUSE_SECONDS = 1.1


def fetch(url: str) -> str:
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    return urllib.request.urlopen(req, timeout=30).read().decode("utf-8", "ignore")


def text_of(page: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", page)))


def parse_ficha(page: str) -> dict:
    text = text_of(page)
    match = re.search(r"Sitio web:\s*(\S+)", text)
    if match is None:
        return {"name": None, "web": None, "nature": None}
    # El nombre es lo que va justo antes de «Sitio web:» (después del último script).
    before = text[: match.start()].split("getTime();")[-1].strip()
    nature = re.search(r"Naturaleza Jur[ií]dica:\s*(.*?)\s+Personalidad", text)
    web = match.group(1)
    return {
        "name": before[-200:] if before else None,
        "web": web if web.lower().startswith("http") else None,
        "nature": nature.group(1) if nature else None,
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    a = ap.parse_args()

    index = fetch(INDEX)
    paths = sorted(
        {
            urllib.parse.unquote(m)
            for m in re.findall(r'href="(/expedientesmideplan\.go\.cr/organizacion-sector-publico/[^"#?]+)"', index)
            if not m.rstrip("/").endswith(("organizacion-sector-publico", "indice-por-naturaleza-jur%C3%ADdica"))
        }
    )
    ok = 0
    with open(a.out, "w", encoding="utf-8") as out:
        for path in paths:
            time.sleep(PAUSE_SECONDS)
            url = "https://sites.google.com" + urllib.parse.quote(path, safe="/")
            try:
                row = {"path": path, **parse_ficha(fetch(url))}
            except Exception as error:  # noqa: BLE001 — una ficha caída no corta la lectura
                row = {"path": path, "error": str(error)}
            ok += 1 if row.get("web") else 0
            out.write(json.dumps(row, ensure_ascii=False) + "\n")
            out.flush()
    print(f"fichas={len(paths)} con_web={ok}")


if __name__ == "__main__":
    main()
