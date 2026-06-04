import { Building2, CheckCircle2, GitMerge, Upload, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { CreateCandidateDrawer } from '@/components/prospect-batches/create-candidate-drawer';
import { ImportCandidatesDrawer } from '@/components/prospect-batches/import-candidates-drawer';
import { ProspectsTrayClient } from '@/components/prospects/prospects-tray-client';
import {
  getGlobalCandidatesList,
  getGlobalProspectsKPIs,
  requireActiveUser,
} from '@/modules/prospect-batches/actions';
import type { ProspectCandidateWithReviewer } from '@/modules/prospect-batches/types';

interface PageProps {
  searchParams: Promise<{
    search?: string;
    country?: string;
    industry?: string;
    source?: string;
    status?: string;
    page?: string;
  }>;
}

export default async function ProspectsPage({ searchParams }: PageProps) {
  // Enforce auth check and session retrieval
  await requireActiveUser();

  const params = await searchParams;
  const limit = 50;
  const page = Number(params.page ?? '1');
  const offset = (page - 1) * limit;

  // Map status filter
  let statuses = ['needs_review', 'generated', 'normalized'];
  if (params.status) {
    if (params.status === 'pending') {
      statuses = ['needs_review', 'generated', 'normalized'];
    } else {
      statuses = [params.status];
    }
  }

  // Fetch both the KPIs and candidate lists in parallel
  const [kpis, listResult] = await Promise.all([
    getGlobalProspectsKPIs(),
    getGlobalCandidatesList({
      search: params.search,
      country: params.country,
      industry: params.industry,
      source: params.source,
      statuses,
      limit,
      offset,
    }),
  ]);

  const { candidates, total } = listResult;

  const summaryCards = [
    {
      label: 'Pendientes de revisión',
      value: kpis.needsReview,
      icon: Building2,
      color: 'text-su-brand',
      bg: 'bg-su-brand-soft',
    },
    {
      label: 'Listos para aprobar',
      value: kpis.readyForApproval,
      icon: CheckCircle2,
      color: 'text-emerald-600 dark:text-emerald-400',
      bg: 'bg-emerald-500/10',
    },
    {
      label: 'Posibles duplicados',
      value: kpis.possibleDuplicates,
      icon: GitMerge,
      color: 'text-orange-600 dark:text-orange-400',
      bg: 'bg-orange-500/10',
    },
    {
      label: 'Importados recientemente',
      value: kpis.importedRecently,
      icon: Upload,
      color: 'text-blue-600 dark:text-blue-400',
      bg: 'bg-blue-500/10',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Bandeja de Prospectos"
        description="Revisa empresas candidatas antes de convertirlas en cuentas operativas."
        actions={
          <div className="flex items-center gap-2">
            <ImportCandidatesDrawer>
              <Button variant="outline" size="sm" className="gap-2 text-xs">
                <Upload className="h-3.5 w-3.5" />
                Importar prospectos
              </Button>
            </ImportCandidatesDrawer>
            <CreateCandidateDrawer 
              triggerText="Crear prospecto" 
              triggerVariant="default" 
            />
          </div>
        }
      />

      {/* KPIs Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {summaryCards.map((card) => (
          <SurfaceCard key={card.label} className="py-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                  {card.label}
                </p>
                <p className="mt-1.5 text-2xl font-semibold tabular-nums text-foreground">
                  {card.value}
                </p>
              </div>
              <div className={`rounded-lg p-1.5 ${card.bg}`}>
                <card.icon className={`h-4 w-4 ${card.color}`} />
              </div>
            </div>
          </SurfaceCard>
        ))}
      </div>

      {/* Info note */}
      <div className="rounded-xl border border-border/40 bg-muted/40 px-5 py-3.5 text-xs text-muted-foreground">
        Esta bandeja reúne todos los candidatos de prospección. Utiliza el menú de acciones para aprobar (convertir en cuenta operativa), marcar como duplicado o descartar candidatos según corresponda.
      </div>

      {/* Prospects Tray with table, filters and pagination */}
      <ProspectsTrayClient
        candidates={candidates as ProspectCandidateWithReviewer[]}
        total={total}
        limit={limit}
        page={page}
      />
    </div>
  );
}
