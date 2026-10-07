#!/usr/bin/env python3
"""
SOURCES-GT-CLOSE-1 — extractor de las partes de Guatecompras (Guatemala) en OCDS.

Datos abiertos oficiales del Ministerio de Finanzas Públicas (Guatecompras,
Decreto 57-92), licencia CC BY 4.0, gratuitos y sin inicio de sesión. Se usa la
copia anual del registro de datos de contratación abierta (sin desafío de bot):

  https://data.open-contracting.org/en/publication/142/download?name=<AÑO>.jsonl.gz

Cada línea es un «compiled release» de un proceso (NOG). De ahí sale:

  1. Por NIT de quien vende o se presenta (rol supplier / tenderer; nunca los
     miembros de la junta de calificación, que son personas): nombre, tipo de
     persona (individual, sociedad anónima, extranjera…), departamento y
     municipio, correos y teléfonos, y —si se le adjudicó— número de
     adjudicaciones activas, monto adjudicado en quetzales, años, compradores
     distintos y peso de cada familia UNSPSC (4 dígitos).
     Las adjudicaciones no traen artículos: el monto de cada una se reparte por
     igual entre los artículos de la licitación del mismo proceso.
  2. Por NIT de entidad compradora: nombre, tipo, nivel y tipo de entidad,
     departamento y municipio, y dominios de correo.

Uso:
  python3 extract-gt-guatecompras-parties.py --ocds-dir=<carpeta con <AÑO>.jsonl.gz> \\
      --years=2023,2024,2025,2026 --out-dir=<carpeta>

Produce gt_suppliers.jsonl y gt_buyers.jsonl. No escribe en ninguna base de
datos: los lee `run-gt-guatecompras-etl.ts`.
"""

import collections
import gzip
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor

NIT_ID = re.compile(r'^GT-NIT-(\d{2,12}K?)$', re.IGNORECASE)
UNSPSC = re.compile(r'^\d{8}$')
# Un monto de más de 5.000 millones de quetzales en una adjudicación es un error de carga.
MAX_AWARD_GTQ = 5e9
SUPPLIER_ROLES = {'supplier', 'tenderer'}


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a.split('=', 1)[1]
    return default


def nit_of(party_id):
    m = NIT_ID.match((party_id or '').strip())
    return m.group(1).upper() if m else None


def new_supplier():
    return {
        'names': collections.Counter(), 'types': collections.Counter(), 'regions': collections.Counter(),
        'localities': collections.Counter(), 'emails': collections.Counter(), 'phones': collections.Counter(),
        'awards': set(), 'buyers': set(), 'years': set(), 'amount': 0.0,
        'fam': collections.Counter(), 'cls': collections.Counter(), 'desc': {}, 'tendered': 0,
    }


def new_buyer():
    return {
        'names': collections.Counter(), 'type': collections.Counter(), 'level': collections.Counter(),
        'entityType': collections.Counter(), 'regions': collections.Counter(), 'localities': collections.Counter(),
        'emails': collections.Counter(), 'processes': 0,
    }


def text(value):
    return value.strip() if isinstance(value, str) and value.strip() else None


def detail(value):
    if isinstance(value, dict):
        return text(value.get('description')) or text(value.get('id'))
    return text(value)


def process_year(path):
    sup = collections.defaultdict(new_supplier)
    buy = collections.defaultdict(new_buyer)
    lines = bad = 0
    with gzip.open(path, 'rt', encoding='utf-8', errors='replace') as fh:
        for line in fh:
            lines += 1
            try:
                rel = json.loads(line)
            except ValueError:
                bad += 1
                continue
            parties = rel.get('parties') or []
            # La entidad compradora: su NIT va en `buyer.id`; sus datos, en la parte
            # GT-CISP (código institucional del MINFIN) con rol buyer. Las unidades de
            # compra (GT-GCUC) dependen de ella y no son entidades por sí mismas.
            buyer_nit = nit_of((rel.get('buyer') or {}).get('id'))
            if buyer_nit:
                b = buy[buyer_nit]
                b['processes'] += 1
                if text((rel.get('buyer') or {}).get('name')):
                    b['names'][text(rel['buyer']['name'])] += 1
                for p in parties:
                    if 'buyer' not in (p.get('roles') or []) or not str(p.get('id') or '').startswith('GT-CISP-'):
                        continue
                    address = p.get('address') or {}
                    contact = p.get('contactPoint') or {}
                    details = p.get('details') or {}
                    for key in ('type', 'level', 'entityType'):
                        if detail(details.get(key)):
                            b[key][detail(details.get(key))] += 1
                    if text(address.get('region')):
                        b['regions'][text(address.get('region'))] += 1
                    if text(address.get('locality')):
                        b['localities'][text(address.get('locality'))] += 1
                    if text(contact.get('email')):
                        b['emails'][text(contact.get('email')).lower()] += 1
                    break
            for p in parties:
                nit = nit_of(p.get('id'))
                if not nit:
                    continue
                roles = set(p.get('roles') or [])
                address = p.get('address') or {}
                contact = p.get('contactPoint') or {}
                details = p.get('details') or {}
                if roles & SUPPLIER_ROLES:
                    s = sup[nit]
                    if 'tenderer' in roles:
                        s['tendered'] += 1
                    if text(p.get('name')):
                        s['names'][text(p.get('name'))] += 1
                    if detail(details.get('legalEntityTypeDetail')):
                        s['types'][detail(details.get('legalEntityTypeDetail'))] += 1
                    if text(address.get('region')):
                        s['regions'][text(address.get('region'))] += 1
                    if text(address.get('locality')):
                        s['localities'][text(address.get('locality'))] += 1
                    if text(contact.get('email')):
                        s['emails'][text(contact.get('email')).lower()] += 1
                    if text(contact.get('telephone')):
                        s['phones'][text(contact.get('telephone'))] += 1

            items = (rel.get('tender') or {}).get('items') or []
            codes = []
            for it in items:
                code = ((it.get('classification') or {}).get('id') or '')[:8]
                if UNSPSC.match(code):
                    codes.append((code, text(it.get('description')) or ''))
            for award in rel.get('awards') or []:
                if award.get('status') != 'active':
                    continue
                value = award.get('value') or {}
                try:
                    amount = float(value.get('amount') or 0)
                except (TypeError, ValueError):
                    amount = 0.0
                if value.get('currency') not in (None, 'GTQ') or amount < 0 or amount > MAX_AWARD_GTQ:
                    amount = 0.0
                year = (award.get('date') or '')[:4]
                nits = [n for n in (nit_of(x.get('id')) for x in award.get('suppliers') or []) if n]
                if not nits:
                    continue
                share = amount / len(nits)
                for nit in nits:
                    s = sup[nit]
                    s['awards'].add(award.get('id') or rel.get('ocid'))
                    s['amount'] += share
                    if year.isdigit():
                        s['years'].add(int(year))
                    if buyer_nit:
                        s['buyers'].add(buyer_nit)
                    if codes and share > 0:
                        per_item = share / len(codes)
                        for code, desc in codes:
                            s['fam'][code[:4]] += per_item
                            s['cls'][code] += per_item
                            s['desc'].setdefault(code, desc[:120])
    return path, lines, bad, sup, buy


