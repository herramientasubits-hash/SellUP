# Capa común de listas curadas (SOURCES-LATAM-CURATED-1)

1. Descargar cada lista pública (curl con User-Agent de navegador; Merco necesita guardar cookies).
2. `python3 -I scripts/source-catalog/latam-curated/extract_lists.py <lista> --input=… --out=<lista>.jsonl`
3. `npx tsx scripts/source-catalog/run-latam-curated-etl.ts --entries=a.jsonl,b.jsonl[,…] [--sample]` (dry-run)
4. Con autorización de la dueña: añadir `--apply --env-dir=<carpeta con .env.local>`. Reemplaza los
   países presentes: correr SIEMPRE con todas las listas de esos países.

Consultas que no son una descarga directa:

- Wikidata (universidades): `wikidata-universities.rq` contra https://query.wikidata.org/sparql.
- IPS de Colombia con 50+ camas (datos.gov.co `s2ru-bqt6`, SoQL):
  `$select=nit_ips, max(num_digito_verificion) as dv, max(nombre_prestador) as nombre, max(naturaleza) as naturaleza, max(departamento) as departamento, max(municipio) as municipio, sum(num_cantidad_capacidad_instalada::number) as camas`
  `$where=nom_grupo_capacidad='CAMAS'` · `$group=nit_ips` · `$having=camas >= 50` · `$limit=5000`

Fuera, y por qué (08-10-2026): Pacto Global ONU (su robots.txt prohíbe rastrear el buscador),
ANUIES (directorio antiguo por formularios; reemplazado por Wikidata), MICI SEM Panamá (sin sector),
CNV Argentina y CMF Chile emisores (sin sector).
