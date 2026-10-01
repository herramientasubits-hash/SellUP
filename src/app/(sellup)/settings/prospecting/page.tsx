import { redirect } from 'next/navigation';
import { Search, Sparkles, CheckCircle2 } from "@/icons";
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
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
        label: 'Listo para conectar',
        className: 'border-primary/30 bg-primary/10 text-primary',
        dotClass: 'bg-primary',
      };
    case 'planned':
      return {
        label: 'En estudio',
        className: 'border-border/60 bg-surface-subtle text-muted-foreground',
        dotClass: 'bg-muted-foreground/30',
      };
    case 'connected':
      return {
        label: 'Conectado',
        className: 'border-success/30 bg-success/10 text-success',
        dotClass: 'bg-success',
      };
    case 'inactive':
      return {
        label: 'Inactivo',
        className: 'border-border/60 bg-surface-subtle text-muted-foreground',
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
          <Badge variant="outline" className={lifecycle.className}>
            <span className={`h-1.5 w-1.5 rounded-full ${lifecycle.dotClass}`} aria-hidden="true" />
            {lifecycle.label}
          </Badge>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-muted text-muted-foreground">
            {provider.provider_type === 'enrichment' ? (
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Search className="h-4 w-4" aria-hidden="true" />
            )}
          </div>
          <span className="text-xs text-muted-foreground">
            {providerTypeLabel(provider.provider_type)}
          </span>
        </div>

        <span className="cursor-default select-none text-xs font-medium text-muted-foreground">
          Aún no se puede conectar
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

  const activeProviderLabel = 'En uso';
  const connectableCount = (apolloProvider ? 1 : 0) + (lushaProvider ? 1 : 0);

  return (
    <SettingsPage
      title="Prospección y enriquecimiento"
      description="Los proveedores con los que SellUp encuentra empresas y completa sus datos."
    >
      {/* Qué está en uso ahora, en una línea */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-border/60 bg-surface-subtle px-4 py-3">
        <span className="text-sm text-muted-foreground">{activeProviderLabel}:</span>
        {activeProviderNames.length > 0 ? (
          activeProviderNames.map((name) => (
            <Badge key={name} variant="positive">
              <CheckCircle2 aria-hidden="true" />
              {name}
            </Badge>
          ))
        ) : (
          <span className="text-sm font-medium text-foreground">
            Ninguno todavía. Conecta uno de los proveedores de abajo para empezar a prospectar.
          </span>
        )}
      </div>

      {/* Los que se pueden conectar hoy */}
      {connectableCount === 0 ? (
        <EmptyState
          icon={Search}
          title="No hay proveedores para conectar"
          description="Cuando se habilite un proveedor de prospección para tu organización aparecerá aquí."
        />
      ) : (
        <div className="grid items-start gap-4 md:grid-cols-2">
          {apolloProvider && (
            <ApolloProviderCard
              connection={apolloConnection}
              description={apolloProvider.description}
            />
          )}
          {lushaProvider && (
            <LushaProviderCard
              connection={lushaConnection}
              description={lushaProvider.description}
            />
          )}
        </div>
      )}

      {/* Los que todavía no: fuera de la vista principal */}
      {otherProviders.length > 0 && (
        <TechnicalDetails
          title={`Otros proveedores en estudio (${otherProviders.length})`}
          summary={`De ${stats.total} proveedores evaluados, ${stats.prepared} están listos para conectarse. Estos aún no se pueden usar.`}
        >
          <div className="grid gap-4 md:grid-cols-2">
            {otherProviders.map((provider) => (
              <StaticProviderCard key={provider.id} provider={provider} />
            ))}
          </div>
        </TechnicalDetails>
      )}
    </SettingsPage>
  );
}
