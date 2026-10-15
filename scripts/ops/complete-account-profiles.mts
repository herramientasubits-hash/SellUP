/**
 * complete-account-profiles.mts — completa país e industria de empresas existentes (15-10-2026).
 *
 * Misma lógica que corre sola al crear/vincular una empresa de HubSpot
 * (`completeAccountProfile`): país gratis (nombre ↔ código, o dominio de país) e industria con
 * Claude leyendo el sitio oficial (tiene costo y respeta el tope del presupuesto). Lo completado
 * se escribe también en HubSpot, sólo en los campos vacíos allá.
 *
 * Modos:
 *   --plan     SÓLO LECTURA, sin Claude. Lista qué le falta a cada empresa y qué país se deduce gratis.
 *   --execute  ESCRIBE (SellUp + HubSpot + consulta a Claude). Exige `--confirm ACCOUNT-PROFILE-COMPLETION-1`.
 *
 * Uso:
 *   /usr/local/bin/node --env-file=/Users/ub-col-pro-lf4/Documents/SellUp/.env.local --import tsx \
 *     scripts/ops/complete-account-profiles.mts --plan | --execute --confirm ACCOUNT-PROFILE-COMPLETION-1
 */

import { createClient } from '@supabase/supabase-js';
import {
  missingProfileFields,
  planCountryCompletion,
} from '@/modules/accounts/account-profile-completion';
import { mapCountryToCode } from '@/server/agents/contact-enrichment-toolkit/company-resolver-core';
import { getCountryNameFromCode } from '@/server/integrations/hubspot-company-create';

const CONFIRM = 'ACCOUNT-PROFILE-COMPLETION-1';
const args = process.argv.slice(2);
const mode = args.includes('--execute') ? 'execute' : args.includes('--plan') ? 'plan' : null;
if (!mode) {
  console.error('Uso: --plan | --execute --confirm ' + CONFIRM);
  process.exit(1);
}
if (mode === 'execute' && args[args.indexOf('--confirm') + 1] !== CONFIRM) {
  console.error('--execute exige --confirm ' + CONFIRM);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('Faltan credenciales de Supabase');
const admin = createClient(url, key);

const { data, error } = await admin
  .from('accounts')
  .select('id, name, domain, country, country_code, industry, hubspot_company_id')
  .is('archived_at', null)
  .or('country.is.null,country_code.is.null,industry.is.null')
  .order('created_at', { ascending: false });
if (error) throw new Error(error.message);
const rows = data ?? [];
console.log(`Empresas con algo vacío: ${rows.length}`);

const EXTRA: Record<string, string> = { US: 'Estados Unidos', ES: 'España' };
const maps = {
  nameToCode: (name: string | null) => mapCountryToCode(name),
  codeToName: (code: string | null) => (code ? (getCountryNameFromCode(code) ?? EXTRA[code] ?? null) : null),
};

if (mode === 'plan') {
  for (const row of rows) {
    const missing = missingProfileFields(row);
    const country = missing.includes('country') ? planCountryCompletion(row, maps) : null;
    console.log(
      JSON.stringify({
        name: row.name,
        domain: row.domain,
        missing,
        country_plan: country ? `${country.country} (${country.country_code}) por ${country.source}` : null,
        industry_plan: missing.includes('industry') ? 'Claude (lee el sitio)' : null,
        hubspot: row.hubspot_company_id ? 'vinculada' : 'sin vínculo',
      }),
    );
  }
  process.exit(0);
}

const { completeAccountProfile } = await import('@/modules/accounts/account-profile-completion.server');
for (const row of rows) {
  const result = await completeAccountProfile(admin, {
    accountId: row.id,
    actorUserId: null,
    nowIso: new Date().toISOString(),
  });
  console.log(JSON.stringify({ name: row.name, ...result }));
}
