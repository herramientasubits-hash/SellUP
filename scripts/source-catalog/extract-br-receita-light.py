"""Receita CNPJ — extractor del subconjunto LIVIANO de Brasil (SOURCES-BR-LIGHT-1).

Lee los zips públicos del cadastro CNPJ (arquivos.receitafederal.gov.br,
Dados/Cadastros/CNPJ/<AAAA-MM>) ARCHIVO POR ARCHIVO, en streaming, sin descomprimir
a disco, y escribe un TSV con la MATRIZ ACTIVA de:
  - sociedades privadas (naturaleza 2xxx, salvo el empresário individual 2135) con
    porte 05 (DEMAIS: ni ME ni EPP);
  - entes públicos (naturaleza 1xxx).

Privacidad: del correo sólo sale el DOMINIO (nunca la dirección); no se leen
teléfonos, direcciones ni el archivo de socios.

Uso:
  python3 -I scripts/source-catalog/extract-br-receita-light.py <carpeta_zips> <salida.tsv>

La carpeta debe tener Empresas0..9.zip, Estabelecimentos0..9.zip, Cnaes.zip y
Municipios.zip. Memoria: ~5,5 GB de pico; tiempo: ~8 min (medido el 13-10-2026).
El TSV lo consume scripts/source-catalog/run-br-receita-light-etl.ts.
"""
import csv
import io
import subprocess
import sys
from collections import Counter
from pathlib import Path

INDIVIDUAL_ENTREPRENEUR = '2135'
COLUMNS = [
    'cnpj', 'razao_social', 'nome_fantasia', 'natureza', 'capital', 'porte', 'data_inicio', 'cnae',
    'cnae_descricao', 'uf', 'municipio', 'email_domain', 'filiais_ativas', 'pais',
]


def rows(zip_path: Path):
    """Filas de un zip de la Receita (latin-1, «;», con bytes nulos sueltos)."""
    proc = subprocess.Popen(['unzip', '-p', str(zip_path)], stdout=subprocess.PIPE)
    text = io.TextIOWrapper(proc.stdout, encoding='latin-1', newline='')
    yield from csv.reader((line.replace('\0', '') for line in text), delimiter=';')
    if proc.wait() != 0:
        raise RuntimeError(f'unzip_failed:{zip_path.name}')


def capital(value: str) -> float:
    try:
        return float(value.replace('.', '').replace(',', '.') or 0)
    except ValueError:
        return 0.0


def email_domain(raw: str) -> str:
    raw = raw.strip().lower()
    if '@' not in raw:
        return ''
    domain = raw.rsplit('@', 1)[1].strip('. ')
    return domain if '.' in domain and ' ' not in domain else ''


def eligible(natureza: str, porte: str) -> bool:
    if natureza.startswith('1'):
        return True
    return natureza.startswith('2') and natureza != INDIVIDUAL_ENTREPRENEUR and porte == '05'


def lookup(zip_path: Path) -> dict[str, str]:
    return {r[0]: r[1] for r in rows(zip_path) if len(r) >= 2}


def main() -> None:
    zips, out = Path(sys.argv[1]), Path(sys.argv[2])
    needed = [f'Empresas{i}.zip' for i in range(10)] + [f'Estabelecimentos{i}.zip' for i in range(10)] + [
        'Cnaes.zip', 'Municipios.zip']
    missing = [name for name in needed if not (zips / name).exists()]
    if missing:
        raise SystemExit(f'config_invalid: faltan {", ".join(missing)}')
    cnaes, municipios = lookup(zips / 'Cnaes.zip'), lookup(zips / 'Municipios.zip')
    stats: Counter = Counter()

    keep: dict[str, str] = {}
    for i in range(10):
        for r in rows(zips / f'Empresas{i}.zip'):
            if len(r) < 6:
                stats['empresas_bad_row'] += 1
                continue
            stats['empresas'] += 1
            if eligible(r[2], r[5]):
                keep[r[0]] = f'{r[2]}|{capital(r[4]):.2f}|{r[5]}'
        print('empresas', i, len(keep), flush=True)

    branches: Counter = Counter()
    head: dict[str, tuple] = {}
    for i in range(10):
        for r in rows(zips / f'Estabelecimentos{i}.zip'):
            if len(r) < 28:
                stats['estab_bad_row'] += 1
                continue
            if r[5] != '02' or r[0] not in keep:
                continue
            if r[3] == '2':
                branches[r[0]] += 1
            elif r[3] == '1':
                head[r[0]] = (r[0] + r[1] + r[2], r[4], r[10], r[11], r[19], municipios.get(r[20], ''),
                              email_domain(r[27]), r[9])
        print('estabelecimentos', i, len(head), flush=True)

    legal: dict[str, str] = {}
    for i in range(10):
        for r in rows(zips / f'Empresas{i}.zip'):
            if len(r) >= 6 and r[0] in head:
                legal[r[0]] = r[1]

    with open(out, 'w', encoding='utf-8') as fh:
        writer = csv.writer(fh, delimiter='\t', lineterminator='\n', quoting=csv.QUOTE_MINIMAL)
        writer.writerow(COLUMNS)
        for basico, h in head.items():
            natureza, cap, porte = keep[basico].split('|')
            writer.writerow([h[0], legal.get(basico, ''), h[1], natureza, cap, porte, h[2], h[3],
                             cnaes.get(h[3], ''), h[4], h[5], h[6], branches.get(basico, 0), h[7]])
    print('done', len(head), dict(stats))


if __name__ == '__main__':
    main()
