import { redirect } from 'next/navigation';
import { Search, Sparkles, Database, CircleDashed, CheckCircle2, Clock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import {
  getAllProspectingProviders,
  getProspectingStats,
  getApolloConnection,
} from '@/modules/prospecting-config/actions';
import type { ProspectingProvider, ProviderType, LifecycleStatus } from '@/modules/prospecting-config/types';
import { ApolloProviderCard } from './apollo-provider-card';

// ============================================================
// Helpers de presentación
// ============================================================

function providerTypeLabel(type: ProviderType): string {
  switch (type) {
    case 'prospecting': return 'Prospección';
    case 'enrichment': return 'Enriquecimiento';
    case 'prospecting_and_enrichment': return 'Prospección y enriquecimiento';
  }
}

function lifecycleLabel(status: LifecycleStatus): { label: string; className: string; dotClass: string } {
  switch (status) {
    case 'prepared':
      return {
        label: 'Preparado para futura conexión',
        className: 'border-su-brand/30 bg-su-brand-soft text-su-brand',
        dotClass: 'bg-su-brand',
      };
    case 'planned':
      return {
        label: 'Contemplado',
        className: 'border-border/40 bg-muted/30 text-muted-foreground/70',
        dotClass: 'bg-muted-foreground/30',
      };
    case 'connected':
      return {
        label: 'Conectado',
        className: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-500',
        dotClass: 'bg-emerald-500',
      };
    case 'inactive':
      return {
        label: 'Inactivo',
        className: 'border-border/40 bg-muted/30 text-muted-foreground/50',
        dotClass: 'bg-muted-foreground/20',
      };
  }
}

// ============================================================
// Subcomponentes
// ============================================================

function StatCard({
  label,
  value,
  icon: Icon,
  valueClassName,
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  valueClassName?: string;
}) {
  return (
    <SurfaceCard>
      <div className="flex items-start justify-between">
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className={`text-2xl font-semibold tracking-tight ${valueClassName ?? 'text-foreground'}`}>
            {value}
          </p>
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft text-su-brand">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </SurfaceCard>
  );
}

function StaticProviderCard({ provider }: { provider: ProspectingProvider }) {
  const lifecycle = lifecycleLabel(provider.lifecycle_status);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title={provider.name}
        description={provider.description ?? undefined}
        actions={
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[10px] font-medium ${lifecycle.className}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${lifecycle.dotClass}`} />
            {lifecycle.label}
          </span>
        }
      />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/60 text-muted-foreground/50">
            {provider.provider_type === 'enrichment' ? (
              <Sparkles className="h-4 w-4" />
            ) : (
              <Search className="h-4 w-4" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {providerTypeLabel(provider.provider_type)}
          </span>
        </div>

        <span className="text-[11px] font-medium text-muted-foreground/50 cursor-default select-none">
          Conexión pendiente de definición
        </span>
      </div>
    </SurfaceCard>
  );
}

// ============================================================
// Página principal
// ============================================================

export default async function ProspectingPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const [providers, stats, apolloConnection] = await Promise.all([
    getAllProspectingProviders(),
    getProspectingStats(),
    getApolloConnection(),
  ]);

  const apolloProvider = providers.find((p) => p.provider_key === 'apollo');
  const otherProviders = providers.filter((p) => p.provider_key !== 'apollo');

  return (
    <div className="space-y-8">
      <PageHeader
        title="Prospección y enriquecimiento"
        description="Administra los proveedores externos que SellUp usa para generar y enriquecer prospectos."
        backHref="/settings"
      />

      {/* Resumen */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
          Resumen
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            label="Proveedores contemplados"
            value={stats.total}
            icon={Database}
          />
          <StatCard
            label="Preparados para conexión"
            value={stats.prepared}
            icon={CheckCircle2}
            valueClassName="text-su-brand"
          />
          <StatCard
            label="Aún sin evaluar"
            value={stats.total - stats.prepared}
            icon={Clock}
          />
          <StatCard
            label="Proveedor activo"
            value={stats.active_provider ?? 'No definido'}
            icon={CircleDashed}
            valueClassName={stats.active_provider ? 'text-emerald-500' : 'text-muted-foreground/60 text-base'}
          />
        </div>
      </div>

      {/* Proveedores */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground/60 mb-3">
          Proveedores
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {/* Apollo — tarjeta interactiva con conexión real */}
          {apolloProvider && (
            <ApolloProviderCard
              connection={apolloConnection}
              description={apolloProvider.description}
            />
          )}

          {/* Lusha y futuros — tarjetas estáticas */}
          {otherProviders.map((provider) => (
            <StaticProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </div>
    </div>
  );
}
