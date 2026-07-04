/**
 * Honduras Contrataciones Abiertas — Dry-run script
 *
 * Lee una muestra controlada del feed anual .jsonl.gz desde OCP Registry.
 * NO escribe en Supabase. NO requiere service role. NO guarda archivos.
 * NO descarga el bulk completo.
 *
 * Uso:
 *   node --import tsx scripts/source-catalog/run-hn-contrataciones-dry-run.ts --year 2025 --max-lines 300
 *
 * Flags:
 *   --year        Año del feed (requerido)
 *   --max-lines   Máximo de líneas JSONL a leer (default 300, max 1000)
 *   --max-bytes   Máximo de bytes comprimidos a leer (default 4MB, max 10MB)
 *
 * Hito Centroamérica.8C.1
 */

import { createGunzip } from 'node:zlib';
import { processRelease, buildCandidates } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-adapter';
import { maskRtn } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-rtn-normalizer';
import { hnAnnualFeedUrl, HN_SOURCE_KEY } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-types';
import type { HnAdapterStats } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-adapter';
import type { HnDryRunSummary, OcdsRelease } from '../../src/server/source-catalog/connectors/hn-contrataciones-abiertas/hn-ocds-types';

const DEFAULT_MAX_LINES = 300;
const ABSOLUTE_MAX_LINES = 1000;
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const ABSOLUTE_MAX_BYTES = 10 * 1024 * 1024;
const SAMPLE_SUPPLIERS = 5;
const FETCH_TIMEOUT_MS = 30_000;
const USER_AGENT = 'SellUp/0.1 source-catalog-dry-run';

// ─── CLI args ──────────────────────────────────────────────────────────────────

function parseArgs(): { year: number; maxLines: number; maxBytes: number } {
  const args = process.argv.slice(2);
  let year: number | null = null;
  let maxLines = DEFAULT_MAX_LINES;
  let maxBytes = DEFAULT_MAX_BYTES;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--year' && args[i + 1]) {
      year = parseInt(args[++i], 10);
    } else if (arg === '--max-lines' && args[i + 1]) {
      maxLines = Math.min(parseInt(args[++i], 10), ABSOLUTE_MAX_LINES);
    } else if (arg === '--max-bytes' && args[i + 1]) {
      maxBytes = Math.min(parseInt(args[++i], 10), ABSOLUTE_MAX_BYTES);
    }
  }

  if (!year || isNaN(year) || year < 2010 || year > 2030) {
    console.error('Error: --year requerido y debe ser un año válido (2010–2030)');
    process.exit(1);
  }

  return { year, maxLines, maxBytes };
}

// ─── Streaming JSONL.GZ ────────────────────────────────────────────────────────

/**
 * Lee líneas JSONL desde un stream HTTP comprimido con gzip.
 * Corta al alcanzar maxLines o maxBytes comprimidos.
 * Retorna las líneas crudas (strings).
 */
