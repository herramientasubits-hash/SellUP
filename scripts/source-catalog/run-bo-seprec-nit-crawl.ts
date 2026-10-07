/**
 * run-bo-seprec-nit-crawl.ts — Bolivia: NIT de grandes contribuyentes → ficha del SEPREC.
 *
 * SOURCES-BO-CLOSE-1. Bolivia no publica un padrón descargable. Los NIT de los
 * grandes contribuyentes sí son públicos (resoluciones PRICO/GRACO de Impuestos
 * Nacionales y listas PRIO/OEA de la Aduana), pero sin nombre. Este script le pone
 * nombre y actividad a cada NIT con la búsqueda pública del SEPREC por matrícula
 * (desde 2021 la matrícula de comercio ES el NIT), UNA vez, despacio:
 *
 *   1. `buscarEmpresas?tipoFiltro=matricula&filtro=<NIT>` → razón social, estado,
 *      tipo societario, departamento, matrícula renovada o no;
 *   2. sólo si está ACTIVA, no es unipersonal, la matrícula está renovada y la
 *      razón social NO basta para saber su industria («CONSTRUCTORA …»,
 *      «FARMACIA …» sí bastan): `informacionBasicaEmpresa` → NIT (confirmación) y
 *      objeto social. Así se ahorra casi la mitad de las peticiones (el SEPREC
 *      deja pasar pocas por minuto). Los contactos de la ficha NUNCA se leen.
 *
 * Autorizado por la dueña el 06-10 («adelante a lo que me recomiendes»): misma
 * búsqueda no documentada que ya usa la corrida, en lote y a ritmo lento.
 *
 * Ritmo: una petición cada `--gap-ms` (4 s por defecto); ante un 429 espera 60 s,
 * alarga el intervalo medio segundo (hasta 10 s) y reintenta; tras 5 fallos seguidos
 * se detiene. Reanudable: salta los NIT que ya están en el archivo de salida.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/run-bo-seprec-nit-crawl.ts \
 *     --in .tmp/bo/bo_large_taxpayer_nits.jsonl --out .tmp/bo/bo_seprec_by_nit.jsonl
 */

import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { BO_SEPREC_API_BASE } from '@/server/source-catalog/connectors/seprec-bolivia/seprec-name-live-query';
import { matchBoActivityRule } from '@/server/prospect-batches/country-source-discovery/bo-activity-macro-table';

const USER_AGENT = 'SellUp-source-catalog/1.0';
const RATE_LIMIT_WAIT_MS = 60_000;
const GAP_STEP_MS = 500;
const MAX_GAP_MS = 10_000;
const MAX_CONSECUTIVE_FAILURES = 5;
const REQUEST_TIMEOUT_MS = 15_000;

type InputRow = { nit: string; flags: string[] };

function arg(name: string, fallback?: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : fallback;
  if (value === undefined) throw new Error(`Falta --${name}`);
  return value;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function getJson(url: string): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const body = response.ok ? await response.json() : null;
    return { status: response.status, body };
  } catch {
    return { status: 0, body: null };
  }
}

function text(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const clean = String(value).replace(/\s+/g, ' ').trim();
  return clean.length > 0 ? clean : null;
}

function code(value: unknown): string | null {
  return text((value as { codigo?: unknown } | null | undefined)?.codigo);
}

function name(value: unknown): string | null {
  return text((value as { nombre?: unknown } | null | undefined)?.nombre);
}