def merge_supplier(a, b):
    for key in ('names', 'types', 'regions', 'localities', 'emails', 'phones', 'fam', 'cls'):
        a[key].update(b[key])
    for key in ('awards', 'buyers', 'years'):
        a[key] |= b[key]
    a['amount'] += b['amount']
    a['tendered'] += b['tendered']
    for code, desc in b['desc'].items():
        a['desc'].setdefault(code, desc)


def merge_buyer(a, b):
    for key in ('names', 'type', 'level', 'entityType', 'regions', 'localities', 'emails'):
        a[key].update(b[key])
    a['processes'] += b['processes']


def top(counter):
    best = counter.most_common(1)
    return best[0][0] if best else None


def main():
    ocds_dir = arg('ocds-dir')
    years = [y for y in (arg('years') or '').split(',') if y]
    out_dir = arg('out-dir', '.')
    if not ocds_dir or not years:
        sys.exit('faltan --ocds-dir y --years')
    sup = collections.defaultdict(new_supplier)
    buy = collections.defaultdict(new_buyer)
    with ProcessPoolExecutor(max_workers=len(years)) as pool:
        for path, lines, bad, s_part, b_part in pool.map(process_year, [f'{ocds_dir}/{y}.jsonl.gz' for y in years]):
            print(path, 'procesos', lines, 'ilegibles', bad, 'nit vendedores', len(s_part), 'compradores', len(b_part), file=sys.stderr)
            for nit, s in s_part.items():
                merge_supplier(sup[nit], s)
            for nit, b in b_part.items():
                merge_buyer(buy[nit], b)

    with open(f'{out_dir}/gt_suppliers.jsonl', 'w') as out:
        for nit, s in sorted(sup.items()):
            top_cls = s['cls'].most_common(1)
            out.write(json.dumps({
                'nit': nit,
                'name': top(s['names']),
                'names': [n for n, _ in s['names'].most_common(5)],
                'type': top(s['types']),
                'region': top(s['regions']),
                'locality': top(s['localities']),
                'emails': [e for e, _ in s['emails'].most_common(5)],
                'phone': top(s['phones']),
                'awards': len(s['awards']),
                'amount_gtq': round(s['amount'], 2),
                'buyers': len(s['buyers']),
                'first_year': min(s['years']) if s['years'] else None,
                'last_year': max(s['years']) if s['years'] else None,
                'tendered': s['tendered'],
                'fam': {k: round(v) for k, v in s['fam'].items() if v >= 1},
                'activity': s['desc'].get(top_cls[0][0]) if top_cls else None,
            }, ensure_ascii=False) + '\n')
    with open(f'{out_dir}/gt_buyers.jsonl', 'w') as out:
        for nit, b in sorted(buy.items()):
            out.write(json.dumps({
                'nit': nit,
                'name': top(b['names']),
                'names': [n for n, _ in b['names'].most_common(5)],
                'type': top(b['type']),
                'level': top(b['level']),
                'entity_type': top(b['entityType']),
                'region': top(b['regions']),
                'locality': top(b['localities']),
                'emails': [e for e, _ in b['emails'].most_common(5)],
                'processes': b['processes'],
            }, ensure_ascii=False) + '\n')
    print('vendedores', len(sup), 'compradores', len(buy), file=sys.stderr)


if __name__ == '__main__':
    main()
