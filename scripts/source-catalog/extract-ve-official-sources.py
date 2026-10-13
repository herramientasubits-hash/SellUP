"""VE — extractor de las fuentes de Venezuela (SOURCES-VE-CLOSE-1).

Descarga y deja en JSONL (una línea por entidad, SÓLO datos de empresa: nunca
correos completos, teléfonos, direcciones ni nombres de personas):

  ve_bvc_issuers.jsonl  Bolsa de Caracas — emisoras (RIF, sector, objeto social, web,
                        dominio de sus correos). Consulta pública de su propia web
                        (`/wp-admin/admin-ajax.php`, permitida por su robots.txt).
  ve_bvc_members.jsonl  Bolsa de Caracas — casas de bolsa miembros.
  ve_sudeaseg.jsonl     SUDEASEG — sujetos regulados PERSONAS JURÍDICAS (la página
                        trae también ~9.800 personas naturales: se descartan sin leer).
  ve_sunaval.jsonl      SUNAVAL — registros del Internet Archive (03-07-2022): el sitio
                        en vivo no responde.
  ve_gleif.jsonl        GLEIF — personas jurídicas venezolanas con LEI (API pública).

Ritmo: 2 s entre peticiones al mismo sitio. Sin captchas ni saltos de bloqueos.

Uso:  python3 -I scripts/source-catalog/extract-ve-official-sources.py --out=<carpeta>
"""

import json
import re
import sys
import time
import urllib.parse
import urllib.request

UA = 'Mozilla/5.0 (SellUp source verification)'
BVC_URL = 'https://www.bolsadecaracas.com/wp-admin/admin-ajax.php'
SUDEASEG_URL = 'https://www.sudeaseg.gob.ve/sujetos-regulados'
SUNAVAL_PAGES = [
    ('20220703213903', 'data_entes.php', 'emisor'),
    ('20220703214046', 'data_fondomutual.php', 'fondo_mutual'),
    ('20220703214121', 'data_SocieAdm.php', 'sociedad_administradora'),
    ('20220703214141', 'data_caliriesgo.php', 'calificadora'),
    ('20220703213924', 'data_AsesoInver.php', 'asesor_inversion'),
    ('20220703214025', 'data_FirmConta.php', 'firma_contadores'),
]
GLEIF_URL = 'https://api.gleif.org/api/v1/lei-records?filter%5Bentity.legalAddress.country%5D=VE&page%5Bsize%5D=100&page%5Bnumber%5D={page}'
PAUSE_S = 2


def http(url, data=None, accept='application/json'):
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    headers = {'User-Agent': UA, 'Accept': accept}
    if body is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    with urllib.request.urlopen(urllib.request.Request(url, data=body, headers=headers), timeout=60) as response:
        return response.read().decode('utf-8', 'replace')


def email_domain(value):
    value = (value or '').strip()
    return value.split('@', 1)[1].lower() if '@' in value else None


def write_jsonl(path, rows):
    with open(path, 'w', encoding='utf-8') as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + '\n')
    print(f'  {path}: {len(rows)}')


def extract_bvc(out):
    issuers = []
    for listed in json.loads(http(BVC_URL, {'action': 'listadoEmisoras'})):
        time.sleep(PAUSE_S)
        detail = json.loads(http(BVC_URL, {'action': 'detalleEmisoras', 'data': listed['COD_EMP']}))
        detail = detail[0] if isinstance(detail, list) and detail else (detail or {})
        issuers.append({
            'code': listed['COD_EMP'],
            'name': detail.get('DESC_EMP') or listed['DESC_EMP'],
            'rif': detail.get('RIF'),
            'sector': detail.get('DESC_SECTOR'),
            'activity': (detail.get('ACTIVIDAD') or '').strip() or None,
            'web': detail.get('PAGINA_WEB'),
            'email_domains': sorted({d for d in (email_domain(detail.get(k)) for k in ('E_MAIL_1', 'E_MAIL_2', 'E_MAIL_3')) if d}),
        })
    write_jsonl(f'{out}/ve_bvc_issuers.jsonl', issuers)
    members = []
    time.sleep(PAUSE_S)
    for listed in json.loads(http(BVC_URL, {'action': 'getMiembros'}))['cur_miembros_bvc']:
        time.sleep(PAUSE_S)
        detail = json.loads(http(BVC_URL, {'action': 'getMiembroByID', 'id_miembro': listed['COD_MA']}))
        members.append({
            'code': listed['COD_MA'],
            'name': detail.get('EMPRESA') or listed['EMPRESA'],
            'status': detail.get('EDO_PORTAL'),
            'rif': detail.get('RIF'),
            'web': detail.get('PAGINA_WEB'),
            'activity': detail.get('ACTIVIDAD'),
            'email_domains': sorted({d for d in (email_domain(detail.get(k)) for k in ('E_MAIL_1', 'E_MAIL_2')) if d}),
        })
    write_jsonl(f'{out}/ve_bvc_members.jsonl', members)


SUDEASEG_ROW = re.compile(
    r'\{"id":(\d+),"nombre":"([^"]*)","identificacion":"([^"]*)","credencial":"([^"]*)",'
    r'"tipoSujeto":"([^"]*)","categoriaId":"([^"]*)","estado":"([^"]*)"\}'
)


def extract_sudeaseg(out):
    page = http(SUDEASEG_URL, accept='text/html').replace('\\"', '"').replace('\\u0026', '&')
    rows = {}
    for match in SUDEASEG_ROW.finditer(page):
        entity_id, name, rif, credential, kind, category, status = match.groups()
        if kind != 'juridica':
            continue  # Personas naturales: nunca se guardan.
        rows[entity_id] = {'id': entity_id, 'name': name, 'rif': rif, 'credential': credential, 'category': category, 'status': status}
    write_jsonl(f'{out}/ve_sudeaseg.jsonl', list(rows.values()))


def extract_sunaval(out):
    rows = []
    for stamp, page, kind in SUNAVAL_PAGES:
        url = f'https://web.archive.org/web/{stamp}id_/https://www.sunaval.gob.ve/{page}'
        for entry in json.loads(http(url))['aaData']:
            rows.append({'kind': kind, 'name': entry.get('nombre'), 'rif': entry.get('rif'), 'status': entry.get('estado'), 'archive': url})
        time.sleep(PAUSE_S)
    write_jsonl(f'{out}/ve_sunaval.jsonl', rows)


def extract_gleif(out):
    rows, page = [], 1
    while True:
        data = json.loads(http(GLEIF_URL.format(page=page), accept='application/vnd.api+json'))
        for record in data['data']:
            attributes = record['attributes']
            entity = attributes['entity']
            rows.append({
                'lei': attributes['lei'],
                'name': entity['legalName']['name'],
                'other_names': [other['name'] for other in entity.get('otherNames') or []],
                'registered_as': entity.get('registeredAs'),
                'entity_status': entity.get('status'),
                'registration_status': attributes['registration']['status'],
            })
        if page >= data['meta']['pagination']['lastPage']:
            break
        page += 1
        time.sleep(PAUSE_S)
    write_jsonl(f'{out}/ve_gleif.jsonl', rows)


def main():
    out = next((arg.split('=', 1)[1] for arg in sys.argv[1:] if arg.startswith('--out=')), None)
    if not out:
        sys.exit('config_invalid: falta --out=<carpeta>')
    print('VE — extractor de fuentes')
    extract_bvc(out)
    extract_sudeaseg(out)
    extract_sunaval(out)
    extract_gleif(out)


if __name__ == '__main__':
    main()