async function streamJsonlGzLines(
  url: string,
  maxLines: number,
  maxBytes: number,
): Promise<{ lines: string[]; bytesRead: number; truncated: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let bytesRead = 0;
  let truncated = false;
  const lines: string[] = [];

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status} al descargar ${url}`);
    }

    const reader = resp.body?.getReader();
    if (!reader) throw new Error('No readable body en response');

    const gunzip = createGunzip();
    let leftover = '';

    const decompressed: string[] = [];

    await new Promise<void>((resolve, reject) => {
      gunzip.on('data', (chunk: Buffer) => {
        leftover += chunk.toString('utf-8');
        const parts = leftover.split('\n');
        leftover = parts.pop() ?? '';
        for (const part of parts) {
          const trimmed = part.trim();
          if (trimmed) decompressed.push(trimmed);
        }
      });
      gunzip.on('end', resolve);
      gunzip.on('error', (err) => {
        // Truncated gzip streams throw "unexpected end of file" — expected when
        // we cut the download at maxBytes. Resolve with what we collected so far.
        if (truncated) { resolve(); return; }
        reject(err);
      });

      (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            bytesRead += value.byteLength;
            gunzip.write(value);
            if (bytesRead >= maxBytes) {
              truncated = true;
              reader.cancel();
              break;
            }
          }
          gunzip.end();
        } catch (err) {
          gunzip.destroy(err instanceof Error ? err : new Error(String(err)));
          reject(err);
        }
      })();
    });

    // Flush leftover
    if (leftover.trim()) decompressed.push(leftover.trim());

    for (const line of decompressed) {
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
      lines.push(line);
    }

    return { lines, bytesRead, truncated };
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const { year, maxLines, maxBytes } = parseArgs();
  const url = hnAnnualFeedUrl(year);

  console.log('\n── Honduras Contrataciones Abiertas — Dry-run ──────────────────');
  console.log(`source_key : ${HN_SOURCE_KEY}`);
  console.log(`year       : ${year}`);
  console.log(`url        : ${url}`);
  console.log(`max_lines  : ${maxLines}`);
  console.log(`max_bytes  : ${(maxBytes / 1024 / 1024).toFixed(1)} MB`);
  console.log('writes     : 0 (dry-run)');
  console.log('────────────────────────────────────────────────────────────────\n');

  let lines: string[];
  let bytesRead: number;
  let truncated: boolean;

  try {
    console.log('Conectando a OCP Registry…');
    ({ lines, bytesRead, truncated } = await streamJsonlGzLines(url, maxLines, maxBytes));
    console.log(`Bytes comprimidos leídos: ${(bytesRead / 1024).toFixed(1)} KB${truncated ? ' (truncado)' : ''}`);
    console.log(`Líneas JSONL obtenidas: ${lines.length}\n`);
  } catch (err) {
    console.error('Error al conectar con OCP Registry:', err instanceof Error ? err.message : String(err));
    console.error(`URL intentada: ${url}`);
    process.exit(1);
  }

  const acc = new Map();
  const totals: HnAdapterStats = {
    partiesSeen: 0,
    supplierOrTendererSeen: 0,
    hnRtnSeen: 0,
    validRtn: 0,
    invalidRtn: 0,
    legacySchemeIgnored: 0,
  };
  let linesRead = 0;
  let parseErrors = 0;

  for (const line of lines) {
    linesRead++;
    let release: OcdsRelease;
    try {
      release = JSON.parse(line) as OcdsRelease;
    } catch {
      parseErrors++;
      continue;
    }
    const stats = processRelease(release, acc);
    totals.partiesSeen += stats.partiesSeen;
    totals.supplierOrTendererSeen += stats.supplierOrTendererSeen;
    totals.hnRtnSeen += stats.hnRtnSeen;
    totals.validRtn += stats.validRtn;
    totals.invalidRtn += stats.invalidRtn;
    totals.legacySchemeIgnored += stats.legacySchemeIgnored;
  }

  const candidates = buildCandidates(acc);
  const legalEntities = candidates.filter((c) => c.legalEntityHint === 'likely_legal_entity');
  const personRisk = candidates.filter((c) => c.legalEntityHint === 'unknown_or_person_natural_risk');

  const sampleMasked = candidates
    .slice(0, SAMPLE_SUPPLIERS)
    .map((c) => `${maskRtn(c.normalizedRtn)} — ${c.supplierName.slice(0, 40)}`);

  const summary: HnDryRunSummary = {
    source_key: HN_SOURCE_KEY,
    year,
    lines_read: linesRead,
    parties_seen: totals.partiesSeen,
    supplier_or_tenderer_seen: totals.supplierOrTendererSeen,
    hn_rtn_seen: totals.hnRtnSeen,
    valid_rtn_count: totals.validRtn,
    invalid_rtn_count: totals.invalidRtn,
    legacy_scheme_ignored: totals.legacySchemeIgnored,
    unique_valid_rtn: acc.size,
    likely_legal_entity_count: legalEntities.length,
    unknown_or_person_natural_risk_count: personRisk.length,
    sample_masked_suppliers: sampleMasked,
    writes_performed: 0,
  };

  console.log('── Resumen ──────────────────────────────────────────────────────');
  for (const [k, v] of Object.entries(summary)) {
    if (k === 'sample_masked_suppliers') continue;
    console.log(`  ${k.padEnd(38)}: ${v}`);
  }

  if (parseErrors > 0) {
    console.log(`  ${'parse_errors'.padEnd(38)}: ${parseErrors}`);
  }
  if (truncated) {
    console.log(`  ${'truncated'.padEnd(38)}: true (límite alcanzado)`);
  }

  console.log('\n── Muestra proveedores (RTN enmascarado) ────────────────────────');
  if (sampleMasked.length === 0) {
    console.log('  (sin proveedores con HN-RTN válido en la muestra)');
  } else {
    for (const s of sampleMasked) {
      console.log(`  ${s}`);
    }
  }

  console.log('\nDry-run completado. writes_performed: 0');
}

main().catch((err) => {
  console.error('Error fatal:', err);
  process.exit(1);
});
