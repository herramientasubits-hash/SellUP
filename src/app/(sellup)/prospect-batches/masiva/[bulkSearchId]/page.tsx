import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EMPRESAS_SEARCHES_ROUTE } from '@/config/navigation';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard } from '@/components/shared/surface-card';
import { MetricStrip } from '@/components/shared/metric-strip';
import { Badge } from '@/components/ui/badge';
import { CandidatesTableClient } from '@/components/prospect-batches/candidates-table-client';
import { SearchAssignButton } from '@/components/searches/search-assign-button';
import { createClient as createSessionClient } from '@/lib/supabase/server';
import { getActiveUsers } from '@/modules/accounts/actions';
import { hasCandidateAssignmentColumn } from '@/modules/assignment/assignment.server';
import { getCandidatesByBatch, getProspectBatchById } from '@/modules/prospect-batches/actions';
import {
  getBulkSearchForUser,
  resolveBulkSearchAccess,
} from '@/modules/prospect-batches/bulk-search/bulk-search-service.server';
import { bulkDisplayState, bulkSearchSummary } from '@/modules/prospect-batches/bulk-search/bulk-search-display';
import { BULK_SEARCH_FORM_LABEL, searchDisplayName } from '@/modules/prospect-batches/searches/search-rows';

interface Props {
  params: Promise<{ bulkSearchId: string }>;
}

/**
 * Una búsqueda masiva entera (dueña 17-11: «todas deberían quedar sobre una misma
 * búsqueda, no repartidas en 5»). Cada ronda sigue guardando su propio lote —así
 * corren el tope de 10 por revisión, la continuación de Apollo y el rescate—, pero
 * aquí se ven y se revisan juntas, con las cifras sumadas.
 */
export default async function BulkSearchDetailPage({ params }: Props) {
  const { bulkSearchId } = await params;
  const access = await resolveBulkSearchAccess();
  if (!access.ok) notFound();
  const search = await getBulkSearchForUser(access.userId, bulkSearchId).catch(() => null);
  if (!search) notFound();

  const [batchList, candidateLists, assignmentColumn] = await Promise.all([
    Promise.all(search.batchIds.map((batchId) => getProspectBatchById(batchId))),
    Promise.all(search.batchIds.map((batchId) => getCandidatesByBatch(batchId))),
    createSessionClient()
      .then((supabase) => hasCandidateAssignmentColumn(supabase))
      .catch(() => false),
  ]);
  const rounds = search.batchIds.flatMap((batchId, index) => {
    const batch = batchList[index];
    return batch ? [{ round: index + 1, batch }] : [];
  });
  const candidates = candidateLists.flat();
  const first = rounds[0]?.batch ?? null;

  const sum = (pick: (batch: (typeof rounds)[number]['batch']) => number | null | undefined) =>
    rounds.reduce((acc, { batch }) => acc + (pick(batch) ?? 0), 0);
  const counts = {
    total: sum((batch) => batch.total_candidates),
    needsReview: sum((batch) => batch.needs_review_count),
    approved: sum((batch) => batch.approved_count),
    discarded: sum((batch) => batch.discarded_count),
    converted: sum((batch) => batch.converted_count),
    duplicates: sum((batch) => batch.duplicate_count),
  };

  const assignableUsers =
    assignmentColumn && counts.needsReview > 0 ? await getActiveUsers().catch(() => []) : [];

  const title = searchDisplayName({
    formLabel: BULK_SEARCH_FORM_LABEL,
    country: first?.country,
    industry: first?.industry,
    name: search.label,
  });
  const summary = bulkSearchSummary(search, bulkDisplayState(search, new Date().getTime()));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Empresas', href: '/accounts' }, { label: 'Búsquedas', href: EMPRESAS_SEARCHES_ROUTE }, title]} />
        }
        backHref={EMPRESAS_SEARCHES_ROUTE}
        title={title}
        description={summary}
        actions={
          assignableUsers.length > 0 ? (
            <SearchAssignButton
              searchId={search.id}
              searchIds={rounds.map(({ batch }) => batch.id)}
              searchName={title}
              users={assignableUsers}
            />
          ) : null
        }
      />

      <MetricStrip
        aria-label="Resumen de la búsqueda masiva"
        items={[
          { label: 'Total emp. candidatas', value: counts.total },
          { label: 'Necesitan revisión', value: counts.needsReview },
          { label: 'Aprobados', value: counts.approved },
          { label: 'Descartados', value: counts.discarded },
          { label: 'Convertidos', value: counts.converted },
          { label: 'Posibles duplicados', value: counts.duplicates },
        ]}
      />

      <SurfaceCard noPadding>
        <div className="flex items-center justify-between gap-3 border-b border-border/60 px-5 py-3.5">
          <p className="min-w-0 truncate text-sm font-semibold text-foreground">
            {candidates.length} {candidates.length === 1 ? 'empresa candidata' : 'empresas candidatas'}
          </p>
          <span className="shrink-0 text-xs text-muted-foreground">
            {rounds.length} {rounds.length === 1 ? 'ronda' : 'rondas'} · objetivo: {search.targetCount}
          </span>
        </div>
        <CandidatesTableClient candidates={candidates} />
      </SurfaceCard>

      {rounds.length > 0 && (
        <SurfaceCard noPadding>
          <div className="border-b border-border/60 px-5 py-3.5">
            <p className="text-sm font-semibold text-foreground">Rondas</p>
            <p className="text-xs text-muted-foreground">
              Cada ronda deja hasta 10 empresas por revisar. Ábrela para ver qué buscó y qué descartó.
            </p>
          </div>
          <ul className="divide-y divide-border/60">
            {rounds.map(({ round, batch }) => (
              <li key={batch.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <Link
                  href={`/prospect-batches/${batch.id}`}
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                >
                  Ronda {round}
                </Link>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="tabular-nums">{batch.total_candidates ?? 0} encontradas</span>
                  {(batch.needs_review_count ?? 0) > 0 && (
                    <Badge variant="warning" className="tabular-nums">
                      {batch.needs_review_count} por revisar
                    </Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </SurfaceCard>
      )}
    </div>
  );
}
