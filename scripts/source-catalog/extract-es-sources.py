#!/usr/bin/env python3
"""
extract-es-sources.py — SOURCES-ES-CLOSE-1. Convierte las descargas oficiales de
España en una línea JSON por NIF (las lee run-es-sources-etl.ts).

Sólo lee ficheros locales; no sale a la red ni escribe en ninguna base de datos.

Entradas (todas opcionales; se descargan aparte):
  --placsp DIR [DIR...]  carpetas con los .atom descomprimidos de la PLACSP
                         (sindicaciones 643, 1143 y 1044, cualquier mes)
  --bdns DIR [DIR...]    carpetas con las páginas JSON de la API de ayudas de Estado
                         de la BDNS (ayudasestado/busqueda, vpd=GE)
  --invente DIR          carpeta con las fichas FichaCompletaEnte (XML SOAP) de INVENTE
  --bde XLSX             Registro_Entidades.xlsx del Banco de España
  --out DIR              salida: es_awardees.jsonl, es_bodies.jsonl, es_bdns.jsonl,
                         es_invente.jsonl, es_bde.jsonl

Uso:
  python3 -I scripts/source-catalog/extract-es-sources.py --placsp a b --bdns c --invente d --bde e.xlsx --out f
"""

import argparse
import html
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from xml.etree import ElementTree as ET

COMPANY_NIF = re.compile(r'^[A-HJNPQRSUVW]\d{7}[0-9A-J]$')


def clean_nif(raw):
    nif = (raw or '').upper().replace('-', '').replace(' ', '').replace('.', '')
    return nif if COMPANY_NIF.match(nif) else None


def first(pattern, text):
    m = re.search(pattern, text, re.S)
    return html.unescape(m.group(1)).strip() if m else ''


# ─── PLACSP ────────────────────────────────────────────────────────────────

def extract_placsp(dirs):
    awardees = {}
    bodies = {}
    for d in dirs:
        for f in sorted(os.listdir(d)):
            if not f.endswith('.atom'):
                continue
            text = open(os.path.join(d, f), encoding='utf-8', errors='replace').read()
            for entry in text.split('<entry>')[1:]:
                party = first(r'<cac-place-ext:LocatedContractingParty>(.*?)</cac:Party>', entry)
                if party:
                    onif = clean_nif(first(r'<cbc:ID schemeName="NIF">([^<]*)<', party))
                    oname = first(r'<cac:PartyName>\s*<cbc:Name>([^<]*)<', party)
                    if onif and oname:
                        b = bodies.setdefault(onif, {'nif': onif, 'dir3': None, 'names': defaultdict(int), 'urls': [], 'emails': [], 'type_code': None})
                        b['names'][oname] += 1
                        b['dir3'] = b['dir3'] or (first(r'<cbc:ID schemeName="DIR3">([^<]*)<', party) or None)
                        b['type_code'] = b['type_code'] or (first(r'<cbc:ContractingPartyTypeCode[^>]*>([^<]*)<', entry) or None)
                        for key, pat in (('urls', r'<cbc:WebsiteURI>([^<]*)<'), ('emails', r'<cbc:ElectronicMail>([^<]*)<')):
                            v = first(pat, party)
                            if v and v not in b[key] and len(b[key]) < 5:
                                b[key].append(v)
                project = first(r'<cac:ProcurementProject>(.*?)</cac:ProcurementProject>', entry)
                cpv = re.findall(r'<cbc:ItemClassificationCode[^>]*>(\d{8})<', project)
                division = cpv[0][:2] if cpv else None
                for result in re.findall(r'<cac:TenderResult>(.*?)</cac:TenderResult>', entry, re.S):
                    amount = first(r'<cbc:TaxExclusiveAmount[^>]*>([^<]*)<', result)
                    year = first(r'<cbc:AwardDate>(\d{4})', result)
                    for wp in re.findall(r'<cac:WinningParty>(.*?)</cac:WinningParty>', result, re.S):
                        nif = clean_nif(first(r'<cbc:ID schemeName="NIF">([^<]*)<', wp))
                        name = first(r'<cbc:Name>([^<]*)<', wp)
                        if not nif or not name:
                            continue
                        a = awardees.setdefault(nif, {'nif': nif, 'names': defaultdict(int), 'cpv': defaultdict(int), 'eur': 0.0, 'contracts': 0, 'last': None, 'postal': None})
                        a['names'][name] += 1
                        if division:
                            a['cpv'][division] += 1
                        try:
                            a['eur'] += float(amount or 0)
                        except ValueError:
                            pass
                        a['contracts'] += 1
                        if year.isdigit():
                            a['last'] = max(a['last'] or 0, int(year))
                        a['postal'] = a['postal'] or (first(r'<cbc:PostalZone>([^<]*)<', wp) or None)
    return awardees, bodies


# ─── BDNS ──────────────────────────────────────────────────────────────────

