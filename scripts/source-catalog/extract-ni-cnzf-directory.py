#!/usr/bin/env python3
"""
NI — Directorio Industrial de la Comisión Nacional de Zonas Francas (SOURCES-NI-CLOSE-2).

Publicación oficial de descarga libre (02-07-2025):
https://cnzf.gob.ni/wp-content/uploads/2025/07/DirZF020725.pdf

Cada ficha trae nombre de la empresa, actividad, país de origen del capital,
dirección, contacto, teléfono y correo. El texto del PDF sale desordenado (las
etiquetas de varias fichas antes que sus valores), así que se leen las líneas CON
SU POSICIÓN (`ni-pdf/pdf-lines.swift`, PDFKit de macOS): cada valor va con la
etiqueta que tiene a su misma altura y cada ficha empieza en su «N Company» o
«N Industrial Park».

Sólo se guarda lo de la EMPRESA: sección, número, nombre, actividad, país de origen
y los DOMINIOS corporativos de sus correos (nunca el correo, el contacto ni el
teléfono, que son de personas). Un dominio de correo gratuito no se guarda.

Salida (`--out=<carpeta>`): `ni_cnzf_directory.jsonl`.

Uso (macOS):
  python3 scripts/source-catalog/extract-ni-cnzf-directory.py --pdf=DirZF020725.pdf --out=.tmp/ni
  (o --lines=<tsv> si ya se corrió pdf-lines.swift)
"""

import argparse
import collections
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SECTIONS = [
    ('Parques Industriales', 'parque_industrial'),
    ('Empresas Textil Vestuario', 'textil_vestuario'),
    ('Textileras', 'textilera'),
    ('Insumos, Accesorios', 'insumos_servicios_textil'),
    ('Empresas de Remanufactura', 'remanufactura'),
    ('Sector Agroindustria', 'agroindustria'),
    ('Sector Madera', 'madera'),
    ('Sector Tabaco', 'tabaco'),
    ('Sector Automotriz', 'automotriz'),
    ('Dispositivos M', 'dispositivos_medicos'),
    ('Servicios Externalizados', 'servicios_externalizados'),
    ('Servicios Log', 'servicios_logisticos'),
    ('Otros Sectores', 'otros'),
]
LABELS = {
    'Country': 'country', 'Address': 'address', 'Contact': 'contact', 'Phone': 'phone',
    'Telephone': 'phone', 'E-mail': 'email', 'E-mai': 'email', 'Email': 'email',
    'Activity': 'activity', 'Precess': 'activity', 'Process': 'activity',
}
HEADER = re.compile(r'^(\d{1,3}) (Company|Industrial Park)$')
EMAIL = re.compile(r'[\w.+-]+@([\w-]+(?:\.[\w-]+)+)')
FREE_MAIL = re.compile(r'^(gmail|gmaill|googlemail|hotmail|outlook|live|yahoo|ymail|icloud|aol|msn|me|protonmail)\.', re.I)
LABEL_X_MAX = 110
SAME_LINE = 12
FIRST_DIRECTORY_PAGE = 10


def read_lines(args):
    if args.lines:
        with open(args.lines, encoding='utf-8') as f:
            raw = f.read()
    else:
        swift = os.path.join(HERE, 'ni-pdf', 'pdf-lines.swift')
        raw = subprocess.run(['swift', swift, args.pdf], check=True, capture_output=True, text=True).stdout
    pages = collections.defaultdict(list)
    for row in raw.splitlines():
        parts = row.split('\t', 3)
        if len(parts) == 4:
            pages[int(parts[0])].append((int(parts[1]), int(parts[2]), parts[3].strip()))
    return pages


def section_of(line_text, current):
    for prefix, key in SECTIONS:
        if line_text.startswith(prefix):
            return key
    return current


def records_of_page(lines, section):
    """Fichas de una página: valores pegados a la etiqueta de su misma altura."""
    ordered = sorted(lines, key=lambda l: (-l[1], l[0]))
    records, current, field = [], None, None
    labels = [(y, LABELS[t]) for x, y, t in ordered if x < LABEL_X_MAX and t in LABELS]
    for x, y, text in ordered:
        if x < LABEL_X_MAX:
            section = section_of(text, section)
            header = HEADER.match(text)
            if header:
                current = {'n': int(header.group(1)), 'kind': header.group(2), 'section': section,
                           'header_y': y, 'name': None, 'fields': collections.defaultdict(list)}
                records.append(current)
                field = None
            continue
        if current is None:
            continue
        if current['name'] is None and abs(y - current['header_y']) <= SAME_LINE:
            current['name'] = text
            continue
        label = next((name for ly, name in labels if abs(ly - y) <= 2 and ly <= current['header_y']), None)
        if label is not None:
            field = label
        if field is not None:
            current['fields'][field].append(text)
    return records, section


def to_output(record):
    fields = record['fields']
    domains = sorted({m.lower().rstrip('.') for m in EMAIL.findall(' '.join(fields.get('email', [])))})
    corporate = [d for d in domains if not FREE_MAIL.match(d)]
    activity = ' '.join(fields.get('activity', [])) or None
    # El país va en una línea; a veces la dirección queda pegada a su derecha.
    country = (fields.get('country') or [None])[0]
    if country:
        country = re.split(r'\s+(?=Km\.?|Parque|Edificio|Carretera|Comarca)', country, maxsplit=1)[0].strip() or None
    return {
        'n': record['n'],
        'kind': 'industrial_park' if record['kind'] == 'Industrial Park' else 'company',
        'section': record['section'],
        'name': record['name'],
        'activity': activity[:300] if activity else None,
        'origin_country': country,
        'domains': corporate,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--pdf')
    parser.add_argument('--lines')
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    if not args.pdf and not args.lines:
        sys.exit('falta --pdf o --lines')
    pages = read_lines(args)
    section, out_rows = None, []
    for page in sorted(pages):
        if page < FIRST_DIRECTORY_PAGE:
            continue
        records, section = records_of_page(pages[page], section)
        out_rows.extend(to_output(r) for r in records if r['name'])
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, 'ni_cnzf_directory.jsonl')
    with open(path, 'w', encoding='utf-8') as out:
        for row in out_rows:
            out.write(json.dumps(row, ensure_ascii=False) + '\n')
    by_section = collections.Counter(r['section'] for r in out_rows)
    with_domain = sum(1 for r in out_rows if r['domains'])
    print(f'{path}: {len(out_rows)} fichas, {with_domain} con dominio corporativo', file=sys.stderr)
    for key, count in by_section.most_common():
        print(f'  {key}: {count}', file=sys.stderr)


if __name__ == '__main__':
    main()
