#!/usr/bin/env python3
"""
SOURCES-PY-CLOSE-1 — extractor de proveedores del Estado paraguayo (DNCP).

Datos abiertos oficiales de la Dirección Nacional de Contrataciones Públicas
(licencia CC BY 4.0), gratuitos y sin inicio de sesión:

  1. Adjudicaciones OCDS por año (descarga masiva, ~50-80 MB por año):
       https://www.contrataciones.gov.py/images/opendata-v3/final/ocds/<AÑO>/awa-masivo.zip
     Se leen awa_suppliers.csv (RUC del proveedor), awards.csv (estado),
     records.csv (entidad compradora) y awa_items.csv (clase UNSPSC, cantidad y
     precio de cada artículo). Sólo adjudicaciones ACTIVAS a sociedades (RUC 80…).

  2. Ficha de cada proveedor en la API pública v3 (tipo de sociedad, tamaño
     MIPYME declarado, dirección, web y correo):
       https://www.contrataciones.gov.py/datos/api/v3/doc/search/suppliers
       https://www.contrataciones.gov.py/datos/api/v3/doc/suppliers/<RUC>
     Con pausas entre llamadas. Reanudable: no vuelve a pedir lo ya guardado.

Uso:
  python3 extract-py-dncp-suppliers.py summary --ocds-dir=<carpeta con awa-<AÑO>.zip> \\
      --years=2022,2023,2024,2025,2026 --out=dncp_suppliers.jsonl
  python3 extract-py-dncp-suppliers.py profiles --suppliers=dncp_suppliers.jsonl --out=dncp_api.jsonl

No escribe en ninguna base de datos: produce ficheros JSONL que lee
`run-py-dncp-directory-etl.ts` (y `run-py-set-registry-etl.ts --dncp-api=`).
"""

import collections
import csv
import io
import json
import re
import sys
import time
import urllib.error
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor

csv.field_size_limit(10**9)

API = 'https://www.contrataciones.gov.py/datos/api/v3/doc'
COMPANY_RUC = re.compile(r'^PY-RUC-(80\d{6}-\d)$')
# Conversión aproximada sólo para comparar familias UNSPSC dentro de una empresa.
TO_USD = {'PYG': 1 / 7800, 'USD': 1.0}
# Un artículo de más de 500 millones de USD es un error de carga o un monto marco.
MAX_ITEM_USD = 5e8
PAUSE_SECONDS = 0.3
# Pocas consultas a la vez: la API es pública y no hay que cargarla.
PARALLEL_REQUESTS = 3


def arg(name, default=None):
    for a in sys.argv[2:]:
        if a.startswith(f'--{name}='):
            return a.split('=', 1)[1]
    return default


def rows(zf, name):
    return csv.DictReader(io.TextIOWrapper(zf.open(name), encoding='utf-8', errors='replace'))


