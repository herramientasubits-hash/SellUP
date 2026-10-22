// Pestañas «Por país», «Por rol y grupo» y «Por búsqueda»: cargan aparte
// (Suspense) para no frenar los indicadores. Las tres comparten UNA lectura por
// petición (getAiUsageBreakdowns está en caché) y reciben las cifras ya sin
// importes cuando quien mira no ve dólares.

import type { ReactNode } from 'react';
import { Lock } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Skeleton } from '@/components/ui/skeleton';
import { getAiUsageBreakdowns, type UsageBreakdowns } from '@/modules/ai-usage/breakdown-queries';
import type { UsageFilters } from '@/modules/ai-usage/queries';
import { CountryToolsTable } from './country-tools-table';
import { RoleGroupTables } from './role-group-tables';
import { SearchBatchesTable } from './search-batches-table';

export function BreakdownSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true">
      <Skeleton className="h-6 w-64" />
      <Skeleton className="h-72 rounded-xl" />
    </div>
  );
}

function Notices({ data }: { data: UsageBreakdowns }) {
  return (
    <>
      {data.dataQuality.readError && (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron leer las empresas</AlertTitle>
          <AlertDescription>Lo que ves puede estar incompleto. Vuelve a cargar la página en unos minutos.</AlertDescription>
        </Alert>
      )}
      {data.dataQuality.truncated && (
        <Alert variant="warning" role="note">
          <AlertTitle>Las cifras pueden quedarse cortas</AlertTitle>
          <AlertDescription>Elige un periodo más corto o añade un filtro para ver cifras completas.</AlertDescription>
        </Alert>
      )}
    </>
  );
}

async function withBreakdowns(
  filters: UsageFilters,
  render: (data: UsageBreakdowns) => ReactNode,
) {
  const data = await getAiUsageBreakdowns(filters);
  if (data === null) {
    return (
      <EmptyState
        icon={Lock}
        title="No tienes acceso a estas cifras"
        description="Pide acceso a una persona administradora."
      />
    );
  }
  return (
    <div className="space-y-4">
      <Notices data={data} />
      {render(data)}
    </div>
  );
}

export async function CountryBreakdownSection({ filters }: { filters: UsageFilters }) {
  return withBreakdowns(filters, (data) => (
    <CountryToolsTable rows={data.countryTools} moneyVisible={data.moneyVisible} />
  ));
}

export async function RoleGroupBreakdownSection({
  filters,
  currentQuery,
}: {
  filters: UsageFilters;
  currentQuery: string;
}) {
  return withBreakdowns(filters, (data) => (
    <RoleGroupTables
      roles={data.roles}
      groups={data.groups}
      people={data.people}
      roleLabels={data.roleLabels}
      groupNames={data.groupNames}
      personNames={data.personNames}
      moneyVisible={data.moneyVisible}
      currentQuery={currentQuery}
    />
  ));
}

export async function SearchBreakdownSection({ filters }: { filters: UsageFilters }) {
  return withBreakdowns(filters, (data) => (
    <SearchBatchesTable rows={data.searches} personNames={data.personNames} moneyVisible={data.moneyVisible} />
  ));
}

/**
 * Agente 1 · «Competidores» — calidad por fuente y por referencia (auditoría 21-10).
 * Con la sesión (RLS) y el periodo de los filtros; sin datos no se pinta.
 */
export async function CompetitorQualitySection({ filters }: { filters: UsageFilters }) {
  const [{ createClient }, { loadCompetitorQuality }, { resolvePeriodStart }] = await Promise.all([
    import('@/lib/supabase/server'),
    import('@/server/prospect-batches/competitor-search/competitor-quality.server'),
    import('@/modules/ai-usage/usage-filter-semantics'),
  ]);
  const since = resolvePeriodStart(filters.period) ?? new Date(0).toISOString();
  const supabase = await createClient();
  const quality = await loadCompetitorQuality(supabase as unknown as Parameters<typeof loadCompetitorQuality>[0], since);
  if (!quality || (quality.bySource.length === 0 && quality.byReference.length === 0)) return null;
  const { CompetitorQualityTables } = await import('./competitor-quality-table');
  return <CompetitorQualityTables bySource={quality.bySource} byReference={quality.byReference} />;
}
