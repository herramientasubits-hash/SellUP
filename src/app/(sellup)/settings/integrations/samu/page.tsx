import { redirect } from 'next/navigation';
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import {
  IntegrationCapabilities,
  IntegrationStatusCard,
  TechnicalRow,
} from '@/components/settings/integration-overview';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSamuIntegration } from '@/modules/integrations/actions';
import { SamuActionsPanel } from './samu-actions-client';
import type { SamuMetadata } from '@/modules/integrations/types';

export default async function SamuIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getSamuIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as SamuMetadata | null;

  const isReachable = hasCredential && conn?.connection_status === 'connected';

  return (
    <SettingsPage
      title="Samu IA"
      description="Conecta Samu IA para que, más adelante, SellUp pueda traer tus reuniones y sus transcripciones."
      trail={[{ label: 'Integraciones comerciales', href: '/settings/integrations' }]}
    >
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <IntegrationStatusCard
          name="Samu IA"
          hasCredential={hasCredential}
          connectionStatus={conn?.connection_status}
          lastTestedAt={conn?.last_tested_at}
          lastError={conn?.last_connection_error}
          facts={
            metadata?.user_count != null
              ? [{ label: 'Personas en la cuenta de Samu IA', value: metadata.user_count }]
              : []
          }
        >
          <SamuActionsPanel hasCredential={hasCredential} />
        </IntegrationStatusCard>

        <IntegrationCapabilities
          name="Samu IA"
          description="Hoy la conexión solo se deja lista. Traer reuniones a SellUp llegará en una etapa posterior."
          capabilities={[
            { label: 'Comprobar que la conexión con Samu IA funciona', state: isReachable ? 'ready' : 'pending' },
            { label: 'Ver cuántas personas hay en la cuenta', state: isReachable ? 'ready' : 'pending' },
            { label: 'Traer reuniones y transcripciones', state: 'soon' },
            { label: 'Preparar el seguimiento de cada reunión con IA', state: 'soon' },
          ]}
        />
      </div>

      <TechnicalDetails summary="Cómo se guarda la credencial de Samu IA. Útil para soporte.">
        <div>
          <TechnicalRow label="Credencial (API Key)">{hasCredential ? 'Guardada' : 'Sin guardar'}</TechnicalRow>
          <TechnicalRow label="Estado interno de la conexión">{conn?.connection_status ?? 'not_tested'}</TechnicalRow>
        </div>
      </TechnicalDetails>
    </SettingsPage>
  );
}
