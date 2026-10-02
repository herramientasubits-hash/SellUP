import { redirect } from 'next/navigation';
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import {
  IntegrationCapabilities,
  IntegrationStatusCard,
  TechnicalRow,
} from '@/components/settings/integration-overview';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getGoogleCSEIntegration } from '@/modules/integrations/actions';
import { GoogleCSEActionsPanel } from './google-cse-actions-client';
import type { GoogleCSEMetadata } from '@/modules/integrations/types';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

export default async function GoogleCSEIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getGoogleCSEIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const isAvailable = integration.is_available;
  const hasCredential = conn?.credentials_status === 'stored';
  const cx_masked = integration.cx_masked;
  const metadata = conn?.metadata as GoogleCSEMetadata | null;

  const isReachable = isAvailable && hasCredential && conn?.connection_status === 'connected';

  return (
    <SettingsPage
      title="Google Custom Search"
      description="Buscador de Google que complementa a Tavily para encontrar empresas y comprobar sus sitios al prospectar."
      trail={[{ label: 'Integraciones comerciales', href: '/settings/integrations' }]}
    >
      {!isAvailable ? (
        <Alert variant="destructive">
          <AlertTitle>Google no permite usar este buscador todavía</AlertTitle>
          <AlertDescription>
            Google ya no da acceso automático a este servicio a cuentas nuevas. SellUp lo mantiene apagado
            hasta que la cuenta de Google de la empresa tenga acceso. El motivo exacto está en «Detalles
            técnicos».
          </AlertDescription>
        </Alert>
      ) : (
        <Alert variant="warning">
          <AlertTitle>Google da 100 búsquedas gratis al día</AlertTitle>
          <AlertDescription>
            Las demás cuestan unos 5 USD por cada 1.000. «Probar conexión» también gasta 1 búsqueda.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <IntegrationStatusCard
          name="Google Custom Search"
          hasCredential={hasCredential}
          connectionStatus={conn?.connection_status}
          lastTestedAt={conn?.last_tested_at}
          lastError={conn?.last_connection_error}
        >
          {/* Sin acceso de Google no hay nada que conectar ni probar. */}
          {isAvailable ? (
            <GoogleCSEActionsPanel hasCredential={hasCredential} cx_masked={cx_masked} />
          ) : (
            <p className="text-sm text-muted-foreground">
              No hay acciones disponibles mientras Google no dé acceso al buscador.
            </p>
          )}
        </IntegrationStatusCard>

        <IntegrationCapabilities
          name="Google Custom Search"
          description="Complementa la búsqueda de empresas. No reemplaza a Apollo, Lusha ni HubSpot."
          capabilities={[
            { label: 'Buscar empresas en la web al prospectar', state: isReachable ? 'ready' : 'pending' },
            { label: 'Comprobar el sitio web de una empresa', state: isReachable ? 'ready' : 'pending' },
            { label: 'Búsquedas libres lanzadas por el equipo', state: 'off' },
          ]}
        />
      </div>

      <TechnicalDetails summary="Identificador del buscador y resultado de la última prueba. Útil para soporte.">
        <div>
          {cx_masked && (
            <TechnicalRow label="Identificador del buscador (Search Engine ID)">
              <code className="font-mono">{cx_masked}</code>
            </TechnicalRow>
          )}
          {!isAvailable && (
            <TechnicalRow label="Respuesta de Google">
              <code className="font-mono">PERMISSION_DENIED</code> — Custom Search JSON API no disponible para este
              proyecto de Google Cloud
            </TechnicalRow>
          )}
          {metadata?.response_time_ms != null && (
            <TechnicalRow label="Tiempo de respuesta">{metadata.response_time_ms} ms</TechnicalRow>
          )}
          {metadata?.results_count != null && (
            <TechnicalRow label="Resultados que devolvió la prueba">{metadata.results_count}</TechnicalRow>
          )}
          {!cx_masked && isAvailable && metadata?.response_time_ms == null && (
            <p className="text-sm text-muted-foreground">Prueba la conexión para ver su resultado.</p>
          )}
        </div>
      </TechnicalDetails>
    </SettingsPage>
  );
}
