/**
 * BR-SOURCE FUNCTIONAL CUT E — COBERTURA POR NOMBRE: cuánto alcanza `legal_name` exacto, y qué
 * podría añadir `nome_fantasia` (§ 11–§ 13 del encargo).
 *
 * ── La pregunta ─────────────────────────────────────────────────────────────
 *
 * CUT C resuelve un candidato brasileño sin CNPJ por razão social EXACTA dentro de la publicación
 * fijada. La pregunta que decide si hace falta `nome_fantasia` no es de diseño, es de DATOS:
 *
 *     de los nombres que el discovery REAL produce, ¿cuántos coinciden con una razão social?
 *
 * Y esa pregunta tiene un requisito que no se puede rodear: hace falta una muestra de nombres de
 * discovery REAL. Sin ella, cualquier número que este script imprimiese sería una respuesta a otra
 * pregunta disfrazada de respuesta a esta.
 *
 * ── 🔴 Lo que este script NO hace ───────────────────────────────────────────
 *
 *   · NO llama a Apollo, ni a Lusha, ni a ningún proveedor. Cero peticiones de red.
 *   · NO lee Producción. El corpus de candidatos sale de un fichero LOCAL o no sale.
 *   · NO implementa `nome_fantasia`: no lo persiste, no lo añade al snapshot, no lo mete en el
 *     adaptador y no toca GATE-3. Lo lee, cuenta, y lo deja caer.
 *   · NO inventa una conclusión: sin corpus, el veredicto es `STILL_UNKNOWN`, y eso es un
 *     resultado, no un fallo.
 *
 * ── 🔴 Privacidad (§ 14) ────────────────────────────────────────────────────
 *
 * La salida son CONTEOS, RATIOS y CATEGORÍAS. Ni una razão social, ni un nome fantasia, ni un
 * CNPJ, ni una ciudad concreta, ni una fila. El corpus se lee, se cuenta y no se reimprime.
 *
 * Uso:
 *   npm run br-source:cut-e-name-coverage
 *   SELLUP_BR_CANDIDATE_NAMES_FILE=/ruta/al/corpus.json npm run br-source:cut-e-name-coverage
 *
 * El corpus, si existe, es JSON: `[{ "name": "...", "city": "..." }, ...]` o `["...", ...]`.
 */

import { readFile } from 'node:fs/promises';

import {
  buildCutERealSnapshots,
  CUT_E_DEFAULT_BOUNDS,
  extractCutERealSample,
  resolveCutERealDataset,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/__tests__/support/br-receita-cut-e-real-sample';
import {
  normalizeBrCompanyLegalName,
  normalizeBrMunicipalityName,
} from '../../src/server/source-catalog/connectors/br-receita-cnpj/br-receita-cnpj-name-normalization';

/** El fichero de corpus. Un ENV lo señala; nada lo incrusta y nada lo descarga. */
const CANDIDATE_CORPUS_ENV = 'SELLUP_BR_CANDIDATE_NAMES_FILE';

interface CandidateName {
  readonly name: unknown;
  readonly city?: unknown;
}

/** Lee el corpus LOCAL de nombres de discovery, o declara que no hay. */
async function loadCandidateCorpus(): Promise<{
  readonly candidates: readonly CandidateName[];
  readonly source: string;
}> {
  const path = process.env[CANDIDATE_CORPUS_ENV];
  if (path === undefined || path.trim() === '') {
    return { candidates: [], source: 'none_declared' };
  }
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    if (!Array.isArray(parsed)) return { candidates: [], source: 'corpus_not_an_array' };
    return {
      candidates: parsed.map((entry) =>
        typeof entry === 'string' ? { name: entry } : (entry as CandidateName),
      ),
      source: 'local_file',
    };
  } catch {
    return { candidates: [], source: 'corpus_unreadable' };
  }
}

