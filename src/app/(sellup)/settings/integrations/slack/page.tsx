import { redirect } from 'next/navigation';
import { Hash } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import {
  IntegrationCapabilities,
  IntegrationStatusCard,
  TechnicalRow,
} from '@/components/settings/integration-overview';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSlackIntegration } from '@/modules/integrations/actions';
import { SlackActionsPanel } from './slack-actions-client';
import type { SlackMetadata } from '@/modules/integrations/types';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function SlackIntegrationPage({ searchParams }: PageProps) {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getSlackIntegration();
  if (!integration) redirect('/settings/integrations');

  const params = await searchParams;
  const justConnected = params.connected === '1';
  const oauthError = typeof params.error === 'string' ? params.error : null;

  const conn = integration.connection;
  const isConnected =
    conn?.credentials_status === 'stored' && conn?.connection_status !== 'disconnected';
  const metadata = (conn?.metadata ?? {}) as SlackMetadata;
  const hasChannel = !!metadata.channel_id;

  const scopes = metadata.scopes ?? [];

  return (
    <SettingsPage
      title="Slack"
      description="Conecta el Slack de la empresa para que SellUp tenga su canal oficial y, más adelante, envíe ahí sus avisos."
      trail={[{ label: 'Integraciones comerciales', href: '/settings/integrations' }]}
    >
      {justConnected && (
        <Alert variant="success">
          Slack quedó conectado. El siguiente paso es crear el canal oficial de SellUp.
        </Alert>
      )}

      {oauthError && <Alert variant="destructive">{decodeURIComponent(oauthError)}</Alert>}

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <IntegrationStatusCard
          name="Slack"
          hasCredential={conn?.credentials_status === 'stored'}
          connectionStatus={conn?.connection_status}
          lastTestedAt={conn?.last_tested_at}
          lastError={conn?.last_connection_error}
          facts={[
            { label: 'Espacio de trabajo', value: metadata.team_name ?? <span className="text-text-muted">Sin conectar</span> },
            {
              label: 'Canal oficial',
              value: hasChannel ? (
                <span className="inline-flex items-center gap-1">
                  <Hash aria-hidden className="size-3.5 text-muted-foreground" />
                  {metadata.channel_name ?? 'Creado'}
                </span>
              ) : (
                <span className="text-text-muted">Aún no se ha creado</span>
              ),
            },
          ]}
        >
          <SlackActionsPanel isConnected={isConnected} />
        </IntegrationStatusCard>

        <IntegrationCapabilities
          name="Slack"
          description="Por ahora la conexión sirve para tener listo el canal. Los avisos automáticos llegarán después."
          capabilities={[
            { label: 'Comprobar que la conexión con Slack funciona', state: isConnected ? 'ready' : 'pending' },
            { label: 'Crear y usar el canal oficial de SellUp', state: hasChannel ? 'ready' : 'pending' },
            { label: 'Enviar avisos al canal', state: 'soon' },
          ]}
        />
      </div>

      <TechnicalDetails summary="Identificadores del espacio de trabajo y permisos concedidos a SellUp en Slack. Útil para soporte.">
        {metadata.team_id ? (
          <div>
            <TechnicalRow label="Identificador del espacio de trabajo (Team ID)">{metadata.team_id}</TechnicalRow>
            {metadata.bot_user_id && (
              <TechnicalRow label="Identificador del bot (Bot User ID)">{metadata.bot_user_id}</TechnicalRow>
            )}
            {metadata.channel_id && (
              <TechnicalRow label="Identificador del canal">{metadata.channel_id}</TechnicalRow>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {isConnected
              ? 'Prueba la conexión para ver los datos del espacio de trabajo.'
              : 'Conecta Slack para ver los datos del espacio de trabajo.'}
          </p>
        )}
        {scopes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Permisos concedidos ({scopes.length})</p>
            <div className="flex flex-wrap gap-1">
              {scopes.map((scope) => (
                <Badge key={scope} variant="neutral" className="font-mono">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        )}
      </TechnicalDetails>
    </SettingsPage>
  );
}
