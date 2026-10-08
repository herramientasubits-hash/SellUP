#!/usr/bin/env python3
"""
CR — socios de la Cámara de Industrias de Costa Rica (SOURCES-CR-CICR-1).

Lee la página pública de asociados de CICR (https://cicr.com/asociados/), ya
descargada a un archivo local, y escribe un JSON por línea:

  {"name", "domain", "activity", "legal_form"}

  --html=<archivo>   la página guardada (curl con User-Agent de navegador).
  --out=<jsonl>      salida.

Sólo lee un archivo local; no sale a la red. NO guarda teléfonos ni correos (datos
de contacto de personas): del correo se usa únicamente el dominio, y sólo si es de
la empresa (no gratuito). `legal_form` es false cuando el nombre no termina en una
forma societaria: esas filas son probables personas físicas y el cargador las
descarta (regla del proyecto: nunca personas físicas).
"""

from __future__ import annotations

import argparse
import html
import json
import re

FREE_MAIL = {
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com",
    "msn.com", "aol.com", "proton.me", "protonmail.com", "yahoo.es", "hotmail.es",
}
LEGAL_FORM = re.compile(
    r"(\bS\.?\s?A\.?|\bS\.?\s?R\.?\s?L\.?|\bLTDA?\.?|\bLIMITADA|SOCIEDAD\s+AN[OÓ]NIMA|"
    r"SOCIEDAD\s+DE\s+RESPONSABILIDAD|\bINC\.?|\bLLC|\bCORP\.?|COOPERATIVA|\bR\.?\s?L\.?)\s*$",
    re.IGNORECASE,
)
ROW = re.compile(r"<tr>(.*?)</tr>", re.S)


def cell(row: str, css: str) -> str:
    match = re.search(r'<td class="%s">(.*?)</td>' % css, row, re.S)
    return match.group(1) if match else ""


def text(fragment: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def domain_of(value: str) -> str | None:
    value = value.strip().lower()
    value = re.sub(r"^https?://", "", value)
    value = re.sub(r"^www\.", "", value)
    host = re.split(r"[/?#\s]", value)[0]
    return host if re.fullmatch(r"[a-z0-9-]+(\.[a-z0-9-]+)+", host) else None


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--html", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()

    page = open(args.html, encoding="utf-8", errors="ignore").read()
    written = 0
    with open(args.out, "w", encoding="utf-8") as out:
        for row in ROW.findall(page):
            name = text(cell(row, "col-nombre"))
            if not name:
                continue
            web = cell(row, "col-sitio")
            href = re.search(r'href="([^"]+)"', web)
            domain = domain_of(href.group(1) if href else text(web))
            if domain is None:
                mail = re.search(r"mailto:[^@\"]+@([^\"?]+)", cell(row, "col-correo"))
                candidate = domain_of(mail.group(1)) if mail else None
                domain = candidate if candidate and candidate not in FREE_MAIL else None
            out.write(json.dumps({
                "name": name,
                "domain": domain,
                "activity": text(cell(row, "col-actividad")) or None,
                "legal_form": bool(LEGAL_FORM.search(name)),
            }, ensure_ascii=False) + "\n")
            written += 1
    print("filas", written)


if __name__ == "__main__":
    main()
