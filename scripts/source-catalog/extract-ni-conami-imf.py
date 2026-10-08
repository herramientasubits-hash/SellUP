#!/usr/bin/env python3
"""
NI — instituciones de microfinanzas registradas en la CONAMI (SOURCES-NI-CLOSE-2).

La Comisión Nacional de Microfinanzas publica su registro en su sitio
(https://www.conami.gob.ni) y lo sirve como JSON en `api/imf-registradas/`
(accesible desde fuera de Nicaragua, medido el 07-10-2026): nombre, razón social,
fecha de inscripción, web, categoría y subcategoría. No trae RUC ni trabajadores.

Salida (`--out=<carpeta>`): `ni_conami_imf.jsonl` con
{name, legal_name, url, category, subcategory, registered_on}. No se guardan
teléfonos ni direcciones.

Uso:
  python3 scripts/source-catalog/extract-ni-conami-imf.py --out=.tmp/ni
"""

import argparse
import json
import os
import sys
import urllib.request

API = 'https://www.conami.gob.ni/api/imf-registradas/'


def clean(value):
    text = ' '.join(str(value).split()) if value is not None else ''
    return text or None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', required=True)
    parser.add_argument('--json', default=None, help='respuesta ya descargada (opcional)')
    args = parser.parse_args()
    if args.json:
        with open(args.json, encoding='utf-8') as f:
            items = json.load(f)
    else:
        req = urllib.request.Request(API, headers={'User-Agent': 'SellUp source catalog', 'Accept': 'application/json'})
        with urllib.request.urlopen(req, timeout=60) as resp:
            items = json.loads(resp.read().decode('utf-8'))
    if not isinstance(items, list) or not items:
        sys.exit('respuesta vacía o inesperada de la CONAMI')
    os.makedirs(args.out, exist_ok=True)
    path = os.path.join(args.out, 'ni_conami_imf.jsonl')
    with open(path, 'w', encoding='utf-8') as out:
        for item in items:
            out.write(json.dumps({
                'name': clean(item.get('nombre_institucion')),
                'legal_name': clean(item.get('razon_social')),
                'url': clean(item.get('url')),
                'category': clean(item.get('categoria')),
                'subcategory': clean(item.get('subcategoria')),
                'registered_on': clean(item.get('fecha_inscripcion')),
            }, ensure_ascii=False) + '\n')
    with_url = sum(1 for item in items if clean(item.get('url')))
    print(f'{path}: {len(items)} instituciones, {with_url} con web', file=sys.stderr)


if __name__ == '__main__':
    main()
