'use server';

/**
 * Agente 1 · «Competidores de una empresa» — botón «Más como esta» (a demanda).
 *
 * Apollo busca empresas parecidas a la competidora elegida (con la referencia y
 * las aprobadas del lote como semillas, hasta 5), el MISMO juez de Claude filtra y
 * sólo lo elegido entra al MISMO lote. ~2 créditos de Apollo por clic: una página
 * para hallar los IDs y otra de parecidas (decisión de la dueña 21-10: el gasto de
 * Apollo sólo cuando el vendedor lo pide). Nunca toca presupuesto del piloto.
 */

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import { readCompetitorReference } from './competitor-reference';
import {
  MORE_LIKE_THIS_COOLDOWN_MS,
  describeMoreLikeThisOutcome,
  moreLikeThisEligibility,
  pickMoreLikeThisSeedDomains,
  toCompetitorOfCompetitorReference,
  type MoreLikeThisCandidate,
} from './competitor-more-like-this';

const requestSchema = z.object({ candidateId: z.string().uuid() }).strict();

export type MoreLikeThisResult = { ok: true; message: string; persistedCount: number } | { ok: false; message: string };

type BatchRow = { id: string; country: string | null; country_code: string | null; industry: string | null; metadata: unknown };

export async function findMoreLikeThisAction(request: unknown): Promise<MoreLikeThisResult> {
  const { internalUserId } = await requireActiveUser();
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: 'Solicitud inválida.' };

  // Con la sesión (RLS): sólo lo que la persona puede ver.
  const supabase = await createClient();
  const { data: candidate } = await supabase
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, metadata')
    .eq('id', parsed.data.candidateId)
    .maybeSingle();
  if (!candidate) return { ok: false, message: 'No encontramos esta empresa.' };
  const chosen = candidate as MoreLikeThisCandidate & { batch_id: string };
  const eligibility = moreLikeThisEligibility(chosen);
  if (!eligibility.ok) {
    return {
      ok: false,
      message:
        eligibility.reason === 'no_domain'
          ? 'Esta empresa no tiene sitio web: Apollo no puede usarla de ejemplo.'
          : 'Sólo funciona con competidoras en revisión o aprobadas.',
    };
  }

  const { data: batchData } = await supabase
    .from('prospect_batches')
    .select('id, country, country_code, industry, metadata')
    .eq('id', chosen.batch_id)
    .maybeSingle();
  const batch = batchData as BatchRow | null;
  const reference = batch ? readCompetitorReference(batch.metadata) : null;
  if (!batch || !reference || !batch.country_code) {
    return { ok: false, message: 'Esta búsqueda no es de competidores.' };
  }

  // Un doble clic no paga dos veces: si hace menos de 2 min ya se pidió en este lote, se espera.
  const since = new Date(Date.now() - MORE_LIKE_THIS_COOLDOWN_MS).toISOString();
  const { count: recent } = await createSupabaseAdminClient()
    .from('provider_usage_logs')
    .select('id', { count: 'exact', head: true })
    .eq('batch_id', batch.id)
    .eq('metadata->>trigger', 'more_like_this')
    .gte('created_at', since);
  if ((recent ?? 0) > 0) return { ok: false, message: 'Ya se está buscando en este lote. Espera un par de minutos.' };

  const { data: siblings } = await supabase
    .from('prospect_candidates')
    .select('id, name, domain, status, metadata')
    .eq('batch_id', batch.id)
    .in('status', ['approved', 'converted']);
  const seedDomains = pickMoreLikeThisSeedDomains(chosen, (siblings ?? []) as MoreLikeThisCandidate[]);

  const [{ runCompetitorApolloLive }, { loadNotCompetitorNames }] = await Promise.all([
    import('@/server/prospect-batches/competitor-search/competitor-apollo.server'),
    import('@/server/prospect-batches/competitor-search/competitor-not-competitors.server'),
  ]);
  const notCompetitors = await loadNotCompetitorNames(reference);
  const outcome = await runCompetitorApolloLive({
    batchId: batch.id,
    clientRequestId: randomUUID(),
    reference: notCompetitors.length > 0 ? { ...reference, notCompetitors } : reference,
    countryCode: batch.country_code,
    countryName: batch.country ?? batch.country_code,
    industryName: batch.industry ?? '',
    target: seedDomains.length + 5,
    userId: internalUserId,
    seedDomains,
  }).catch(() => null);
  if (!outcome) return { ok: false, message: 'No se pudo buscar en Apollo. Intenta de nuevo.' };
  return { ok: true, message: describeMoreLikeThisOutcome(outcome), persistedCount: outcome.persistedCount };
}

