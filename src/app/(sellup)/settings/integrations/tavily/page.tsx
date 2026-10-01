import { withAppTimeZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  Clock,
  WifiOff,
  ShieldCheck,
  Globe,
  AlertTriangle,
} from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getTavilyIntegration } from '@/modules/integrations/actions';
import { TavilyActionsPanel } from './tavily-actions-client';
import type { TavilyMetadata } from '@/modules/integrations/types';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', withAppTimeZone({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })).format(new Date(iso));
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

export default async function TavilyIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getTavilyIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as TavilyMetadata | null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              { label: 'Integraciones comerciales', href: '/settings/integrations' },
              'Tavily',
            ]}
          />
        }
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

        {/* Información de última prueba */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Resultado del último test"
            description="Datos registrados en la última prueba de conexión exitosa."
          />
          {metadata?.response_time_ms != null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-subtle px-3 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <Globe className="size-4" />
                </div>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Tiempo de respuesta</p>
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
            <EmptyState
              variant="plain"
              icon={Globe}
              title="Prueba la conexión para ver el resultado."
            />
          )}
        </SurfaceCard>
      </div>

      {/* Advertencia de créditos */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold text-foreground ">
              Tavily consume créditos por búsqueda
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Cada búsqueda real consume 1 crédito Tavily. El plan gratuito incluye aproximadamente
              1,000 créditos/mes. El botón &ldquo;Probar conexión&rdquo; también consume 1 crédito.
              Mantener Tavily desactivado para usuarios finales hasta validar calidad y costos.
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
                className={`size-1.5 rounded-full shrink-0 ${
                  enabled ? 'bg-success' : 'bg-muted-foreground/40'
                }`}
              />
              <span className={`text-xs ${enabled ? 'text-foreground' : 'text-muted-foreground'}`}>
                {label}
              </span>
              {!enabled && (
                <Badge variant="neutral" className="ml-auto">
                  No aplica
                </Badge>
              )}
            </div>
          ))}
        </div>
      </SurfaceCard>

      {/* Seguridad */}
      <SurfaceCard elevated>
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground ">
              Almacenamiento seguro de credenciales
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              Tu API Key se almacena de forma segura y exclusiva en el servidor mediante Vault.
              Nunca se expone en el navegador ni se registra en logs. SellUp solo la usa para
              búsquedas controladas del Agente 1.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
