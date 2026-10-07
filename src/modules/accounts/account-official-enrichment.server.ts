// HUBSPOT-ACCOUNT-SYNC-1 — Cableado del completado con fuentes oficiales (ver núcleo
// `account-official-enrichment.ts`). Lee catálogos oficiales gratuitos; ningún proveedor
// pagado (Apollo, Lusha, Tavily, Claude) y ninguna escritura en HubSpot.

import { after } from 'next/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { enrichImportRowsWithOfficialSources } from '@/server/prospect-batches/import-official-source-enrichment';
import { buildColombiaOfficialSourceResolvers } from '@/server/prospect-batches/official-source-resolvers';
import {
  buildOfficialEnrichmentPatch,
  needsOfficialEnrichment,
  type AccountForOfficialEnrichment,
} from './account-official-enrichment';

type AccountRow = AccountForOfficialEnrichment & {
  id: string;
  name: string;
  domain: string | null;
  website: string | null;
  country_code: string | null;
  metadata: Record<string, unknown> | null;
};

export async function enrichAccountWithOfficialSources(
  admin: SupabaseClient,
  input: { accountId: string; actorUserId: string | null; nowIso: string },
): Promise<{ status: 'updated' | 'unchanged' | 'skipped' | 'account_unavailable'; columns: string[] }> {
  const { data, error } = await admin
    .from('accounts')
    .select('id, name, domain, website, country_code, tax_identifier, tax_identifier_type, legal_name, company_size, metadata')
    .eq('id', input.accountId)
    .maybeSingle();
  if (error || !data) return { status: 'account_unavailable', columns: [] };
  const account = data as unknown as AccountRow;
  if (!needsOfficialEnrichment(account)) return { status: 'skipped', columns: [] };

  const outcomes = await enrichImportRowsWithOfficialSources(
    [
      {
        rowNumber: 1,
        name: account.name,
        website: account.website,
        domain: account.domain,
        countryCode: account.country_code,
        taxIdentifier: null,
      },
    ],
    buildColombiaOfficialSourceResolvers(),
  );
  const outcome = outcomes.get(1) ?? null;
  const patch = buildOfficialEnrichmentPatch(account, outcome);
  const columns = Object.keys(patch);

  const { error: updateError } = await admin
    .from('accounts')
    .update({
      ...patch,
      ...(input.actorUserId ? { updated_by: input.actorUserId } : {}),
      metadata: {
        ...(account.metadata ?? {}),
        official_source_enrichment: {
          enriched_at: input.nowIso,
          status: outcome?.metadata.status ?? 'not_searched',
          source_key: outcome?.metadata.sourceKey ?? null,
          strong_identity: outcome?.strongIdentityAvailable ?? false,
          filled_columns: columns,
        },
      },
    })
    .eq('id', input.accountId);
  if (updateError) {
    console.error('[account-official-enrichment] update failed', {
      accountId: input.accountId,
      error: updateError.message,
    });
    return { status: 'account_unavailable', columns: [] };
  }
  return { status: columns.length > 0 ? 'updated' : 'unchanged', columns };
}

/**
 * Programa el completado para cuando la respuesta ya salió (`after()` de Next): la
 * pantalla no espera a los catálogos. Nunca lanza.
 */
export function scheduleAccountOfficialEnrichment(accountId: string, actorUserId: string | null): void {
  try {
    after(async () => {
      try {
        await enrichAccountWithOfficialSources(createSupabaseAdminClient(), {
          accountId,
          actorUserId,
          nowIso: new Date().toISOString(),
        });
      } catch (err) {
        console.error('[account-official-enrichment] background run failed:', err instanceof Error ? err.message : err);
      }
    });
  } catch (err) {
    console.error('[account-official-enrichment] could not schedule:', err instanceof Error ? err.message : err);
  }
}
