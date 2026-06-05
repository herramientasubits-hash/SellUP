import { redirect } from 'next/navigation';
import { Search, Sparkles, Database, CircleDashed, CheckCircle2, Clock } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { MetricCard } from '@/components/shared/metric-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import {
  getAllProspectingProviders,
  getProspectingStats,
  getApolloConnection,
  getLushaConnection,
} from '@/modules/prospecting-config/actions';
import type { ProspectingProvider, ProviderType, LifecycleStatus } from '@/modules/prospecting-config/types';
import { ApolloProviderCard } from './apollo-provider-card';
import { LushaProviderCard } from './lusha-provider-card';

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

  const [providers, stats, apolloConnection, lushaConnection] = await Promise.all([
    getAllProspectingProviders(),
    getProspectingStats(),
    getApolloConnection(),
    getLushaConnection(),
  ]);

  const apolloProvider = providers.find((p) => p.provider_key === 'apollo');
  const lushaProvider = providers.find((p) => p.provider_key === 'lusha');
  const otherProviders = providers.filter(
    (p) => p.provider_key !== 'apollo' && p.provider_key !== 'lusha'
  );

  const activeProviderNames = [
    apolloConnection?.connection_status === 'connected' ? 'Apollo' : null,
    lushaConnection?.connection_status === 'connected' ? 'Lusha' : null,
  ].filter(Boolean) as string[];

  const activeProviderLabel = activeProviderNames.length === 1 ? 'Proveedor activo' : 'Proveedores activos';
  const activeProviderValue = activeProviderNames.length > 0
    ? activeProviderNames.join(' + ')
    : 'No definido';

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
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <MetricCard
            title="Proveedores contemplados"
            description="Fuentes identificadas para discovery"
            value={stats.total}
            icon={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft text-su-brand">
                <Database className="h-4 w-4" />
              </div>
            }
          />
          <MetricCard
            title="Preparados para conexión"
            description="Listos para habilitar"
            value={stats.prepared}
            valueClassName="text-su-brand"
            icon={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-su-brand-soft text-su-brand">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            }
          />
          <MetricCard
            title="Aún sin evaluar"
            description="Pendientes de evaluación"
            value={stats.total - stats.prepared}
            icon={
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                <Clock className="h-4 w-4" />
              </div>
            }
          />
          <MetricCard
            title={activeProviderLabel}
            description="Proveedor activo actual"
            value={activeProviderValue}
            valueClassName={
              activeProviderNames.length > 0
                ? 'text-emerald-500 text-lg'
                : 'text-muted-foreground/60 text-base'
            }
            icon={
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-lg ${
                  activeProviderNames.length > 0
                    ? 'bg-emerald-500/10 text-emerald-500'
                    : 'bg-muted text-muted-foreground'
                }`}
              >
                <CircleDashed className="h-4 w-4" />
              </div>
            }
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

          {/* Lusha — tarjeta interactiva con conexión real */}
          {lushaProvider && (
            <LushaProviderCard
              connection={lushaConnection}
              description={lushaProvider.description}
            />
          )}

          {/* Futuros proveedores — tarjetas estáticas */}
          {otherProviders.map((provider) => (
            <StaticProviderCard key={provider.id} provider={provider} />
          ))}
        </div>
      </div>
    </div>
  );
}
