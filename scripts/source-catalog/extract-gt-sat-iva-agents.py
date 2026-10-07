#!/usr/bin/env python3
"""
SOURCES-GT-CLOSE-1 — extractor del «Listado de agentes de retención del IVA» de la
Superintendencia de Administración Tributaria (SAT) de Guatemala.

El listado es información pública que la SAT publica en su portal (PDF, se
actualiza cada pocos meses): NIT, nombre y fecha desde la que el contribuyente es
agente de retención. Los agentes de retención son, sobre todo, los contribuyentes
especiales (grandes) y las entidades del Estado.

El portal de la SAT pide pasar un control anti-robots: el PDF se baja a mano con el
navegador (o se usa la copia pública de archive.org del mismo PDF). Este script no
sale a la red: sólo lee el PDF.

Uso:
  python3 extract-gt-sat-iva-agents.py --pdf=<listado.pdf> --out=gt_sat_iva_agents.jsonl

Cada línea: {"n": nº de fila, "nit": "698827K", "name": "...", "start": "1/11/2006",
"list_date": "2026-04-01"}. No escribe en ninguna base de datos: lo lee
`run-gt-sat-iva-agents-etl.ts`.
"""

import json
import re
import sys

from pypdf import PdfReader

ROW = re.compile(r'^(\d+) (\d{3,12}K?) (.+?) (\d{1,2}/\d{2}/\d{4})\s*$')
LIST_DATE = re.compile(r'AGENTES DE RETENCI[ÓO]N DEL IVA AL (\d{2})/(\d{2})/(\d{4})')


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a.split('=', 1)[1]
    return default


def main():
    pdf = arg('pdf')
    out_path = arg('out', 'gt_sat_iva_agents.jsonl')
    if not pdf:
        sys.exit('falta --pdf')
    reader = PdfReader(pdf)
    list_date = None
    rows = []
    for page in reader.pages:
        for line in (page.extract_text() or '').splitlines():
            line = line.strip()
            date = LIST_DATE.search(line)
            if date and list_date is None:
                list_date = f'{date.group(3)}-{date.group(2)}-{date.group(1)}'
            m = ROW.match(line)
            if m:
                rows.append({
                    'n': int(m.group(1)),
                    'nit': m.group(2),
                    'name': m.group(3).replace('"', '').strip(),
                    'start': m.group(4),
                })
    numbers = sorted(r['n'] for r in rows)
    missing = len(set(range(1, numbers[-1] + 1)) - set(numbers)) if numbers else 0
    with open(out_path, 'w') as out:
        for r in rows:
            out.write(json.dumps({**r, 'list_date': list_date}, ensure_ascii=False) + '\n')
    print('filas', len(rows), 'última', numbers[-1] if numbers else None, 'huecos', missing,
          'fecha del listado', list_date, file=sys.stderr)


if __name__ == '__main__':
    main()
