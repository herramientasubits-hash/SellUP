/**
 * Pone al día las claves de los reclamos fiscales ACTIVOS que se guardaron con la
 * forma vieja del NIT/RUT/RUC (AUDIT-HARDENING-1, decisión de la dueña 16-10).
 *
 * Qué corrige: un NIT colombiano con el dígito de verificación pegado
 * (`CO:8909039388`), un RUT chileno de persona jurídica sin dígito y un RUC
 * paraguayo `80xxxxxx` sin dígito pasan a la clave canónica de hoy
 * (`CO:890903938`, `CL:<cuerpo+DV>`, `PY:<cuerpo+DV>`). La clave nueva se calcula
 * desde lo que el candidato dueño tiene guardado, con la misma función del
 * escritor; no se adivina desde la clave vieja.
 *
 * Uso — DRY-RUN por defecto: sólo LEE, imprime el plan y NO escribe nada.
 *   ALLOW_PRODUCTION_SUPABASE_IN_NON_PROD=true \
 *     npx tsx scripts/agent1/recanonicalize-fiscal-claims.ts --countries=CO,CL,PY
 *
 * Aplicar (ESCRIBE en Producción: sólo con autorización explícita de la dueña, y
 * después de aplicar la migración 152). Exige las DOS banderas:
 *     ... npx tsx scripts/agent1/recanonicalize-fiscal-claims.ts --apply --confirm
 *
 * Qué NO hace: no libera reclamos, no toca candidatos ni presupuesto, no resuelve
 * colisiones. Una clave nueva que ya tiene otro reclamo activo significa que esa
 * empresa está reclamada dos veces (dos vendedores): se IMPRIME para decidirla a
 * mano. Cada UPDATE va vallado por (id, clave vieja, reclamo activo); el índice
 * único parcial protege de cualquier carrera.
 */

import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '../../src/lib/supabase/admin';
import {
  applyFiscalClaimRecanonicalization,
  fiscalClaimKeyCountry,
  planFiscalClaimRecanonicalization,
  type ActiveFiscalClaim,
  type ClaimCandidateFacts,
} from '../../src/server/prospect-batches/fiscal-claim-recanonicalization';

const PAGE = 500;
const CANDIDATE_CHUNK = 100;

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function argValue(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() || null : null;
}

async function readActiveFiscalClaims(admin: SupabaseClient, countries: ReadonlySet<string>): Promise<ActiveFiscalClaim[]> {
  const claims: ActiveFiscalClaim[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await admin
      .from('agent1_company_identity_claims')
      .select('id, candidate_id, claim_key')
      .eq('claim_type', 'fiscal')
      .is('released_at', null)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`no se pudieron leer los reclamos: ${error.message}`);
    const rows = (data ?? []) as Array<{ id: string; candidate_id: string; claim_key: string }>;
    for (const row of rows) {
      const country = fiscalClaimKeyCountry(row.claim_key);
      if (country && countries.has(country)) claims.push({ id: row.id, candidateId: row.candidate_id, claimKey: row.claim_key });
    }
    if (rows.length < PAGE) break;
  }
  return claims;
}

async function readCandidates(admin: SupabaseClient, ids: readonly string[]): Promise<Map<string, ClaimCandidateFacts>> {
  const out = new Map<string, ClaimCandidateFacts>();
  for (let i = 0; i < ids.length; i += CANDIDATE_CHUNK) {
    const chunk = ids.slice(i, i + CANDIDATE_CHUNK);
    const { data, error } = await admin
      .from('prospect_candidates')
      .select('id, country_code, tax_id, tax_identifier')
      .in('id', chunk);
    if (error) throw new Error(`no se pudieron leer los candidatos: ${error.message}`);
    for (const row of (data ?? []) as Array<{ id: string; country_code: string | null; tax_id: string | null; tax_identifier: string | null }>) {
      out.set(row.id, { id: row.id, countryCode: row.country_code, taxId: row.tax_id, taxIdentifier: row.tax_identifier });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const apply = flag('apply');
  if (apply && !flag('confirm')) {
    console.error('Para escribir hacen falta las dos banderas: --apply --confirm. Sin ellas sólo se puede simular.');
    process.exit(2);
  }
  const countries = new Set(
    (argValue('countries') ?? 'CO,CL,PY').split(',').map((c) => c.trim().toUpperCase()).filter(Boolean),
  );
  const admin = createSupabaseAdminClient();

  const claims = await readActiveFiscalClaims(admin, countries);
  const candidates = await readCandidates(admin, [...new Set(claims.map((claim) => claim.candidateId))]);
  const plan = planFiscalClaimRecanonicalization(claims, candidates);

  console.log(`Países: ${[...countries].join(', ')} · reclamos fiscales activos leídos: ${plan.summary.total}`);
  console.log(JSON.stringify(plan.summary, null, 2));
  for (const item of plan.items) {
    if (item.action === 'update') console.log(`ACTUALIZAR  ${item.from}  →  ${item.to}   (reclamo ${item.claimId}, candidato ${item.candidateId})`);
    if (item.action === 'collision') {
      console.log(
        `COLISIÓN    ${item.from}  →  ${item.to}   ya la tiene ${item.sameCandidate ? 'el MISMO candidato' : `OTRO candidato (${item.heldByCandidateId})`}  (reclamo ${item.claimId}, candidato ${item.candidateId})`,
      );
    }
  }

  if (!apply) {
    console.log('\nDRY-RUN: no se escribió nada.');
    return;
  }

  const result = await applyFiscalClaimRecanonicalization(plan, async ({ claimId, from, to }) => {
    const { data, error } = await admin
      .from('agent1_company_identity_claims')
      .update({ claim_key: to })
      .eq('id', claimId)
      .eq('claim_key', from)
      .eq('claim_type', 'fiscal')
      .is('released_at', null)
      .select('id');
    if (error) return error.code === '23505' ? 'unique_violation' : 'error';
    return (data ?? []).length > 0 ? 'updated' : 'not_found';
  });
  console.log('\nAPLICADO:', JSON.stringify(result));
}

main().catch((error) => {
  console.error('[recanonicalize-fiscal-claims]', error instanceof Error ? error.message : error);
  process.exit(1);
});
