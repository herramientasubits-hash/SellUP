/**
 * Rescate con Claude de UN lote desde la terminal (AGENT1-RESCUE-CHAIN-FIX-1).
 *
 * La página del lote ya no tiene el botón «Completar con Claude» (dueña 06-10): el
 * rescate corre solo al terminar cada búsqueda y se relanza en cadena. Los lotes
 * ANTERIORES a ese cambio (o uno cuya cadena se cortó) se terminan con este script,
 * que hace exactamente lo mismo que la cadena: vueltas de `rescueBatchWithClaude`
 * con los mismos frenos (`decideRescueContinuation`: 4 vueltas extra, US$3 por lote,
 * corte si una vuelta no avanza).
 *
 * Uso (DRY-RUN por defecto: sólo cuenta, NO llama a Claude ni escribe):
 *   npx tsx scripts/agent1/run-claude-rescue.ts --batch=<uuid>
 *
 * Rescate REAL (gasta Claude: sólo con autorización de la dueña para ESE lote). Los
 * interruptores van en la orden, igual que en Producción:
 *   ENABLE_AGENT1_CLAUDE_RESCUE=true ENABLE_AGENT1_CLAUDE_DOMAIN_FINDER=true \
 *     npx tsx scripts/agent1/run-claude-rescue.ts --batch=<uuid> --apply
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { isAgent1ClaudeDomainFinderEnabled, isAgent1ClaudeRescueEnabled } from '../../src/lib/feature-flags.server';
import {
  needsCandidateRescue,
  rescueBatchWithClaude,
} from '../../src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch';
import { buildLiveRescueBatchDeps } from '../../src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-batch.server';
import { decideRescueContinuation } from '../../src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-chain';
import { needsDispositionRescue } from '../../src/server/agents/prospecting-toolkit/claude-classifier/rescue/rescue-dispositions';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Fuera de Vercel no hay límite de 300 s, pero cada vuelta mantiene el mismo plazo. */
const ROUND_DEADLINE_MS = 200_000;

function parseArgs(argv: readonly string[]): { batchId: string; apply: boolean } {
  const hit = argv.find((arg) => arg.startsWith('--batch='));
  const batchId = hit ? hit.slice('--batch='.length) : '';
  if (!UUID.test(batchId)) throw new Error('config_invalid: falta --batch=<uuid del lote>');
  return { batchId, apply: argv.includes('--apply') };
}

async function main(): Promise<void> {
  const { batchId, apply } = parseArgs(process.argv.slice(2));
  console.log(`RESCATE CON CLAUDE — lote ${batchId} — ${apply ? 'APPLY (gasta Claude)' : 'DRY-RUN (no llama a Claude)'}`);

  const deps = buildLiveRescueBatchDeps(null);
  const [candidates, dispositions] = await Promise.all([
    deps.loadReviewCandidates(batchId),
    deps.loadDispositions(batchId),
  ]);
  const now = Date.now();
  const pendingCandidates = candidates.filter((row) => needsCandidateRescue(row, now)).length;
  const pendingDispositions = dispositions.filter((row) => needsDispositionRescue(row, now, !!deps.domainSearch)).length;
  console.log(`  En revisión por completar: ${pendingCandidates} · Descartadas por rescatar: ${pendingDispositions}`);
  if (!deps.domainSearch) {
    console.log('  ⚠️ ENABLE_AGENT1_CLAUDE_DOMAIN_FINDER apagado en esta orden: las descartadas SIN web no se tocan.');
  }

  if (!apply) {
    console.log('  DRY-RUN: no se llamó a Claude ni se escribió nada. Usa --apply (con autorización) para rescatar.');
    return;
  }
  if (!isAgent1ClaudeRescueEnabled()) throw new Error('rescue_disabled: falta ENABLE_AGENT1_CLAUDE_RESCUE=true');
  if (!isAgent1ClaudeDomainFinderEnabled()) console.log('  (sin buscador de sitio: sólo se completan filas con web)');

  let spentUsd = 0;
  for (let round = 0; ; round += 1) {
    const summary = await rescueBatchWithClaude({ batchId, triggeredBy: null, deadlineMs: ROUND_DEADLINE_MS }, deps);
    spentUsd += summary.ok ? summary.estimatedCostUsd : 0;
    console.log(`  Vuelta ${round}: ${JSON.stringify(summary)}`);
    const decision = decideRescueContinuation({ summary, continuationsDone: round, spentUsd });
    if (!decision.continue) {
      console.log(`  Fin: ${decision.reason} · gasto del rescate ≈ US$${spentUsd.toFixed(3)}`);
      return;
    }
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
