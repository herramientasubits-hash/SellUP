import Link from 'next/link';
import { Database } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { getSourceCatalogViewModel } from '@/modules/source-catalog/queries';
import { getLatestConnectionTestsBySource } from '@/modules/source-catalog/history-queries';
import { SourceCatalogClient } from './source-catalog-client';

export const metadata = {
  title: 'Catálogo de fuentes — Configuración',
};

export default async function SourceCatalogPage() {
  const viewModel = getSourceCatalogViewModel();
  const latestTests = await getLatestConnectionTestsBySource();
  const { metrics } = viewModel;

  const metricCards = [
    { label: 'Total fuentes', value: metrics.total, highlight: false },
    { label: 'Verificadas', value: metrics.byOperationalStatus['operational_verified'] ?? 0, highlight: true, color: 'emerald' },
    { label: 'Requieren conexión', value: metrics.byOperationalStatus['connection_required'] ?? 0, highlight: false, color: 'amber' },
    { label: 'Pendientes validación', value: metrics.byOperationalStatus['pending_validation'] ?? 0, highlight: false, color: 'brand' },
    { label: 'Solo señal manual', value: metrics.byOperationalStatus['manual_signal_only'] ?? 0, highlight: false, color: 'muted' },
    { label: 'Solo validación', value: metrics.byOperationalStatus['validation_only'] ?? 0, highlight: false, color: 'muted' },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        title="Catálogo de fuentes"
        description="Consulta el estado, cobertura y prioridad de las fuentes de datos usadas por SellUp para discovery, inventario, validación y señales comerciales."
        backHref="/settings"
      />

      {/* Metric cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {metricCards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-border/50 bg-card p-4 space-y-1"
          >
            <p className="text-2xl font-semibold tabular-nums text-foreground">
              {card.value}
            </p>
            <p className="text-[11px] text-muted-foreground leading-tight">{card.label}</p>
          </div>
        ))}
      </div>

      <SourceCatalogClient viewModel={viewModel} latestTests={latestTests} />

      {/* Socrata batches access */}
      <div className="flex items-center justify-between rounded-xl border border-border/40 bg-muted/30 px-5 py-3.5">
        <div className="flex items-center gap-2.5">
          <Database className="h-4 w-4 shrink-0 text-muted-foreground/60" />
          <div>
            <p className="text-sm font-medium text-foreground">Lotes Socrata</p>
            <p className="text-xs text-muted-foreground">
              Revisión interna de lotes creados desde fuentes estructuradas.
            </p>
          </div>
        </div>
        <Link
          href="/settings/source-catalog/socrata-batches"
          className="shrink-0 rounded-md border border-border/50 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:border-su-brand/40 hover:bg-su-brand-soft hover:text-su-brand transition-colors"
        >
          Ver lotes Socrata
        </Link>
      </div>
    </div>
  );
}
