#!/usr/bin/env python3
"""
NI — licencias sanitarias de establecimientos del MINSA (SOURCES-NI-CLOSE-2).

Consulta pública de la Autoridad Nacional de Regulación Sanitaria (sistema KARPLUS):
https://karplus.minsa.net.ni/kp-public/consultapublica/registroestablecimiento/indexConsultaLicencia.xhtml

Sin usuario ni captcha y accesible desde fuera de Nicaragua (medido el 07-10-2026).
Cada fila trae número de licencia, área de emisión, nombre comercial, razón social,
dirección, RUC, tipo de establecimiento, categoría y estado. Se piden los cuatro
tipos de licencia (farmacia, dispositivo médico, habilitación de establecimientos de
salud y alimentos y bebidas), página por página, despacio.

Salida (`--out=<carpeta>`): `ni_minsa_licenses.jsonl`, una línea por licencia de una
PERSONA JURÍDICA (RUC «J» + 13 dígitos). Las licencias de personas naturales (cédula)
se cuentan y se descartan: nunca se guarda un nombre o una cédula de una persona.
La dirección tampoco se guarda (puede ser la de una vivienda).

Uso:
  python3 scripts/source-catalog/extract-ni-minsa-licenses.py --out=.tmp/ni
"""

import argparse
import html
import http.cookiejar
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

BASE = 'https://karplus.minsa.net.ni'
PAGE = BASE + '/kp-public/consultapublica/registroestablecimiento/indexConsultaLicencia.xhtml'
LICENSE_TYPES = {
    'PRF': 'farmacia',
    'PDM': 'dispositivo_medico',
    'SES': 'establecimiento_salud',
    'EAB': 'alimentos_bebidas',
}
TABLE = 'frmConsultaLicencia:dtConsultaLicenciaSanitaria'
# La tabla sólo pagina con su tamaño de página configurado (10 filas).
ROWS_PER_PAGE = 10
PAUSE_SECONDS = 1.0
JURIDICAL_RUC = re.compile(r'^J\d{13}$')
COLUMNS = ['license', 'area', 'trade_name', 'name', 'address', 'ruc', 'establishment_type', 'category', 'status']


def opener():
    jar = http.cookiejar.CookieJar()
    o = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    o.addheaders = [('User-Agent', 'SellUp source catalog (consulta publica)')]
    return o


def post(o, action, fields, ajax=True):
    data = urllib.parse.urlencode(fields).encode()
    req = urllib.request.Request(BASE + action, data=data)
    if ajax:
        req.add_header('Faces-Request', 'partial/ajax')
        req.add_header('X-Requested-With', 'XMLHttpRequest')
    with o.open(req, timeout=120) as resp:
        return resp.read().decode('utf-8', errors='replace')


def text(cell):
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', cell)).split())


def parse_rows(body):
    rows = []
    for row in re.findall(r'<tr data-ri="\d+"[^>]*>(.*?)</tr>', body, re.S):
        cells = [text(c) for c in re.findall(r'<td[^>]*>(.*?)</td>', row, re.S)]
        if len(cells) == len(COLUMNS):
            rows.append(dict(zip(COLUMNS, cells)))
    return rows


def form_fields(view_state, license_type):
    return {
        'frmConsultaLicencia': 'frmConsultaLicencia',
        'frmConsultaLicencia:nom_prod': '',
        'frmConsultaLicencia:som_tipoLic_focus': '',
        'frmConsultaLicencia:som_tipoLic_input': license_type,
        'frmConsultaLicencia:itRazonSocial': '',
        'javax.faces.ViewState': view_state,
    }


def extract_type(license_type):
    o = opener()
    with o.open(PAGE, timeout=60) as resp:
        page = resp.read().decode('utf-8', errors='replace')
    view_state = re.search(r'javax\.faces\.ViewState:0" value="([^"]*)', page).group(1)
    action = html.unescape(re.search(r'<form id="frmConsultaLicencia"[^>]*action="([^"]*)', page).group(1))
    fields = form_fields(view_state, license_type)
    first = post(o, action, {
        **fields,
        'javax.faces.partial.ajax': 'true',
        'javax.faces.source': 'frmConsultaLicencia:buscarListaLicencia',
        'javax.faces.partial.execute': '@all',
        'javax.faces.partial.render': TABLE + ' frmConsultaLicencia:pnAcciones',
        'frmConsultaLicencia:buscarListaLicencia': 'frmConsultaLicencia:buscarListaLicencia',
    })
    total = int(re.search(r'rowCount:(\d+)', first).group(1))
    rows = []
    for start in range(0, total, ROWS_PER_PAGE):
        time.sleep(PAUSE_SECONDS)
        body = post(o, action, {
            **fields,
            'javax.faces.partial.ajax': 'true',
            'javax.faces.source': TABLE,
            'javax.faces.partial.execute': TABLE,
            'javax.faces.partial.render': TABLE,
            'javax.faces.behavior.event': 'page',
            'javax.faces.partial.event': 'page',
            TABLE + '_pagination': 'true',
            TABLE + '_first': str(start),
            TABLE + '_rows': str(ROWS_PER_PAGE),
            TABLE + '_encodeFeature': 'true',
        })
        rows.extend(parse_rows(body))
    return total, rows


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    out_path = os.path.join(args.out, 'ni_minsa_licenses.jsonl')
    kept = 0
    with open(out_path, 'w', encoding='utf-8') as out:
        for code, kind in LICENSE_TYPES.items():
            total, rows = extract_type(code)
            juridical = 0
            for row in rows:
                ruc = re.sub(r'[\s.-]', '', row['ruc']).upper()
                if not JURIDICAL_RUC.match(ruc):
                    continue
                juridical += 1
                out.write(json.dumps({
                    'ruc': ruc,
                    'name': row['name'] or None,
                    'trade_name': row['trade_name'] or None,
                    'license_type': kind,
                    'license': row['license'] or None,
                    'establishment_type': row['establishment_type'] or None,
                    'category': row['category'][:200] or None,
                    'status': row['status'] or None,
                }, ensure_ascii=False) + '\n')
            kept += juridical
            print(f'{code} ({kind}): {total} licencias, {len(rows)} leídas, {juridical} de personas jurídicas', file=sys.stderr)
            if len(rows) != total:
                print(f'  AVISO: se leyeron {len(rows)} de {total}', file=sys.stderr)
    print(f'{out_path}: {kept} licencias de personas jurídicas', file=sys.stderr)


if __name__ == '__main__':
    main()
