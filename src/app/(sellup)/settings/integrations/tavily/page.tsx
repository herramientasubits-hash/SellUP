import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, Clock, WifiOff, ShieldCheck, Globe, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getTavilyIntegration } from '@/modules/integrations/actions';
import { TavilyActionsPanel } from './tavily-actions-client';
import type { TavilyMetadata } from '@/modules/integrations/types';

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

export default async function TavilyIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getTavilyIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as TavilyMetadata | null;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Tavily"
        description="Proveedor de búsqueda web para validar empresas, sitios web y fuentes públicas. Usado por el Agente 1 para investigación de prospectos."
        backHref="/settings/integrations"
      />

      {/* Estado de conexión + información de la cuenta */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Estado */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Estado de la integración"
            description="Estado actual de credencial y conexión con Tavily."
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

        {/* Información de última prueba */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Resultado del último test"
            description="Datos registrados en la última prueba de conexión exitosa."
          />
          {metadata?.response_time_ms != null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-su-brand-soft text-su-brand shrink-0">
                  <Globe className="h-4 w-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-[11px] text-muted-foreground">Tiempo de respuesta</p>
                  <p className="text-sm font-semibold text-foreground">
                    {metadata.response_time_ms} ms
                  </p>
                </div>
              </div>
              {metadata.results_count != null && (
                <div className="flex items-center justify-between px-1">
                  <span className="text-xs text-muted-foreground">Resultados obtenidos</span>
                  <span className="text-xs font-medium text-foreground">
                    {metadata.results_count}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/40">
                <Globe className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                Prueba la conexión para ver el resultado.
              </p>
            </div>
          )}
        </SurfaceCard>
      </div>

      {/* Advertencia de créditos */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div>
            <p className="text-[0.8125rem] font-semibold text-foreground ">
              Tavily consume créditos por búsqueda
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Cada búsqueda real consume 1 crédito Tavily. El plan gratuito incluye
              aproximadamente 1,000 créditos/mes. El botón &ldquo;Probar conexión&rdquo;
              también consume 1 crédito. Mantener Tavily desactivado para usuarios
              finales hasta validar calidad y costos.
            </p>
          </div>
        </div>
      </SurfaceCard>

      {/* Panel de acciones */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Acciones"
          description={
            hasCredential
              ? 'Prueba la conexión (consume 1 crédito), actualiza la API Key o desconecta Tavily.'
              : 'Ingresa tu API Key de Tavily para activar la integración.'
          }
        />
        <TavilyActionsPanel hasCredential={hasCredential} />
      </SurfaceCard>

      {/* Alcance */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Alcance de esta integración"
          description="Tavily complementa el Agente 1 para investigación web. No reemplaza Apollo, Lusha ni HubSpot."
        />
        <div className="space-y-2">
          {[
            { label: 'Validar API Key y conexión con Tavily', enabled: true },
            { label: 'Búsqueda web controlada para el Agente 1', enabled: true },
            { label: 'Verificación de sitios web de empresas prospecto', enabled: true },
            { label: 'Búsquedas automáticas para usuarios finales', enabled: false },
            { label: 'Reemplazar Apollo / Lusha / HubSpot', enabled: false },
          ].map(({ label, enabled }) => (
            <div key={label} className="flex items-center gap-2.5">
              <span
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  enabled ? 'bg-emerald-500' : 'bg-muted-foreground/25'
                }`}
              />
              <span
                className={`text-xs ${enabled ? 'text-foreground' : 'text-muted-foreground/60'}`}
              >
                {label}
              </span>
              {!enabled && (
                <span className="ml-auto text-[10px] font-medium text-muted-foreground/50 border border-border/30 rounded-full px-2 py-0.5">
                  No aplica
                </span>
              )}
            </div>
          ))}
        </div>
      </SurfaceCard>

      {/* Seguridad */}
      <SurfaceCard elevated>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-su-brand" />
          <div>
            <p className="text-[0.8125rem] font-semibold text-foreground ">
              Almacenamiento seguro de credenciales
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Tu API Key se almacena de forma segura y exclusiva en el servidor mediante Vault.
              Nunca se expone en el navegador ni se registra en logs.
              SellUp solo la usa para búsquedas controladas del Agente 1.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
