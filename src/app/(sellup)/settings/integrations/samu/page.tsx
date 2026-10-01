import { withAppTimeZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, Clock, WifiOff, ShieldCheck, Users } from "@/icons";
import { Badge } from '@/components/ui/badge';
import { EmptyState } from '@/components/ui/empty-state';
import { Alert } from '@/components/ui/alert';
import { PageHeader } from '@/components/shared/page-header';
import { Breadcrumbs } from '@/components/navigation/breadcrumbs';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSamuIntegration } from '@/modules/integrations/actions';
import { SamuActionsPanel } from './samu-actions-client';
import type { SamuMetadata } from '@/modules/integrations/types';

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

export default async function SamuIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getSamuIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as SamuMetadata | null;

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Configuración', href: '/settings' },
              { label: 'Integraciones comerciales', href: '/settings/integrations' },
              'Samu IA',
            ]}
          />
        }
        title="Samu IA"
        description="Conecta Samu IA para preparar la futura importación de reuniones, transcripciones e insumos post-reunión hacia SellUp."
        backHref="/settings/integrations"
      />

      {/* Estado de conexión + información de cuenta */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Estado */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Estado de la integración"
            description="Estado actual de credencial y conexión con Samu IA."
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

        {/* Información de la cuenta */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Información de la cuenta"
            description="Datos recuperados de Samu IA al probar la conexión."
          />
          {metadata?.user_count != null ? (
            <div className="flex items-center gap-3 rounded-lg border border-border/60 bg-surface-subtle px-3 py-3">
              <div className="flex size-9 items-center justify-center rounded-xl bg-primary/10 text-primary shrink-0">
                <Users className="size-4" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Usuarios en el entorno</p>
                <p className="text-sm font-semibold text-foreground">{metadata.user_count}</p>
              </div>
            </div>
          ) : (
            <EmptyState
              variant="plain"
              icon={ShieldCheck}
              title="Prueba la conexión para ver la información de la cuenta."
            />
          )}
        </SurfaceCard>
      </div>

      {/* Panel de acciones */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Acciones"
          description={
            hasCredential
              ? 'Prueba la conexión, actualiza la API Key o desconecta Samu IA.'
              : 'Ingresa tu API Key de Samu IA para activar la integración.'
          }
        />
        <SamuActionsPanel hasCredential={hasCredential} />
      </SurfaceCard>

      {/* Alcance de la integración */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Alcance de esta integración"
          description="Esta integración es administrativa. La importación de reuniones se habilitará en una fase posterior."
        />
        <div className="space-y-2">
          {[
            { label: 'Validar API Key y conexión con el entorno de Samu IA', enabled: true },
            { label: 'Consultar usuarios del entorno para confirmar permisos', enabled: true },
            { label: 'Importar reuniones y transcripciones', enabled: false },
            { label: 'Procesar insumos post-reunión con IA', enabled: false },
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
                  Próximamente
                </Badge>
              )}
            </div>
          ))}
        </div>
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
              Tu API Key se almacena de forma segura y exclusiva en el servidor mediante Vault.
              Nunca se expone en el navegador ni se registra en logs. SellUp solo la usa para
              validar la conexión con Samu IA.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
