#!/usr/bin/env python3
"""
SOURCES-HN-CLOSE-1 — extractor de las partes de las compras del Estado de Honduras en OCDS.

Datos abiertos oficiales, licencia CC BY 4.0, gratuitos y sin inicio de sesión, en el
registro de datos de contratación abierta:

  ONCAE / HonduCompras  https://data.open-contracting.org/en/publication/122/download?name=<AÑO>.jsonl.gz
  SEFIN / SIAFI         https://data.open-contracting.org/en/publication/123/download?name=<AÑO>.jsonl.gz

Guardar como honduras_oncae_<AÑO>.jsonl.gz y honduras_sefin_bulk_<AÑO>.jsonl.gz.

Cada línea es un «compiled release» de un proceso. De ahí sale:

  1. Por RTN de PERSONA JURÍDICA que vende o se presenta (14 dígitos con un 9 en la
     quinta posición; nunca personas naturales, cédulas ni pasaportes): nombres,
     correos, fechas, número de contratos, monto en lempiras, compradores distintos,
     peso por familia UNSPSC (HonduCompras) y por objeto del gasto (SEFIN), y el año
     más reciente en que HonduCompras le pegó la marca «*MIPYME*» al nombre.
  2. Por entidad compradora de ONCAE (sin RTN: ONCAE usa un código propio): nombre,
     web, correos, departamento y municipio, agrupando las unidades en su entidad.

Uso:
  python3 extract-hn-ocds-parties.py --ocds-dir=<carpeta> --years=2018,…,2026 --out-dir=<carpeta>

Produce hn_suppliers.jsonl y hn_buyers.jsonl. No escribe en ninguna base de datos:
los lee `run-hn-sources-etl.ts`.
"""

import collections
import glob
import gzip
import json
import os
import re
import sys

JURIDICAL_RTN = re.compile(r'^\d{4}9\d{9}$')
UNSPSC = re.compile(r'^\d{8}$')
OBJETO = re.compile(r'^\d{5}$')
SUPPLIER_ROLES = {'supplier', 'tenderer'}
# Un contrato de más de 20.000 millones de lempiras es un error de carga.
MAX_CONTRACT_HNL = 2e10
# Lempiras por dólar, sólo para los pocos contratos en dólares.
HNL_PER_USD = 24.5
MIPYME_TAG = re.compile(r'\*\s*MIPYME', re.IGNORECASE)


def arg(name, default=None):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a.split('=', 1)[1]
    return default


def juridical_rtn(raw):
    digits = re.sub(r'\D', '', re.sub(r'^HN-RTN-', '', str(raw or ''), flags=re.IGNORECASE))
    return digits if JURIDICAL_RTN.match(digits) else None


def new_supplier():
    return {
        'names': collections.Counter(), 'emails': collections.Counter(), 'regions': collections.Counter(),
        'first': '9999', 'last': '', 'years': set(), 'sources': set(), 'contracts': 0, 'hnl': 0.0,
        'buyers': set(), 'fam': collections.Counter(), 'obj': collections.Counter(), 'mipyme_year': None,
    }


def to_hnl(value):
    if not isinstance(value, dict):
        return 0.0
    amount = value.get('amount')
    if not isinstance(amount, (int, float)) or amount <= 0:
        return 0.0
    currency = (value.get('currency') or 'HNL').upper()
    hnl = amount if currency == 'HNL' else amount * HNL_PER_USD if currency == 'USD' else 0.0
    return hnl if hnl <= MAX_CONTRACT_HNL else 0.0


def item_weights(items):
    """Peso de cada familia UNSPSC (4 dígitos) en los artículos: por su valor, o por igual."""
    weights = collections.Counter()
    for item in items or []:
        cls = item.get('classification') or {}
        code = str(cls.get('id') or '')
        if cls.get('scheme') != 'UNSPSC' or not UNSPSC.match(code):
            continue
        unit = (item.get('unit') or {}).get('value') or {}
        amount = unit.get('amount') if isinstance(unit, dict) else None
        qty = item.get('quantity')
        value = amount * qty if isinstance(amount, (int, float)) and isinstance(qty, (int, float)) else 0
        weights[code[:4]] += value if value > 0 else 1e-9
    total = sum(weights.values())
    return {k: v / total for k, v in weights.items()} if total > 0 else {}


def objeto_codes(release):
    codes = []
    budget = ((release.get('planning') or {}).get('budget') or {})
    for breakdown in budget.get('budgetBreakdown') or []:
        parts = str(breakdown.get('id') or '').split('-')
        if len(parts) > 5 and OBJETO.match(parts[-2]):
            codes.append(parts[-2])
    return codes


