import { redirect } from 'next/navigation';
import { AlertTriangle } from "@/icons";
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import {
  IntegrationCapabilities,
  IntegrationStatusCard,
  TechnicalRow,
} from '@/components/settings/integration-overview';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getTavilyIntegration } from '@/modules/integrations/actions';
import { TavilyActionsPanel } from './tavily-actions-client';
import type { TavilyMetadata } from '@/modules/integrations/types';

export default async function TavilyIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getTavilyIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as TavilyMetadata | null;

  const isReachable = hasCredential && conn?.connection_status === 'connected';

  return (
    <SettingsPage
      title="Tavily"
      description="Buscador web que usa SellUp para encontrar empresas y comprobar sus sitios al prospectar."
      trail={[{ label: 'Integraciones comerciales', href: '/settings/integrations' }]}
    >
      {/* Lo que cuesta usarlo, antes de probar nada */}
      <div className="flex items-start gap-3 rounded-xl border border-warning/25 bg-warning/15 px-4 py-3">
        <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0 text-warning" />
        <p className="text-sm leading-relaxed text-foreground">
          <span className="font-semibold">Cada búsqueda gasta 1 crédito de Tavily</span>, y «Probar conexión»
          también. El plan gratuito trae unos 1.000 créditos al mes.
        </p>
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <IntegrationStatusCard
          name="Tavily"
          hasCredential={hasCredential}
          connectionStatus={conn?.connection_status}
          lastTestedAt={conn?.last_tested_at}
          lastError={conn?.last_connection_error}
        >
          <TavilyActionsPanel hasCredential={hasCredential} />
        </IntegrationStatusCard>

        <IntegrationCapabilities
          name="Tavily"
          description="Tavily complementa la búsqueda de empresas. No reemplaza a Apollo, Lusha ni HubSpot."
          capabilities={[
            { label: 'Buscar empresas en la web al prospectar', state: isReachable ? 'ready' : 'pending' },
            { label: 'Comprobar el sitio web de una empresa', state: isReachable ? 'ready' : 'pending' },
            { label: 'Búsquedas libres lanzadas por el equipo', state: 'off' },
          ]}
        />
      </div>

      <TechnicalDetails summary="Resultado de la última prueba de conexión. Útil para soporte.">
        {metadata?.response_time_ms != null ? (
          <div>
            <TechnicalRow label="Tiempo de respuesta">{metadata.response_time_ms} ms</TechnicalRow>
            {metadata.results_count != null && (
              <TechnicalRow label="Resultados que devolvió la prueba">{metadata.results_count}</TechnicalRow>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Prueba la conexión para ver su resultado.</p>
        )}
      </TechnicalDetails>
    </SettingsPage>
  );
}
