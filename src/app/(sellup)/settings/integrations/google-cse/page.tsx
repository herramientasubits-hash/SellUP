import { redirect } from 'next/navigation';
import {
  CheckCircle2,
  XCircle,
  Clock,
  WifiOff,
  ShieldCheck,
  Search,
  AlertTriangle,
  Ban,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getGoogleCSEIntegration } from '@/modules/integrations/actions';
import { GoogleCSEActionsPanel } from './google-cse-actions-client';
import type { GoogleCSEMetadata } from '@/modules/integrations/types';

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

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              { label: 'Integraciones comerciales', href: '/settings/integrations' },
              'Google Custom Search',
            ]}
          />
        }
        title="Google Custom Search"
        description="Proveedor de búsqueda web alternativo que usa Google Custom Search Engine. Complementa a Tavily con cobertura de resultados de Google para el Agente 1."
        backHref="/settings/integrations"
      />

      {!isAvailable && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-4">
          <Ban className="mt-0.5 size-5 shrink-0 text-destructive" />
          <div>
            <p className="text-sm font-semibold text-destructive ">
              Proveedor no disponible — Google Custom Search JSON API
            </p>
            <p className="mt-1 text-xs text-destructive leading-relaxed">
              Google Custom Search JSON API no está disponible para este proyecto de Google Cloud (
              <code className="rounded-sm bg-destructive/10 px-1 py-0.5 text-xs font-mono">
                PERMISSION_DENIED
              </code>
              ). La documentación oficial de Google indica que esta API no se otorga automáticamente
              a nuevos clientes. SellUp mantendrá este proveedor deshabilitado hasta que exista
              acceso válido.
            </p>
          </div>
        </div>
      )}

      {/* Estado de conexión + resultado del último test */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Estado */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Estado de la integración"
            description="Estado actual de credenciales y conexión con Google CSE."
          />
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Credenciales</span>
              {hasCredential ? (
                <Badge variant="positive">
                  <span className="size-1.5 rounded-full bg-success" />
                  Almacenadas
                </Badge>
              ) : (
                <Badge variant="neutral">
                  <span className="size-1.5 rounded-full bg-muted-foreground/40" />
                  No configuradas
                </Badge>
              )}
            </div>

            {cx_masked && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Search Engine ID</span>
                <code className="rounded-sm bg-muted px-2 py-0.5 text-xs font-mono text-foreground">
                  {cx_masked}
                </code>
              </div>
            )}

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

        {/* Resultado del último test */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Resultado del último test"
            description="Datos registrados en la última prueba de conexión exitosa."
          />
          {metadata?.response_time_ms != null ? (
            <div className="space-y-2">
              <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-subtle px-3 py-3">
                <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                  <Search className="size-4" />
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
              icon={Search}
              title="Prueba la conexión para ver el resultado."
            />
          )}
        </SurfaceCard>
      </div>

      {/* Aviso de cuota */}
      <SurfaceCard>
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
          <div>
            <p className="text-sm font-semibold text-foreground ">
              Google CSE tiene un límite de 100 consultas gratuitas/día
            </p>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              El plan gratuito incluye 100 consultas al día. Consultas adicionales cuestan $5 por
              cada 1,000 (~$0.005/consulta). El botón &ldquo;Probar conexión&rdquo; también consume
              1 consulta. Mantener Google CSE desactivado para usuarios finales hasta validar
              calidad y costos.
            </p>
          </div>
        </div>
      </SurfaceCard>

      {/* Panel de acciones — oculto si el proveedor no está disponible */}
      {isAvailable && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Acciones"
            description={
              hasCredential
                ? 'Prueba la conexión (consume 1 consulta), actualiza las credenciales o desconecta Google CSE.'
                : 'Ingresa tu API Key y Search Engine ID para activar la integración.'
            }
          />
          <GoogleCSEActionsPanel hasCredential={hasCredential} cx_masked={cx_masked} />
        </SurfaceCard>
      )}

      {/* Alcance */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Alcance de esta integración"
          description="Google CSE complementa el Agente 1 para investigación web. No reemplaza Apollo, Lusha ni HubSpot."
        />
        <div className="space-y-2">
          {[
            { label: 'Validar API Key, CX y conexión con Google CSE', enabled: true },
            { label: 'Búsqueda web controlada para el Agente 1', enabled: true },
            { label: 'Verificación de sitios web de empresas prospecto', enabled: true },
            { label: 'Búsquedas automáticas para usuarios finales', enabled: false },
            { label: 'Reemplazar Apollo / Lusha / HubSpot', enabled: false },
            { label: 'Ejecutar búsquedas desde esta pantalla de configuración', enabled: false },
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
              La API Key y el Search Engine ID se almacenan de forma segura en Supabase Vault. Nunca
              se exponen en el navegador ni se registran en logs. La API Key no volverá a mostrarse
              completa una vez guardada. SellUp solo las usa para búsquedas controladas del Agente
              1.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
