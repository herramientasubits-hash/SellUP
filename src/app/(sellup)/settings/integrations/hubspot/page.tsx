import { redirect } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { SettingsPage, TechnicalDetails } from '@/components/settings/settings-page';
import {
  IntegrationCapabilities,
  IntegrationStatusCard,
  TechnicalRow,
  type CapabilityState,
  type IntegrationCapability,
} from '@/components/settings/integration-overview';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getHubSpotIntegration } from '@/modules/integrations/actions';
import { HubSpotActionsPanel } from './hubspot-actions-client';
import type { HubSpotMetadata } from '@/modules/integrations/types';
import { computeHubSpotScopeReadiness } from '@/server/services/hubspot-connection';
import {
  computeHubSpotContactSyncReadiness,
  type HubSpotConnectionRow,
  type HubSpotContactSyncReadiness,
} from '@/server/integrations/hubspot-contact-sync';

/** El resumen de si ya se pueden enviar contactos a HubSpot, sin nombres de permisos. */
const CONTACT_SYNC_SUMMARY: Record<
  HubSpotContactSyncReadiness['status'],
  { label: string; description: string; variant: 'success' | 'warning' | 'default' }
> = {
  ready: {
    label: 'Listo para enviar contactos a HubSpot',
    description: 'SellUp puede crear contactos en HubSpot y asociarlos con sus empresas.',
    variant: 'success',
  },
  not_connected: {
    label: 'HubSpot no está conectado',
    description: 'Conecta HubSpot antes de enviar contactos.',
    variant: 'default',
  },
  missing_credentials: {
    label: 'Falta la credencial',
    description: 'Guarda la credencial de HubSpot para continuar.',
    variant: 'warning',
  },
  missing_vault_secret: {
    label: 'Hay que guardar la credencial de nuevo',
    description: 'La conexión existe, pero la credencial no quedó bien guardada. Usa «Actualizar credencial».',
    variant: 'warning',
  },
  missing_scopes: {
    label: 'A la conexión le faltan permisos',
    description:
      'En HubSpot, da a la aplicación de SellUp los permisos marcados abajo como «Falta permiso» y vuelve a probar la conexión.',
    variant: 'warning',
  },
};

const MISSING_PERMISSION_HINT =
  'Añade este permiso a la aplicación de SellUp en HubSpot. El nombre exacto está en «Detalles técnicos».';

/** Sin permisos leídos todavía no se afirma que falten: queda «Por comprobar». */
function capabilityState(ok: boolean, permissionsKnown: boolean): CapabilityState {
  if (!permissionsKnown) return 'pending';
  return ok ? 'ready' : 'missing';
}

export default async function HubSpotIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getHubSpotIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as HubSpotMetadata | null;

  const connectionRow: HubSpotConnectionRow | null = conn
    ? {
        connection_status: conn.connection_status,
        credentials_status: conn.credentials_status,
        vault_secret_id: conn.vault_secret_id,
        metadata: conn.metadata,
      }
    : null;
  const contactSyncReadiness = computeHubSpotContactSyncReadiness(connectionRow);

  const scopes = metadata?.scopes ?? [];
  const companyReadiness = metadata?.scopes ? computeHubSpotScopeReadiness(metadata.scopes) : null;
  const { checks, missingScopes, status: contactSyncStatus } = contactSyncReadiness;
  const contactSyncSummary = CONTACT_SYNC_SUMMARY[contactSyncStatus];

  // Los permisos se leen al probar la conexión: antes de eso no se conocen.
  const permissionsKnown = hasCredential && Array.isArray(metadata?.scopes);
  const capabilities: IntegrationCapability[] = [
    {
      label: 'Consultar empresas',
      state: capabilityState(checks.companiesRead, permissionsKnown),
      hint: MISSING_PERMISSION_HINT,
    },
    {
      label: 'Crear empresas y asociarles contactos',
      state: capabilityState(checks.companiesWrite, permissionsKnown),
      hint: MISSING_PERMISSION_HINT,
    },
    {
      label: 'Consultar contactos',
      state: capabilityState(checks.contactsRead, permissionsKnown),
      hint: MISSING_PERMISSION_HINT,
    },
    {
      label: 'Crear contactos',
      state: capabilityState(checks.contactsWrite, permissionsKnown),
      hint: MISSING_PERMISSION_HINT,
    },
  ];

  return (
    <SettingsPage
      title="HubSpot"
      description="El CRM del equipo. SellUp lo consulta para no duplicar empresas y, cuando lo autorices, le envía empresas y contactos."
      trail={[{ label: 'Integraciones comerciales', href: '/settings/integrations' }]}
    >
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <IntegrationStatusCard
          name="HubSpot"
          hasCredential={hasCredential}
          connectionStatus={conn?.connection_status}
          lastTestedAt={conn?.last_tested_at}
          lastError={conn?.last_connection_error}
        >
          <HubSpotActionsPanel hasCredential={hasCredential} />
        </IntegrationStatusCard>

        <IntegrationCapabilities
          name="HubSpot"
          description="Depende de los permisos que tenga la conexión. Tener el permiso no envía nada por sí solo: cada envío se autoriza aparte."
          capabilities={capabilities}
        >
          <Alert variant={contactSyncSummary.variant}>
            <p className="text-sm font-semibold">{contactSyncSummary.label}</p>
            <p className="text-xs leading-relaxed">{contactSyncSummary.description}</p>
          </Alert>
        </IntegrationCapabilities>
      </div>

      <TechnicalDetails summary="Identificadores de la cuenta de HubSpot, permisos concedidos y comprobaciones internas. Útil para soporte.">
        {metadata?.hub_id ? (
          <div>
            <TechnicalRow label="Identificador de la cuenta (Hub ID)">{metadata.hub_id}</TechnicalRow>
            {metadata.app_id && <TechnicalRow label="Identificador de la aplicación (App ID)">{metadata.app_id}</TechnicalRow>}
            <TechnicalRow label="Credencial guardada">{checks.credentialsStored ? 'Sí' : 'No'}</TechnicalRow>
            <TechnicalRow label="Credencial vinculada al almacén seguro">
              {checks.vaultSecretLinked ? 'Sí' : 'No — guarda la credencial de nuevo'}
            </TechnicalRow>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Prueba la conexión para ver los datos de la cuenta de HubSpot.
          </p>
        )}

        {missingScopes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">Permisos que faltan</p>
            <div className="flex flex-wrap gap-1">
              {missingScopes.map((scope) => (
                <Badge key={scope} variant="warning" className="font-mono">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {companyReadiness && companyReadiness.missingWriteScopes.length > 0 && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            Para crear empresas, la aplicación de SellUp en HubSpot necesita{' '}
            <code className="font-mono font-semibold text-foreground">
              {companyReadiness.missingWriteScopes.join(', ')}
            </code>
            .
          </p>
        )}

        {scopes.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground">
              Permisos concedidos ({scopes.length})
            </p>
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