export type CompetitorOfCompetitorPrepared =
  | {
      ok: true;
      title: string;
      concurrencyKey: string;
      payload: {
        countryCode: string;
        industryId: string;
        subindustryIds: string[];
        additionalCriteriaRaw: null;
        catalogVersion: string;
        clientRequestId: string;
        searchMode: 'competitors';
        referenceCompany: {
          name: string;
          domain: string | null;
          description: string | null;
          accountId: null;
        };
      };
    }
  | { ok: false; message: string };

/**
 * «Sus competidores» (expansión de un salto): arma la solicitud de una búsqueda de
 * competidores con esta competidora como referencia, en el mismo país e industria.
 * No gasta nada: el navegador la lanza por la ruta de corridas (Centro de procesos),
 * como el asistente, para no trabar la página con una acción de 300 s.
 */
export async function prepareCompetitorOfCompetitorRunAction(request: unknown): Promise<CompetitorOfCompetitorPrepared> {
  await requireActiveUser();
  const parsed = requestSchema.safeParse(request);
  if (!parsed.success) return { ok: false, message: 'Solicitud inválida.' };
  const supabase = await createClient();
  const { data: candidate } = await supabase
    .from('prospect_candidates')
    .select('id, batch_id, name, domain, status, metadata')
    .eq('id', parsed.data.candidateId)
    .maybeSingle();
  if (!candidate) return { ok: false, message: 'No encontramos esta empresa.' };
  const chosen = candidate as MoreLikeThisCandidate & { batch_id: string };
  if (!moreLikeThisEligibility(chosen).ok) {
    return { ok: false, message: 'Sólo funciona con competidoras en revisión o aprobadas, con sitio web.' };
  }
  const { data: batchData } = await supabase
    .from('prospect_batches')
    .select('id, country, country_code, industry, metadata')
    .eq('id', chosen.batch_id)
    .maybeSingle();
  const batch = batchData as BatchRow | null;
  const metadata = (batch?.metadata ?? {}) as Record<string, unknown>;
  const industryId = typeof metadata.industry_id === 'string' ? metadata.industry_id : null;
  const catalogVersion = typeof metadata.catalog_version_id === 'string' ? metadata.catalog_version_id : null;
  const subindustryIds = Array.isArray(metadata.subindustry_ids)
    ? metadata.subindustry_ids.filter((id): id is string => typeof id === 'string')
    : [];
  const reference = toCompetitorOfCompetitorReference(chosen);
  if (!batch?.country_code || !industryId || !catalogVersion || !reference || !readCompetitorReference(batch.metadata)) {
    return { ok: false, message: 'Esta búsqueda no es de competidores.' };
  }
  return {
    ok: true,
    title: `Competidores de ${reference.name} · ${batch.country ?? batch.country_code}`,
    concurrencyKey: `competitors:${reference.domain ?? reference.name}:${batch.country_code}`,
    payload: {
      countryCode: batch.country_code,
      industryId,
      subindustryIds,
      additionalCriteriaRaw: null,
      catalogVersion,
      clientRequestId: randomUUID(),
      searchMode: 'competitors',
      referenceCompany: { name: reference.name, domain: reference.domain, description: reference.description, accountId: null },
    },
  };
}