def main():
    ocds_dir = arg('ocds-dir')
    out_dir = arg('out-dir')
    years = set((arg('years') or '').split(',')) - {''}
    if not ocds_dir or not out_dir:
        sys.exit('config_invalid: faltan --ocds-dir y --out-dir')

    suppliers = collections.defaultdict(new_supplier)
    buyers = {}
    files = sorted(glob.glob(os.path.join(ocds_dir, 'honduras_*_*.jsonl.gz')))
    for path in files:
        match = re.search(r'honduras_(oncae|sefin_bulk)_(\d{4})\.jsonl\.gz$', path)
        if not match or (years and match.group(2) not in years):
            continue
        source = 'oncae' if match.group(1) == 'oncae' else 'sefin'
        releases = 0
        for line in gzip.open(path, 'rt', encoding='utf-8'):
            if not line.strip():
                continue
            release = json.loads(line)
            releases += 1
            date = (release.get('date') or '')[:10]
            buyer_id = (release.get('buyer') or {}).get('id')
            parties = release.get('parties') or []
            by_id = {p.get('id'): p for p in parties}

            for party in parties:
                identifier = party.get('identifier') or {}
                roles = set(party.get('roles') or [])
                if 'buyer' in roles and source == 'oncae':
                    parent = (party.get('memberOf') or [{}])[0]
                    key = parent.get('id') or identifier.get('id') or party.get('id')
                    entry = buyers.setdefault(key, {'id': key, 'name': None, 'urls': collections.Counter(), 'emails': collections.Counter(), 'regions': collections.Counter(), 'last': ''})
                    if not party.get('memberOf'):
                        entry['name'] = (party.get('name') or '').strip() or entry['name']
                    elif entry['name'] is None:
                        entry['name'] = (parent.get('name') or '').strip() or None
                    contact = party.get('contactPoint') or {}
                    if contact.get('url'):
                        entry['urls'][contact['url'].strip()] += 1
                    email = (contact.get('email') or '').strip().lower()
                    if '@' in email:
                        entry['emails'][email] += 1
                    address = party.get('address') or {}
                    if address.get('region') or address.get('locality'):
                        entry['regions'][(address.get('region') or '', address.get('locality') or '')] += 1
                    entry['last'] = max(entry['last'], date)
                    continue
                if identifier.get('scheme') != 'HN-RTN' or not roles & SUPPLIER_ROLES:
                    continue
                rtn = juridical_rtn(identifier.get('id'))
                if rtn is None:
                    continue
                name = (identifier.get('legalName') or party.get('name') or '').strip()
                s = suppliers[rtn]
                if name:
                    s['names'][name] += 1
                    if MIPYME_TAG.search(name) and date[:4].isdigit():
                        s['mipyme_year'] = max(s['mipyme_year'] or 0, int(date[:4]))
                s['sources'].add(source)
                if date:
                    s['first'] = min(s['first'], date)
                    s['last'] = max(s['last'], date)
                    s['years'].add(date[:4])
                email = ((party.get('contactPoint') or {}).get('email') or '').strip().lower()
                if '@' in email:
                    s['emails'][email] += 1
                address = party.get('address') or {}
                region = address.get('region')
                if region and region != 'ND':
                    s['regions'][(region, address.get('locality') or '')] += 1

            awards = {a.get('id'): a for a in release.get('awards') or []}
            units = release.get('contracts') or list(awards.values())
            objetos = objeto_codes(release) if source == 'sefin' else []
            for unit in units:
                award = awards.get(unit.get('awardID')) or {}
                unit_suppliers = unit.get('suppliers') or award.get('suppliers') or []
                hnl = to_hnl(unit.get('value')) or to_hnl(award.get('value'))
                weights = item_weights(unit.get('items') or award.get('items'))
                for sp in unit_suppliers:
                    rtn = juridical_rtn(sp.get('id'))
                    if rtn is None:
                        continue
                    s = suppliers[rtn]
                    s['contracts'] += 1
                    s['hnl'] += hnl
                    if buyer_id:
                        s['buyers'].add(f'{source}:{buyer_id}')
                    for family, share in weights.items():
                        s['fam'][family] += hnl * share if hnl > 0 else share
                    for code in objetos:
                        s['obj'][code] += hnl / len(objetos) if hnl > 0 else 1 / len(objetos)
        print(f'  {os.path.basename(path)}: {releases} versiones', file=sys.stderr)

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, 'hn_suppliers.jsonl'), 'w', encoding='utf-8') as out:
        for rtn, s in sorted(suppliers.items()):
            if not s['names']:
                continue
            region = s['regions'].most_common(1)
            out.write(json.dumps({
                'rtn': rtn,
                'names': dict(s['names']),
                'emails': [e for e, _ in s['emails'].most_common(5)],
                'region': region[0][0][0] if region else None,
                'locality': region[0][0][1] if region else None,
                'first': s['first'] if s['first'] != '9999' else None,
                'last': s['last'] or None,
                'years': sorted(s['years']),
                'sources': sorted(s['sources']),
                'contracts': s['contracts'],
                'hnl': round(s['hnl']),
                'buyers': len(s['buyers']),
                'fam': {k: round(v, 2) for k, v in s['fam'].items()},
                'obj': {k: round(v, 2) for k, v in s['obj'].items()},
                'mipyme_year': s['mipyme_year'],
            }, ensure_ascii=False) + '\n')
    with open(os.path.join(out_dir, 'hn_buyers.jsonl'), 'w', encoding='utf-8') as out:
        for key, b in sorted(buyers.items(), key=lambda kv: str(kv[0])):
            if not b['name']:
                continue
            region = b['regions'].most_common(1)
            out.write(json.dumps({
                'id': key,
                'name': b['name'],
                'urls': [u for u, _ in b['urls'].most_common(3)],
                'emails': [e for e, _ in b['emails'].most_common(5)],
                'region': region[0][0][0] if region else None,
                'locality': region[0][0][1] if region else None,
                'last': b['last'] or None,
            }, ensure_ascii=False) + '\n')
    print(f'{len(suppliers)} proveedores jurídicos, {len(buyers)} entidades compradoras', file=sys.stderr)


if __name__ == '__main__':
    main()
