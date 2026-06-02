import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, Clock, WifiOff, ShieldCheck } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getHubSpotIntegration } from '@/modules/integrations/actions';
import { HubSpotActionsPanel } from './hubspot-actions-client';
import type { HubSpotMetadata } from '@/modules/integrations/types';
import { computeHubSpotScopeReadiness } from '@/server/services/hubspot-connection';

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

function ConnectionStatusBlock({
  connectionStatus,
}: {
  connectionStatus: string | undefined;
}) {
  const status = connectionStatus ?? 'not_tested';

  const map: Record<
    string,
    {
      label: string;
      icon: React.ComponentType<{ className?: string }>;
      color: string;
      bg: string;
      border: string;
    }
  > = {
    connected: {
      label: 'Conectado',
      icon: CheckCircle2,
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/30',
    },
    error: {
      label: 'Error de conexión',
      icon: XCircle,
      color: 'text-destructive',
      bg: 'bg-destructive/10',
      border: 'border-destructive/30',
    },
    disconnected: {
      label: 'Desconectado',
      icon: WifiOff,
      color: 'text-amber-500',
      bg: 'bg-amber-500/10',
      border: 'border-amber-500/30',
    },
    not_tested: {
      label: 'Sin probar',
      icon: Clock,
      color: 'text-muted-foreground',
      bg: 'bg-muted/30',
      border: 'border-border/40',
    },
  };

  const config = map[status] ?? map.not_tested;
  const Icon = config.icon;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 text-sm font-medium ${config.bg} ${config.border} ${config.color}`}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {config.label}
    </div>
  );
}

function ScopeRow({ label, active }: { label: string; active: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-border/40 last:border-b-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      {active ? (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
          Activo
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[10px] font-medium text-amber-500">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
          Falta permiso
        </span>
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
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2.5">
              <p className="text-[11px] text-amber-700 dark:text-amber-400 leading-relaxed">
                Para crear empresas automáticamente en HubSpot, la Private App debe incluir el scope{' '}
                <code className="font-mono font-semibold">crm.objects.companies.write</code>.
                Actualiza el token en HubSpot y vuelve a probar la conexión.
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border/40 bg-muted/30 px-3 py-2.5">
              <p className="text-[11px] text-muted-foreground leading-relaxed">
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

function MetaRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2.5 border-b border-border/40 last:border-b-0">
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

  return (
    <div className="space-y-8">
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
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-medium text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  Almacenada
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 bg-muted/30 px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground/60">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/25" />
                  No configurada
                </span>
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
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2">
                <p className="text-[11px] font-medium text-destructive mb-0.5">Último error</p>
                <p className="text-[11px] text-destructive/80">{conn.last_connection_error}</p>
              </div>
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
              {metadata.app_id && (
                <MetaRow label="App ID" value={metadata.app_id} />
              )}
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
                    <span
                      key={scope}
                      className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {scope}
                    </span>
                  ))}
                  {metadata.scopes.length > 8 && (
                    <span className="inline-flex items-center rounded-full border border-border/40 bg-muted/30 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      +{metadata.scopes.length - 8} más
                    </span>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/40">
                <ShieldCheck className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                Prueba la conexión para ver la información del portal.
              </p>
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Permisos HubSpot */}
      <ScopeReadinessCard scopes={metadata?.scopes} />

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
        <HubSpotActionsPanel
          hasCredential={hasCredential}
        />
      </SurfaceCard>

      {/* Nota de seguridad */}
      <SurfaceCard elevated>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
          <div>
            <p className="text-[0.8125rem] font-semibold text-foreground font-heading">
              Almacenamiento seguro de credenciales
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Tu access token se almacena de forma segura y exclusiva en el servidor.
              Nunca se expone en el navegador ni se registra en logs.
              SellUp solo lo usa para validar conexiones y preparar consultas futuras.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
