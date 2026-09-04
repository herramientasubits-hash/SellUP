import { Building2, Ban, Sparkles, UserRoundX } from 'lucide-react';
import { DataTablePage } from '@/components/shared/data-table-page';
import { MetricCard } from '@/components/shared/metric-card';
import { ModuleTabsNav } from '@/components/navigation/module-tabs-nav';
import { DiscardedProspectsDataTableClient } from '@/components/prospects/discarded-prospects-data-table-client';
import { getDiscardedProspectsList } from '@/modules/prospect-discards/queries';
import { requireActiveUser } from '@/modules/prospect-batches/actions';
import {
  getCommercialScopeFilterOptions,
  resolveScopeOwnerFilter,
} from '@/modules/access/commercial-scope-filter-options';
import { isProspectCreatedToday } from '@/modules/prospect-batches/prospect-date-utils';
import type { ProspectsPanelSearchParams } from '@/components/prospects/prospects-module-panel';

interface DiscardedProspectsPanelProps {
  params: ProspectsPanelSearchParams;
}

/**
 * AGENT1-DISCARDED-PROSPECTS-REVIEW-1 — pestaña "Descartadas" (issue #389).
 * Lista disposiciones persistidas (auto-rechazos del pipeline y descartes
 * manuales) para revisarlas y, si procede, devolverlas a `needs_review` — sin
 * volver a consultar Apollo/Lusha/Tavily/HubSpot y sin consumir presupuesto.
 * Mismo alcance comercial que "Candidatos por revisar".
 *
 * AGENT1-DISCARDED-TAB-PARITY-1 — la pestaña dejó de ser una sub-pestaña
 * dentro de Prospectos y ahora es hermana de las otras dos en una sola fila
 * (<ModuleTabsNav active="descartadas">). La superficie replica la de
 * "Candidatos por revisar": mismas métricas arriba, misma <DataTable> con
 * selección, barra de acciones masivas y filtros de alcance.
 */
export async function DiscardedProspectsPanel({ params }: DiscardedProspectsPanelProps) {
  await requireActiveUser();

  const [scopeFilterOptions, ownerUserIds] = await Promise.all([
    getCommercialScopeFilterOptions(),
    resolveScopeOwnerFilter(params.userId, params.groupId),
  ]);

  const { items, total } = await getDiscardedProspectsList({
    search: params.search,
    country: params.country,
    industry: params.industry,
    batchId: params.sourceId,
    ...(ownerUserIds !== null ? { ownerUserIds } : {}),
    limit: 2000,
  });

  // Mismas métricas de cabecera que "Candidatos por revisar", pero en el
  // contexto de descartadas. Se derivan de las filas ya cargadas — cero
  // queries adicionales, cero llamadas a proveedor.
  const newToday = items.filter((item) => isProspectCreatedToday(item.createdAt)).length;
  const autoDiscarded = items.filter((item) => item.disposition !== 'manual_discard').length;
  // `getDiscardedProspectsList` sólo devuelve filas en estado 'discarded' — una
  // métrica de "enviadas a revisión" leída de aquí siempre valdría 0, así que la
  // cuarta tarjeta cuenta descartes humanos, que sí viven en esta lista.
  const manualDiscards = items.length - autoDiscarded;

  return (
    <DataTablePage
      title="Prospectos"
      description="Empresas que el pipeline descartó automáticamente o que quedaron fuera de evaluación. Revísalas y envíalas de vuelta sin volver a buscar."
      tabs={<ModuleTabsNav active="descartadas" discardedCount={total} />}
      metrics={
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Descartadas en tu alcance"
            description="Total visible con tu alcance comercial"
            value={total}
            icon={
              <div className="rounded-lg p-1.5 bg-su-brand-soft">
                <Building2 className="h-4 w-4 text-su-brand" />
              </div>
            }
          />
          <MetricCard
            title="Nuevas hoy"
            description="Descartadas en el día"
            value={newToday}
            icon={
              <div className="rounded-lg p-1.5 bg-emerald-500/10">
                <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              </div>
            }
          />
          <MetricCard
            title="Descartadas por el pipeline"
            description="Sin decisión humana"
            value={autoDiscarded}
            icon={
              <div className="rounded-lg p-1.5 bg-muted/60">
                <Ban className="h-4 w-4 text-muted-foreground" />
              </div>
            }
          />
          <MetricCard
            title="Descartes manuales"
            description="Decisión humana en revisión"
            value={manualDiscards}
            icon={
              <div className="rounded-lg p-1.5 bg-orange-500/10">
                <UserRoundX className="h-4 w-4 text-orange-600 dark:text-orange-400" />
              </div>
            }
          />
        </div>
      }
    >
      <DiscardedProspectsDataTableClient
        items={items}
        scopeFilterOptions={scopeFilterOptions}
        currentUserId={params.userId ?? ''}
        currentGroupId={params.groupId ?? ''}
        currentRoleKey={params.roleKey ?? ''}
        sourceId={params.sourceId ?? undefined}
      />
    </DataTablePage>
  );
}
