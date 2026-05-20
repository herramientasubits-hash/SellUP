import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, Clock, WifiOff, ShieldCheck, Users } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import { getSamuIntegration } from '@/modules/integrations/actions';
import { SamuActionsPanel } from './samu-actions-client';
import type { SamuMetadata } from '@/modules/integrations/types';

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

export default async function SamuIntegrationPage() {
  const isAdmin = await isCurrentUserAdmin();
  if (!isAdmin) redirect('/settings');

  const integration = await getSamuIntegration();
  if (!integration) redirect('/settings/integrations');

  const conn = integration.connection;
  const hasCredential = conn?.credentials_status === 'stored';
  const metadata = conn?.metadata as SamuMetadata | null;

  return (
    <div className="space-y-8">
      <PageHeader
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

        {/* Información de la cuenta */}
        <SurfaceCard>
          <SurfaceCardHeader
            title="Información de la cuenta"
            description="Datos recuperados de Samu IA al probar la conexión."
          />
          {metadata?.user_count != null ? (
            <div className="flex items-center gap-3 rounded-lg border border-border/40 bg-muted/20 px-3 py-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-su-brand-soft text-su-brand shrink-0">
                <Users className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[11px] text-muted-foreground">Usuarios en el entorno</p>
                <p className="text-sm font-semibold text-foreground">{metadata.user_count}</p>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-6 text-center">
              <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-muted/40">
                <ShieldCheck className="h-5 w-5 text-muted-foreground/50" />
              </div>
              <p className="text-sm text-muted-foreground">
                Prueba la conexión para ver la información de la cuenta.
              </p>
            </div>
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
                className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  enabled ? 'bg-emerald-500' : 'bg-muted-foreground/25'
                }`}
              />
              <span
                className={`text-xs ${
                  enabled ? 'text-foreground' : 'text-muted-foreground/60'
                }`}
              >
                {label}
              </span>
              {!enabled && (
                <span className="ml-auto text-[10px] font-medium text-muted-foreground/50 border border-border/30 rounded-full px-2 py-0.5">
                  Próximamente
                </span>
              )}
            </div>
          ))}
        </div>
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
              Tu API Key se almacena de forma segura y exclusiva en el servidor mediante Vault.
              Nunca se expone en el navegador ni se registra en logs.
              SellUp solo la usa para validar la conexión con Samu IA.
            </p>
          </div>
        </div>
      </SurfaceCard>
    </div>
  );
}
