import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, Clock, WifiOff, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
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

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function ConnectionStatusBlock({ connectionStatus }: { connectionStatus: string | undefined }) {
  const status = connectionStatus ?? 'not_tested';

  const map: Record<
    string,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      variant: 'positive' | 'negative' | 'warning' | 'neutral';
    }
  > = {
    connected: {
      label: 'Conectado',
      icon: CheckCircle2,
      variant: 'positive',
    },
    error: {
      label: 'Error de conexión',
      icon: XCircle,
      variant: 'negative',
    },
    disconnected: {
      label: 'Desconectado',
      icon: WifiOff,
      variant: 'warning',
    },
    not_tested: {
      label: 'Sin probar',
      icon: Clock,
      variant: 'neutral',
    },
  };

  const config = map[status] ?? map.not_tested;
  const Icon = config.icon;

  return (
    <Badge variant={config.variant}>
      <Icon />
      {config.label}
    </Badge>
  );
}

function ScopeRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/60 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {active ? (
        <Badge variant="positive">
          <span className="size-1.5 rounded-full bg-success" />
          Activo
        </Badge>
      ) : (
        <Badge variant="warning">
          <span className="size-1.5 rounded-full bg-warning" />
          Falta permiso
        </Badge>
      )}
    </div>
  );
}

function ScopeReadinessCard({ scopes }: { scopes: string[] | undefined }) {
  if (!scopes) return null;

  const readiness = computeHubSpotScopeReadiness(scopes);

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Permisos HubSpot"
        description="Scopes de acceso requeridos para operaciones de CRM en SellUp."
      />
      <div>
        <ScopeRow label="Lectura de empresas" active={readiness.canReadCompanies} />
        <ScopeRow label="Escritura de empresas" active={readiness.canWriteCompanies} />
        <div className="pt-3">
          {!readiness.canWriteCompanies ? (
            <div className="rounded-lg border border-warning/25 bg-warning/15 px-3 py-2.5">
              <p className="text-xs text-warning leading-relaxed">
                Para crear empresas automáticamente en HubSpot, la Private App debe incluir el scope{' '}
                <code className="font-mono font-semibold">crm.objects.companies.write</code>.
                Actualiza el token en HubSpot y vuelve a probar la conexión.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/60 bg-surface-subtle px-3 py-2.5">
              <p className="text-xs text-muted-foreground leading-relaxed">
                SellUp tiene permisos para crear companies en HubSpot. La escritura seguirá
                desactivada hasta habilitar la automatización correspondiente.
              </p>
            </div>
          )}
        </div>
      </div>
    </SurfaceCard>
  );
}

function ReadinessCheckRow({ label, ok, hint }: { label: string; ok: boolean; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5 border-b border-border/60 last:border-b-0">
      <div className="flex-1 min-w-0">
        <span className="text-xs text-muted-foreground">{label}</span>
        {hint && !ok && <p className="mt-0.5 text-xs text-warning leading-relaxed">{hint}</p>}
      </div>
      {ok ? (
        <Badge variant="positive" className="shrink-0">
          <span className="size-1.5 rounded-full bg-success" />
          Listo
        </Badge>
      ) : (
        <Badge variant="warning" className="shrink-0">
          <span className="size-1.5 rounded-full bg-warning" />
          Falta
        </Badge>
      )}
    </div>
  );
}

