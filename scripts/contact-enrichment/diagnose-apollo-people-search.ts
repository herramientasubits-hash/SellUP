#!/usr/bin/env tsx
/**
 * APOLLO PEOPLE SEARCH DIAGNOSTICS — Agente 2A
 *
 * Diagnóstico real controlado contra Apollo para entender por qué people search
 * devuelve 0 resultados (caso Bancolombia). Aísla resolución de organización,
 * filtro por dominio, filtro por organization_id y filtros HR/seniority.
 *
 * GARANTÍAS ABSOLUTAS:
 *   0 API key expuesta     0 Raw payload completo   0 Emails/teléfonos
 *   0 Candidatos creados   0 Runs reales tocados    0 HubSpot
 *   ≤ 4 llamadas Apollo    per_page ≤ 3
 *
 * Uso:  NODE_ENV=development node --env-file=.env.local --import tsx \
 *         scripts/contact-enrichment/diagnose-apollo-people-search.ts
 * O:    ... -- --domain bancolombia.com --name Bancolombia
 */

import { ensureNode20WebSocketShim } from '../peru/ensure-node20-websocket-shim';
import { runApolloContactDiagnostics } from '../../src/server/agents/contact-enrichment-toolkit/apollo-contact-diagnostics';

// Node 20 no expone WebSocket global, que @supabase/supabase-js toca al
// construir el cliente (lo usa apollo-connection vía Vault). CLI-only.
ensureNode20WebSocketShim();

// ── Constants ──────────────────────────────────────────────────────────────────

const DEFAULT_DOMAIN = 'bancolombia.com';
const DEFAULT_NAME = 'Bancolombia';

// ── CLI args ───────────────────────────────────────────────────────────────────

function parseArg(flag: string, fallback: string): string {
  const args = process.argv.slice(2);
  const idx = args.indexOf(flag);
  if (idx !== -1 && args[idx + 1]) return args[idx + 1];
  return fallback;
}

// ── Banner ─────────────────────────────────────────────────────────────────────

console.log('\n' + '═'.repeat(72));
console.log('APOLLO PEOPLE SEARCH DIAGNOSTICS — Agente 2A');
console.log('Garantías: 0 API key · 0 raw payload · 0 PII · ≤4 llamadas · per_page ≤3');
console.log('═'.repeat(72) + '\n');

// ── Main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const companyDomain = parseArg('--domain', DEFAULT_DOMAIN);
  const companyName = parseArg('--name', DEFAULT_NAME);

  console.log(`[diag] Empresa de prueba: ${companyName} (${companyDomain})`);
  console.log('[diag] Resolviendo credencial Apollo desde Vault y ejecutando tests...\n');

  const result = await runApolloContactDiagnostics({ companyDomain, companyName, perPage: 3 });

  // El resultado ya es metadata segura (sin PII ni payload crudo).
  console.log(JSON.stringify(result, null, 2));

  console.log('\n' + '─'.repeat(72));
  console.log(`Status:            ${result.status}`);
  console.log(`Llamadas Apollo:   ${result.apolloCallsUsed}/4`);
  if (result.reason) console.log(`Razón:             ${result.reason}`);
  console.log(`Causa raíz:        ${result.probableRootCause}`);
  console.log(`Recomendación:     ${result.recommendation}`);
  console.log('─'.repeat(72) + '\n');
}

main()
  .then(() => process.exit(0))
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : 'Error desconocido';
    console.error(`[diag] Error fatal: ${msg}`);
    process.exit(1);
  });
