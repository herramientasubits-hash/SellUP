import { redirect } from 'next/navigation';
import { Search, Sparkles } from "@/icons";
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatusBadge, type StatusType } from '@/components/data-display/status-badge';
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

function lifecycleStatus(status: LifecycleStatus): { label: string; status: StatusType } {
  switch (status) {
    case 'prepared':
      return { label: 'Listo para conectar', status: 'info' };
    case 'planned':
      return { label: 'En estudio', status: 'neutral' };
    case 'connected':
      return { label: 'Conectado', status: 'active' };
    case 'inactive':
      return { label: 'Inactivo', status: 'inactive' };
  }
}

// ============================================================
// Subcomponentes
// ============================================================

function StaticProviderCard({ provider }: { provider: ProspectingProvider }) {
  const lifecycle = lifecycleStatus(provider.lifecycle_status);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title={provider.name}
        description={provider.description ?? undefined}
        actions={<StatusBadge status={lifecycle.status} label={lifecycle.label} />}
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

  const connectableCount = (apolloProvider ? 1 : 0) + (lushaProvider ? 1 : 0);

  return (
    <SettingsPage
      title="Prospección y enriquecimiento"
      description="Los proveedores con los que SellUp encuentra empresas y completa sus datos."
    >
      {/* Qué está en uso ahora, en una línea */}
      {activeProviderNames.length > 0 ? (
        <Alert variant="success">
          <AlertTitle>En uso: {activeProviderNames.join(' y ')}</AlertTitle>
          <AlertDescription>
            SellUp encuentra empresas y completa sus datos con{' '}
            {activeProviderNames.length === 1 ? 'este proveedor' : 'estos proveedores'}.
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="info">
          <AlertTitle>Todavía no hay ningún proveedor en uso</AlertTitle>
          <AlertDescription>
            Conecta uno de los proveedores de abajo y prueba su conexión para empezar a prospectar.
          </AlertDescription>
        </Alert>
      )}

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
