/**
 * Read-only diagnostic report for Peru SUNAT + Migo source coverage.
 *
 * Guardrails:
 *   - Does NOT call SUNAT web, Migo API, Tavily, or any LLM
 *   - Does NOT expose API keys or raw connection payloads
 *   - Does NOT create candidates, accounts, or batches
 *   - Does NOT run the importer or load additional rows
 *   - Does NOT modify any table
 *
 * Run: npm run report:peru:source-coverage
 */

import { getPeruSourceCoverageSummary } from '../../src/server/services/peru-source-coverage-summary';

async function main() {
  const summary = await getPeruSourceCoverageSummary();
  const { sunat, migo } = summary;

  console.log('');
  console.log('Peru source coverage summary');
  console.log('────────────────────────────────────────');
  console.log(`SUNAT loaded rows:         ${sunat.loadedRows.toLocaleString('en-US')}`);
  console.log(`SUNAT active + habido:     ${sunat.activeHabidoRows.toLocaleString('en-US')}`);
  console.log(`SUNAT active + not habido: ${sunat.activeNotHabidoRows.toLocaleString('en-US')}`);
  console.log(`SUNAT inactive + habido:   ${sunat.inactiveHabidoRows.toLocaleString('en-US')}`);
  console.log(`SUNAT inactive + not hab:  ${sunat.inactiveNotHabidoRows.toLocaleString('en-US')}`);
  console.log(`SUNAT next offset:         ${sunat.nextRecommendedOffset.toLocaleString('en-US')}`);
  console.log(`SUNAT coverage:            ${sunat.coverageLabel} (~${sunat.coveragePercent}% of audited RUC-20 universe)`);
  console.log('────────────────────────────────────────');
  console.log(`Migo role:                 ${migo.role}`);
  console.log(`Migo configured:           ${migo.configured}`);
  console.log('────────────────────────────────────────');
  console.log('CIIU official:             unavailable_for_mvp');
  console.log('Sector:                    inferred_web_ai');
  console.log('────────────────────────────────────────');
  console.log('Guardrails active:');
  console.log('  noSunatWebRuntime      ✓');
  console.log('  noVercelZipProcessing  ✓');
  console.log('  noMigoDiscovery        ✓');
  console.log('  noOfficialCiiuForMvp   ✓');
  console.log('  sectorIsInferredByWebAi ✓');
  console.log('');
}

main().catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err);
  console.error('report-peru-source-coverage failed:', msg);
  process.exit(1);
});