def extract_bdns(dirs):
    out = {}
    for d in dirs:
        for f in sorted(os.listdir(d)):
            if not f.endswith('.json'):
                continue
            try:
                page = json.load(open(os.path.join(d, f), encoding='utf-8'))
            except (ValueError, OSError):
                continue
            for x in page.get('content', []):
                nif, _, name = (x.get('beneficiario') or '').partition(' - ')
                nif = clean_nif(nif)
                if not nif or not name.strip():
                    continue
                b = out.setdefault(nif, {'nif': nif, 'names': defaultdict(int), 'cnae': defaultdict(int), 'large_year': None, 'region': None})
                b['names'][name.strip()] += 1
                sector = (x.get('sectores') or '').split(' - ')[0].strip()
                if sector:
                    b['cnae'][sector] += 1
                year = (x.get('fechaConcesion') or '')[:4]
                if x.get('tipoBeneficiario') == 'GRAN EMPRESA' and year.isdigit():
                    b['large_year'] = max(b['large_year'] or 0, int(year))
                b['region'] = b['region'] or ((x.get('region') or '').split(' - ')[-1].strip() or None)
    return out


# ─── INVENTE ───────────────────────────────────────────────────────────────

def latest_magnitude(text, prefix):
    m = re.search(r'<a:Magnitud>%s[^<]*</a:Magnitud><a:ListaValores>(.*?)</a:ListaValores>' % re.escape(prefix), text, re.S)
    if not m:
        return None, None
    values = [(int(y), v) for y, v in re.findall(r'<a:Ejercicio>(\d+)</a:Ejercicio><a:Valor>([^<]*)</a:Valor>', m.group(1)) if v.strip()]
    if not values:
        return None, None
    year, value = values[-1]
    try:
        return year, float(value)
    except ValueError:
        return None, None


def extract_invente(d):
    out = {}
    for f in sorted(os.listdir(d)):
        if not f.endswith('.xml'):
            continue
        text = open(os.path.join(d, f), encoding='utf-8', errors='replace').read()
        baja = first(r'<a:FechaBaja>([^<]*)<', text)
        if baja and not baja.startswith('0001'):
            continue
        nif = clean_nif(first(r'<a:NIF>([^<]*)<', text))
        name = first(r'<a:DenominacionSocial>([^<]*)<', text)
        if not nif or not name:
            continue
        workers_year, workers = latest_magnitude(text, 'Plantilla')
        cnae = re.search(r'<a:DatosCNAE><a:Codigo>([^<]*)', text)
        out[nif] = {
            'nif': nif,
            'name': name,
            'form': first(r'<a:FormaJuridica_Descripcion>([^<]*)<', text) or None,
            'cnae': cnae.group(1).strip() if cnae else None,
            'adscription': first(r'<a:Adscripcion_Descripcion>([^<]*)<', text) or None,
            'web': first(r'<a:SitioWeb>([^<]*)<', text) or None,
            'email': first(r'<a:Email>([^<]*)<', text) or None,
            'workers': int(workers) if workers is not None else None,
            'workers_year': workers_year,
            'invente_code': first(r'<a:CodigoInvente>([^<]*)<', text) or None,
        }
    return out


# ─── Banco de España ───────────────────────────────────────────────────────

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def extract_bde(path):
    z = zipfile.ZipFile(path)
    strings = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    rows = ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//m:sheetData/m:row', NS)

    def values(row):
        out = {}
        for c in row.findall('m:c', NS):
            col = re.match(r'[A-Z]+', c.get('r')).group()
            v = c.find('m:v', NS)
            t = c.find('.//m:t', NS)
            out[col] = (strings[int(v.text)] if c.get('t') == 's' else v.text) if v is not None else (t.text if t is not None else '')
        return out

    header = values(rows[1])
    index = {v: k for k, v in header.items()}
    out = {}
    for row in rows[2:]:
        d = values(row)
        g = lambda h: (d.get(index.get(h, ''), '') or '').strip()  # noqa: E731
        if g('TIPO DOCUMENTO PRINCIPAL') != 'NIF' or g('FECHA BAJA') or g('PAÍS (ISO2)') != 'ES':
            continue
        nif = clean_nif(g('DOCUMENTO IDENTIFICATIVO'))
        if nif and g('NOMBRE'):
            out[nif] = {'nif': nif, 'name': g('NOMBRE'), 'web': g('PÁGINA WEB') or None, 'entity_type': g('TIPO ENTIDAD') or None}
    return out


def write_jsonl(path, items):
    with open(path, 'w', encoding='utf-8') as fh:
        for item in items.values():
            fh.write(json.dumps(item, ensure_ascii=False) + '\n')
    return len(items)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--placsp', nargs='*', default=[])
    ap.add_argument('--bdns', nargs='*', default=[])
    ap.add_argument('--invente')
    ap.add_argument('--bde')
    ap.add_argument('--out', required=True)
    args = ap.parse_args()
    os.makedirs(args.out, exist_ok=True)
    if args.placsp:
        awardees, bodies = extract_placsp(args.placsp)
        print('adjudicatarias', write_jsonl(os.path.join(args.out, 'es_awardees.jsonl'), awardees))
        print('órganos', write_jsonl(os.path.join(args.out, 'es_bodies.jsonl'), bodies))
    if args.bdns:
        print('BDNS', write_jsonl(os.path.join(args.out, 'es_bdns.jsonl'), extract_bdns(args.bdns)))
    if args.invente:
        print('INVENTE', write_jsonl(os.path.join(args.out, 'es_invente.jsonl'), extract_invente(args.invente)))
    if args.bde:
        print('Banco de España', write_jsonl(os.path.join(args.out, 'es_bde.jsonl'), extract_bde(args.bde)))


if __name__ == '__main__':
    sys.exit(main())
