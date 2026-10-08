#!/usr/bin/env python3
"""
NI — Grandes Contribuyentes de la DGI de Nicaragua (SOURCES-NI-CLOSE-2).

La DGI publicaba la «Consulta Grandes Contribuyentes» (GRACO) en
https://www.dgi.gob.ni/GrandesContribuyentes: RUC, razón social y nombre comercial.
Hoy el sitio rechaza las conexiones desde fuera de Nicaragua (cortafuegos), así que
se leen las TRES copias que guardó el Internet Archive (no se salta ningún bloqueo):

  20190924102725  451 filas
  20191229144345  451 filas
  20200320234241  471 filas

Un RUC aparece una vez aunque esté en varias copias; manda el nombre de la copia
más reciente. Sólo personas jurídicas (RUC «J» + 13 dígitos): las personas
naturales de la lista (su RUC es su cédula) se cuentan y se descartan.

Salida (`--out=<carpeta>`): `ni_large_taxpayers.jsonl` con
{ruc, name, trade_name, snapshots: [fechas]}. `--cache=<carpeta>` guarda el HTML de
cada copia para no volver a pedirlo.

Uso:
  python3 scripts/source-catalog/extract-ni-dgi-large-taxpayers.py --out=.tmp/ni --cache=.tmp/ni/dgi
"""

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.request

CAPTURES = ['20190924102725', '20191229144345', '20200320234241']
URL = 'https://www.dgi.gob.ni/GrandesContribuyentes'
JURIDICAL_RUC = re.compile(r'^J\d{13}$')


def capture(stamp, cache):
    path = os.path.join(cache, f'dgi_gc_{stamp}.html') if cache else None
    if path and os.path.exists(path):
        with open(path, encoding='utf-8', errors='replace') as f:
            return f.read()
    req = urllib.request.Request(f'https://web.archive.org/web/{stamp}id_/{URL}',
                                 headers={'User-Agent': 'SellUp source catalog'})
    with urllib.request.urlopen(req, timeout=120) as resp:
        body = resp.read().decode('utf-8', errors='replace')
    if path:
        os.makedirs(cache, exist_ok=True)
        with open(path, 'w', encoding='utf-8') as f:
            f.write(body)
    time.sleep(2)
    return body


def cell(raw):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', raw)).split())


def rows(body):
    for tr in re.findall(r'<tr class="ui-widget-content[^"]*"[^>]*>(.*?)</tr>', body, re.S):
        cells = [cell(td) for td in re.findall(r'<td[^>]*>(.*?)</td>', tr, re.S)]
        if len(cells) >= 3:
            yield cells[1], cells[2], (cells[3] if len(cells) > 3 else '')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--cache', default=None)
    args = parser.parse_args()
    by_ruc = {}
    naturals = 0
    for stamp in CAPTURES:
        count = 0
        for ruc, name, trade in rows(capture(stamp, args.cache)):
            ruc = re.sub(r'[\s.-]', '', ruc).upper()
            count += 1
            if not JURIDICAL_RUC.match(ruc):
                naturals += 1
                continue
            entry = by_ruc.setdefault(ruc, {'ruc': ruc, 'name': None, 'trade_name': None, 'snapshots': []})
            # Las copias van de la más antigua a la más reciente: la última manda.
            entry['name'] = name or entry['name']
            entry['trade_name'] = trade or entry['trade_name']
            entry['snapshots'].append(stamp[:8])
        print(f'{stamp}: {count} filas', file=sys.stderr)
        if count == 0:
            sys.exit(f'la copia {stamp} no trae filas: revisar antes de cargar')
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, 'ni_large_taxpayers.jsonl')
    with open(path, 'w', encoding='utf-8') as out:
        for entry in sorted(by_ruc.values(), key=lambda e: e['ruc']):
            out.write(json.dumps(entry, ensure_ascii=False) + '\n')
    print(f'{path}: {len(by_ruc)} personas jurídicas ({naturals} filas de personas naturales descartadas)', file=sys.stderr)


if __name__ == '__main__':
    main()