function ratio(numerator: number, denominator: number): string {
  if (denominator === 0) return 'n/a';
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

async function main(): Promise<void> {
  const resolved = await resolveCutERealDataset();
  if (resolved.skip !== false) {
    process.stdout.write(`REFUSED dataset_unavailable\n`);
    process.exitCode = 2;
    return;
  }

  const sample = await extractCutERealSample(resolved.layout, CUT_E_DEFAULT_BOUNDS);
  const built = buildCutERealSnapshots(sample);

  // ── El índice de la publicación local, por nombre canónico. ──
  const municipalityByCode = new Map(
    sample.municipalities.map((row) => [row.codigo, row.descricao]),
  );
  const byLegalName = new Map<string, string[]>();
  for (const snapshot of built.snapshots) {
    const canonical = normalizeBrCompanyLegalName(snapshot.legal_name);
    if (canonical.status !== 'valid') continue;
    const municipality = normalizeBrMunicipalityName(
      municipalityByCode.get(snapshot.raw_data.municipality_code ?? '') ?? null,
    );
    const cities = byLegalName.get(canonical.normalized);
    const city = municipality.status === 'valid' ? municipality.normalized : '';
    if (cities === undefined) byLegalName.set(canonical.normalized, [city]);
    else cities.push(city);
  }

  // ── El índice TRANSITORIO de nome fantasia (§ 12). Vive en esta función y muere con ella. ──
  const byTradeName = new Map<string, number>();
  let tradeNamePresent = 0;
  for (const establishment of sample.establishments) {
    if (establishment.nomeFantasia === '') continue;
    tradeNamePresent += 1;
    const canonical = normalizeBrCompanyLegalName(establishment.nomeFantasia);
    if (canonical.status !== 'valid') continue;
    byTradeName.set(canonical.normalized, (byTradeName.get(canonical.normalized) ?? 0) + 1);
  }

  const { candidates, source } = await loadCandidateCorpus();

  process.stdout.write('BR-SOURCE FUNCTIONAL CUT E — NAME COVERAGE\n');
  process.stdout.write('==========================================\n\n');
  process.stdout.write('PUBLICATION (local, bounded sample)\n');
  process.stdout.write(`  PUBLISHED_ESTABLISHMENTS       = ${built.snapshots.length}\n`);
  process.stdout.write(`  DISTINCT_CANONICAL_LEGAL_NAMES = ${byLegalName.size}\n`);

  // ── El TECHO estructural: qué haría un candidato con la razão social PERFECTA. ──
  let ceilingUnique = 0;
  let ceilingCityResolvable = 0;
  let ceilingAmbiguous = 0;
  for (const cities of byLegalName.values()) {
    if (cities.length === 1) {
      ceilingUnique += 1;
      continue;
    }
    const counts = new Map<string, number>();
    for (const city of cities) if (city !== '') counts.set(city, (counts.get(city) ?? 0) + 1);
    if ([...counts.values()].some((count) => count === 1)) ceilingCityResolvable += 1;
    else ceilingAmbiguous += 1;
  }
  process.stdout.write('\nSTRUCTURAL CEILING (a candidate carrying the EXACT razão social)\n');
  process.stdout.write(
    '  🔴 NOT the § 11 measurement. This is what the DATA allows, not what discovery produces.\n',
  );
  process.stdout.write(
    `  RESOLVABLE_WITHOUT_CITY  = ${ceilingUnique} (${ratio(ceilingUnique, byLegalName.size)})\n`,
  );
  process.stdout.write(
    `  RESOLVABLE_WITH_CITY     = ${ceilingCityResolvable} (${ratio(ceilingCityResolvable, byLegalName.size)})\n`,
  );
  process.stdout.write(
    `  AMBIGUOUS_EVEN_WITH_CITY = ${ceilingAmbiguous} (${ratio(ceilingAmbiguous, byLegalName.size)})\n`,
  );

  process.stdout.write('\nTRADE NAME AVAILABILITY (transient, never persisted)\n');
  process.stdout.write(
    `  ESTABLISHMENTS_WITH_TRADE_NAME = ${tradeNamePresent} ` +
      `(${ratio(tradeNamePresent, sample.establishments.length)})\n`,
  );
  process.stdout.write(`  DISTINCT_CANONICAL_TRADE_NAMES = ${byTradeName.size}\n`);
  // El techo de lo que `nome_fantasia` podría añadir: formas que NO existen como razão social.
  let tradeOnlyForms = 0;
  for (const form of byTradeName.keys()) if (!byLegalName.has(form)) tradeOnlyForms += 1;
  process.stdout.write(
    `  TRADE_NAME_FORMS_NOT_PRESENT_AS_LEGAL_NAME = ${tradeOnlyForms} ` +
      `(${ratio(tradeOnlyForms, byTradeName.size)})\n`,
  );

  // ── § 11 — la medición REAL, sólo si hay corpus. ──
  process.stdout.write('\n§ 11 — HISTORICAL BR DISCOVERY CANDIDATES\n');
  process.stdout.write(`  CORPUS_SOURCE            = ${source}\n`);
  process.stdout.write(`  HISTORICAL_BR_CANDIDATES = ${candidates.length}\n`);

  if (candidates.length === 0) {
    process.stdout.write('\n  EXACT_LEGAL_NAME_RESOLVED     = n/a\n');
    process.stdout.write('  CITY_DISAMBIGUATED            = n/a\n');
    process.stdout.write('  AMBIGUOUS                     = n/a\n');
    process.stdout.write('  NO_MATCH                      = n/a\n');
    process.stdout.write('  INVALID_INPUT                 = n/a\n');
    process.stdout.write('  LEGAL_NAME_RESOLUTION_RATE    = n/a\n');
    process.stdout.write('  MISSING_AFTER_LEGAL_NAME_RATE = n/a\n');
    process.stdout.write('\n§ 12 — NOME FANTASIA INCREMENT\n');
    process.stdout.write('  NO_MATCH_LEGAL_NAME           = n/a\n');
    process.stdout.write('  WOULD_MATCH_TRADE_NAME        = n/a\n');
    process.stdout.write('  WOULD_STILL_NOT_MATCH         = n/a\n');
    process.stdout.write('  TRADE_NAME_INCREMENTAL_COVERAGE = n/a\n');
    process.stdout.write('\n§ 13 — DECISION\n');
    process.stdout.write('  TRADE_NAME_REQUIRED_FOR_COVERAGE = STILL_UNKNOWN\n');
    process.stdout.write(
      '  REASON = no local corpus of REAL BR discovery names exists on this machine; the\n' +
        '           structural ceiling above bounds what is POSSIBLE and says nothing about what\n' +
        '           discovery actually emits. Measuring it needs a candidate sample, not more code.\n',
    );
    return;
  }

  // ── El clasificador, con la MISMA lógica de cardinalidad que el resolver de CUT C. ──
  let resolvedExact = 0;
  let cityDisambiguated = 0;
  let ambiguous = 0;
  let noMatch = 0;
  let invalidInput = 0;
  const unmatchedForms: string[] = [];

  for (const candidate of candidates) {
    const canonical = normalizeBrCompanyLegalName(candidate.name);
    if (canonical.status !== 'valid') {
      invalidInput += 1;
      continue;
    }
    const cities = byLegalName.get(canonical.normalized);
    if (cities === undefined) {
      noMatch += 1;
      unmatchedForms.push(canonical.normalized);
      continue;
    }
    if (cities.length === 1) {
      resolvedExact += 1;
      continue;
    }
    const candidateCity = normalizeBrMunicipalityName(candidate.city);
    if (candidateCity.status !== 'valid') {
      ambiguous += 1;
      continue;
    }
    const inCity = cities.filter((city) => city === candidateCity.normalized).length;
    if (inCity === 1) cityDisambiguated += 1;
    else if (inCity === 0) noMatch += 1;
    else ambiguous += 1;
  }

  const total = candidates.length;
  const resolved_ = resolvedExact + cityDisambiguated;
  process.stdout.write(`\n  EXACT_LEGAL_NAME_RESOLVED     = ${resolvedExact}\n`);
  process.stdout.write(`  CITY_DISAMBIGUATED            = ${cityDisambiguated}\n`);
  process.stdout.write(`  AMBIGUOUS                     = ${ambiguous}\n`);
  process.stdout.write(`  NO_MATCH                      = ${noMatch}\n`);
  process.stdout.write(`  INVALID_INPUT                 = ${invalidInput}\n`);
  process.stdout.write(`  LEGAL_NAME_RESOLUTION_RATE    = ${ratio(resolved_, total)}\n`);
  process.stdout.write(`  MISSING_AFTER_LEGAL_NAME_RATE = ${ratio(total - resolved_, total)}\n`);

  // ── § 12 — cuánto de lo NO emparejado recuperaría `nome_fantasia`, EXACTAMENTE. ──
  let wouldMatchTradeName = 0;
  for (const form of unmatchedForms) if (byTradeName.has(form)) wouldMatchTradeName += 1;
  const wouldStillNotMatch = unmatchedForms.length - wouldMatchTradeName;
  process.stdout.write('\n§ 12 — NOME FANTASIA INCREMENT (transient analysis)\n');
  process.stdout.write(`  NO_MATCH_LEGAL_NAME             = ${unmatchedForms.length}\n`);
  process.stdout.write(`  WOULD_MATCH_TRADE_NAME          = ${wouldMatchTradeName}\n`);
  process.stdout.write(`  WOULD_STILL_NOT_MATCH           = ${wouldStillNotMatch}\n`);
  process.stdout.write(
    `  TRADE_NAME_INCREMENTAL_COVERAGE = ${ratio(wouldMatchTradeName, total)}\n`,
  );

  // ── § 13 — el veredicto, atado a un umbral declarado. ──
  const incremental = total === 0 ? 0 : wouldMatchTradeName / total;
  const MATERIAL = 0.05;
  process.stdout.write('\n§ 13 — DECISION\n');
  process.stdout.write(
    `  TRADE_NAME_REQUIRED_FOR_COVERAGE = ${incremental >= MATERIAL ? 'YES' : 'NO'}\n`,
  );
  process.stdout.write(
    `  THRESHOLD = ${(MATERIAL * 100).toFixed(0)}% incremental exact coverage over the corpus\n`,
  );
}

void main();