async function main() {
  const inPath = arg('in');
  const outPath = arg('out');
  let gapMs = Number(arg('gap-ms', '4000'));
  const limit = Number(arg('limit', '0'));

  const done = new Set<string>();
  if (existsSync(outPath)) {
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
      if (line.trim().length === 0) continue;
      done.add((JSON.parse(line) as { nit: string }).nit);
    }
  }
  const todo = readFileSync(inPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as InputRow)
    .filter((row) => !done.has(row.nit));
  const queue = limit > 0 ? todo.slice(0, limit) : todo;
  console.log(`[bo-seprec-crawl] ya hechos ${done.size}, pendientes ${todo.length}, esta pasada ${queue.length}`);

  let failures = 0;
  const request = async (url: string, kind: string) => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = await getJson(url);
      await sleep(gapMs);
      if (result.status === 429) {
        gapMs = Math.min(MAX_GAP_MS, gapMs + GAP_STEP_MS);
        console.log(`[bo-seprec-crawl] 429 en ${kind} (${new Date().toISOString()}): espero 60 s; intervalo ahora ${gapMs} ms`);
        await sleep(RATE_LIMIT_WAIT_MS);
        continue;
      }
      return result;
    }
    return { status: 429, body: null };
  };

  let processed = 0;
  for (const row of queue) {
    const params = new URLSearchParams({ filtro: row.nit, tipoFiltro: 'matricula', limite: '5', pagina: '1' });
    const search = await request(`${BO_SEPREC_API_BASE}/buscarEmpresas?${params.toString()}`, 'búsqueda');
    if (search.status !== 200) {
      failures += 1;
      console.log(`[bo-seprec-crawl] ${row.nit}: búsqueda ${search.status} (${failures} seguidos)`);
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        console.log('[bo-seprec-crawl] demasiados fallos seguidos: me detengo (reanudable)');
        process.exitCode = 1;
        return;
      }
      continue;
    }
    failures = 0;
    const filas = (search.body as { datos?: { filas?: unknown[] } } | null)?.datos?.filas ?? [];
    const hit = (filas as Record<string, unknown>[]).find((fila) => text(fila['matricula']) === row.nit) ?? null;

    const record: Record<string, unknown> = { nit: row.nit, flags: row.flags, found: hit !== null };
    if (hit !== null) {
      const direccion = hit['direccion'] as Record<string, unknown> | undefined;
      Object.assign(record, {
        seprecId: text(hit['id']),
        establishmentId: text(hit['idEstablecimiento']),
        legalName: text(hit['razonSocial']),
        status: text(hit['estado']),
        unitTypeCode: code(hit['codTipoUnidadEconomica']),
        unitType: name(hit['codTipoUnidadEconomica']),
        renewalCode: code(hit['codEstadoActualizacion']),
        department: name(direccion?.['codDepartamento']),
      });
      const wantsDetail =
        record.status === 'ACTIVO' &&
        record.unitTypeCode !== '01' &&
        record.renewalCode === '0' &&
        record.seprecId !== null &&
        matchBoActivityRule(record.legalName as string | null, 'legal_name') === null;
      if (wantsDetail) {
        const establishment = (record.establishmentId ?? record.seprecId) as string;
        const detail = await request(
          `${BO_SEPREC_API_BASE}/informacionBasicaEmpresa/${encodeURIComponent(record.seprecId as string)}/establecimiento/${encodeURIComponent(establishment)}`,
          'ficha',
        );
        const datos = (detail.body as { datos?: Record<string, unknown> } | null)?.datos ?? null;
        record.detailStatus = detail.status;
        if (datos !== null) {
          // Sólo NIT, objeto social y año de actualización: los contactos nunca.
          const objetos = Array.isArray(datos['objetos_sociales']) ? (datos['objetos_sociales'] as unknown[]) : [];
          Object.assign(record, {
            detailNit: text(datos['nit'])?.replace(/\D/g, '') ?? null,
            socialPurpose: objetos
              .map((objeto) => text((objeto as { objetoSocial?: unknown } | null)?.objetoSocial))
              .filter((value): value is string => value !== null)
              .join(' | ')
              .slice(0, 2_000),
            lastUpdateYear: text(datos['ultimoAnioActualizacion']),
          });
        }
      }
    }
    appendFileSync(outPath, `${JSON.stringify(record)}\n`);
    processed += 1;
    if (processed % 50 === 0) console.log(`[bo-seprec-crawl] ${processed}/${queue.length}`);
  }
  console.log(`[bo-seprec-crawl] fin: ${processed} procesados`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