function ContactSyncReadinessCard({ readiness }: { readiness: HubSpotContactSyncReadiness }) {
  const { ok, status, checks, missingScopes } = readiness;

  const summaryConfig: Record<
    typeof status,
    { label: string; description: string; variant: 'success' | 'warning' | 'default' }
  > = {
    ready: {
      label: 'Listo para sincronizar contactos',
      description: 'SellUp puede crear contactos en HubSpot y asociarlos con empresas existentes.',
      variant: 'success',
    },
    not_connected: {
      label: 'HubSpot no está conectado',
      description: 'Conecta HubSpot antes de sincronizar contactos.',
      variant: 'default',
    },
    missing_credentials: {
      label: 'Faltan credenciales',
      description: 'Guarda el Private App Access Token de HubSpot para continuar.',
      variant: 'warning',
    },
    missing_vault_secret: {
      label: 'Falta vincular la credencial segura',
      description:
        'La conexión existe, pero SellUp no tiene asociado el secreto del token en Vault. Guarda nuevamente el token.',
      variant: 'warning',
    },
    missing_scopes: {
      label: 'Faltan permisos en la Private App',
      description: `Agrega los siguientes scopes al Private App de HubSpot: ${missingScopes.join(', ')}.`,
      variant: 'warning',
    },
  };

  const summary = summaryConfig[status];

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Estado para sincronización de contactos"
        description="Verifica que HubSpot esté listo para crear y asociar contactos desde SellUp."
      />
      <div className="space-y-4">
        <Alert variant={summary.variant}>
          <p className="text-sm font-semibold">{summary.label}</p>
          <p className="text-xs leading-relaxed">{summary.description}</p>
        </Alert>

        <div>
          <ReadinessCheckRow label="Conexión activa" ok={checks.integrationConnected} />
          <ReadinessCheckRow label="Credenciales almacenadas" ok={checks.credentialsStored} />
          <ReadinessCheckRow
            label="Token vinculado en Vault"
            ok={checks.vaultSecretLinked}
            hint="Guarda nuevamente el token en el panel de Acciones."
          />
          <ReadinessCheckRow
            label="Permiso para leer contactos"
            ok={checks.contactsRead}
            hint="Agrega crm.objects.contacts.read al Private App de HubSpot."
          />
          <ReadinessCheckRow
            label="Permiso para crear contactos"
            ok={checks.contactsWrite}
            hint="Agrega crm.objects.contacts.write al Private App de HubSpot."
          />
          <ReadinessCheckRow
            label="Permiso para leer empresas"
            ok={checks.companiesRead}
            hint="Agrega crm.objects.companies.read al Private App de HubSpot."
          />
          <ReadinessCheckRow
            label="Permiso para asociar con empresas"
            ok={checks.companiesWrite}
            hint="Agrega crm.objects.companies.write al Private App de HubSpot."
          />
        </div>
      </div>
    </SurfaceCard>
  );
}

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border/60 last:border-b-0">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className="text-xs font-medium text-foreground text-right">{value}</span>
    </div>
  );
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

  return (
    <div className="space-y-6">
      <PageHeader
        title="HubSpot"
        description="Administra la conexión comercial principal de SellUp para validar información de cuentas y preparar futuras sincronizaciones controladas."
        backHref="/settings/integrations"
      />

      {/* Estado de conexión + acciones */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Estado */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Estado de la integración"
            description="Estado actual de credencial y conexión con HubSpot."
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Credencial</span>
              {hasCredential ? (
                <Badge variant="positive">
                  <span className="size-1.5 rounded-full bg-success" />
                  Almacenada
                </Badge>
              ) : (
                <Badge variant="neutral">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  No configurada
                </Badge>
              )}
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Conexión</span>
              <ConnectionStatusBlock connectionStatus={conn?.connection_status} />
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Última prueba</span>
              <span className="text-xs font-medium text-foreground">
                {formatDate(conn?.last_tested_at ?? null)}
              </span>
            </div>

            {conn?.last_connection_error && (
              <Alert variant="destructive">
                <p className="text-xs font-medium">Último error</p>
                <p className="text-xs">{conn.last_connection_error}</p>
              </Alert>
            )}
          </div>
        </SurfaceCard>

        {/* Información del portal (disponible si está conectado) */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Información del portal"
            description="Datos recuperados del portal de HubSpot al probar la conexión."
          />
          {metadata?.hub_id ? (
            <div>
              <MetaRow label="Hub ID" value={metadata.hub_id} />
              {metadata.app_id && <MetaRow label="App ID" value={metadata.app_id} />}
              <MetaRow
                label="Scopes detectados"
                value={
                  metadata.scopes && metadata.scopes.length > 0
                    ? `${metadata.scopes.length} scope${metadata.scopes.length !== 1 ? 's' : ''}`
                    : '—'
                }
              />
              {metadata.scopes && metadata.scopes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {metadata.scopes.slice(0, 8).map((scope) => (
                    <Badge key={scope} variant="neutral">
                      {scope}
                    </Badge>
                  ))}
                  {metadata.scopes.length > 8 && (
                    <Badge variant="neutral">+{metadata.scopes.length - 8} más</Badge>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-xl bg-surface-subtle">
                <ShieldCheck className="size-5 text-muted-foreground" />
              </div>
              <p className="text-sm text-muted-foreground">
                Prueba la conexión para ver la información del portal.
              </p>
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Permisos HubSpot (companies legacy) */}
      <ScopeReadinessCard scopes={metadata?.scopes} />

      {/* Readiness para sincronización de contactos */}
      <ContactSyncReadinessCard readiness={contactSyncReadiness} />

      {/* Panel de acciones */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Acciones"
          description={
            hasCredential
              ? 'Prueba la conexión, actualiza la credencial o desconecta HubSpot.'
              : 'Ingresa tu Private App Access Token para conectar HubSpot.'
          }
        />
        <HubSpotActionsPanel hasCredential={hasCredential} />
      </SurfaceCard>

      {/* Nota de seguridad */}
      <SurfaceCard elevated>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground ">
              Almacenamiento seguro de credenciales
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Tu access token se almacena de forma segura y exclusiva en el servidor. Nunca se
              expone en el navegador ni se registra en logs. SellUp solo lo usa para validar
              conexiones y preparar consultas futuras.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