def summary():
    ocds_dir = arg('ocds-dir')
    years = [y for y in (arg('years') or '').split(',') if y]
    out_path = arg('out', 'dncp_suppliers.jsonl')
    if not ocds_dir or not years:
        sys.exit('faltan --ocds-dir y --years')

    sup = collections.defaultdict(lambda: {
        'awards': set(), 'buyers': set(), 'years': set(),
        'cls': collections.Counter(), 'desc': {}, 'fam': collections.Counter(),
    })
    for year in years:
        zf = zipfile.ZipFile(f'{ocds_dir}/awa-{year}.zip')
        award_suppliers = collections.defaultdict(list)
        for r in rows(zf, 'awa_suppliers.csv'):
            m = COMPANY_RUC.match(r['compiledRelease/awards/0/suppliers/0/id'].strip())
            if m:
                award_suppliers[(r['compiledRelease/id'], r['compiledRelease/awards/0/id'])].append(m.group(1))
        buyer_of = {}
        for r in rows(zf, 'records.csv'):
            buyer = r.get('compiledRelease/buyer/id') or r.get('compiledRelease/tender/procuringEntity/id') or ''
            buyer_of[r['compiledRelease/id']] = buyer.strip()
        active = {}
        for r in rows(zf, 'awards.csv'):
            key = (r['compiledRelease/id'], r['compiledRelease/awards/0/id'])
            if r['compiledRelease/awards/0/status'] == 'active' and key in award_suppliers:
                active[key] = (r['compiledRelease/awards/0/date'] or year)[:4]
        for key, award_year in active.items():
            for ruc in award_suppliers[key]:
                s = sup[ruc]
                s['awards'].add(key[1])
                if buyer_of.get(key[0]):
                    s['buyers'].add(buyer_of[key[0]])
                s['years'].add(award_year)
        items = 0
        for r in rows(zf, 'awa_items.csv'):
            key = (r['compiledRelease/id'], r['compiledRelease/awards/0/id'])
            if key not in active:
                continue
            code = (r['compiledRelease/awards/0/items/0/classification/id'] or '')[:8]
            if not re.match(r'^\d{8}$', code):
                continue
            try:
                value = float(r['compiledRelease/awards/0/items/0/quantity'] or 0) * float(
                    r['compiledRelease/awards/0/items/0/unit/value/amount'] or 0)
            except ValueError:
                continue
            value *= TO_USD.get(r['compiledRelease/awards/0/items/0/unit/value/currency'], 0)
            if value <= 0 or value > MAX_ITEM_USD:
                continue
            suppliers = award_suppliers[key]
            for ruc in suppliers:
                s = sup[ruc]
                share = value / len(suppliers)
                s['cls'][code] += share
                s['fam'][code[:4]] += share
                s['desc'].setdefault(code, (r['compiledRelease/awards/0/items/0/classification/description'] or '').strip()[:120])
            items += 1
        print(year, 'adjudicaciones activas a sociedades', len(active), 'artículos', items, file=sys.stderr)

    with open(out_path, 'w') as out:
        for ruc, s in sorted(sup.items()):
            top = s['cls'].most_common(1)
            years_seen = [int(y) for y in s['years'] if str(y).isdigit()]
            out.write(json.dumps({
                'ruc': ruc,
                'awards': len(s['awards']),
                'buyers': len(s['buyers']),
                'last_year': max(years_seen) if years_seen else None,
                'fam': {k: round(v) for k, v in s['fam'].items()},
                'activity': s['desc'].get(top[0][0]) if top else None,
            }, ensure_ascii=False) + '\n')
    print('proveedores', len(sup), file=sys.stderr)


def get(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=60) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as error:
            if error.code == 404:  # el proveedor no tiene ficha: no se reintenta
                return None
            time.sleep(3 * (attempt + 1))
        except Exception:  # red lenta o caída momentánea: reintentar con espera
            time.sleep(3 * (attempt + 1))
    return None


def profiles():
    suppliers_path = arg('suppliers')
    out_path = arg('out', 'dncp_api.jsonl')
    if not suppliers_path:
        sys.exit('falta --suppliers')
    want = {json.loads(line)['ruc'] for line in open(suppliers_path) if line.strip()}
    have = set()
    try:
        for line in open(out_path):
            if line.strip():
                have.add(json.loads(line)['identifier']['id'])
    except FileNotFoundError:
        pass
    def fetch(ruc):
        record = get(f'{API}/suppliers/{ruc.split("-")[0]}')
        time.sleep(PAUSE_SECONDS)
        return record if record and record.get('identifier', {}).get('id') == ruc else None

    with open(out_path, 'a') as out, ThreadPoolExecutor(max_workers=PARALLEL_REQUESTS) as pool:
        for record in pool.map(fetch, sorted(want - have)):
            if record is not None:
                out.write(json.dumps(record, ensure_ascii=False) + '\n')
                out.flush()
    print('fichas', len(want), 'pedidas', len(want - have), file=sys.stderr)


if __name__ == '__main__':
    command = sys.argv[1] if len(sys.argv) > 1 else ''
    if command == 'summary':
        summary()
    elif command == 'profiles':
        profiles()
    else:
        sys.exit('uso: extract-py-dncp-suppliers.py summary|profiles …')
