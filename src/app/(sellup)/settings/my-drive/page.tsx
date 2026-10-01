import { withAppTimeZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, WifiOff, Clock, FolderOpen, AlertTriangle } from "@/icons";
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { hasActiveAccess } from '@/modules/access/actions';
import { getUserDriveConnection } from '@/modules/drive/actions';
import { DriveActionsPanel } from './drive-actions-client';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', withAppTimeZone({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })).format(new Date(iso));
}

function ConnectionStatusBlock({ status }: { status: string }) {
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
      color: 'text-success',
      bg: 'bg-success/10',
      border: 'border-success/20',
    },
    error: {
      label: 'Error de conexión',
      icon: XCircle,
      color: 'text-destructive',
      bg: 'bg-destructive/10',
      border: 'border-destructive/20',
    },
    disconnected: {
      label: 'Desconectado',
      icon: WifiOff,
      color: 'text-muted-foreground',
      bg: 'bg-surface-subtle',
      border: 'border-border/60',
    },
    not_connected: {
      label: 'No conectado',
      icon: Clock,
      color: 'text-muted-foreground',
      bg: 'bg-surface-subtle',
      border: 'border-border/60',
    },
  };

  const cfg = map[status] ?? map['not_connected'];
  const Icon = cfg.icon;

  return (
    <div className={`flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 ${cfg.bg} ${cfg.border}`}>
      <Icon className={`h-4 w-4 shrink-0 ${cfg.color}`} aria-hidden="true" />
      <span className={`truncate text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
    </div>
  );
}

interface PageProps {
  searchParams: Promise<{ connected?: string; error?: string }>;
}

export default async function MyDrivePage({ searchParams }: PageProps) {
  const isActive = await hasActiveAccess();
  if (!isActive) redirect('/settings');

  const params = await searchParams;
  const justConnected = params.connected === '1';
  const errorParam = params.error;

  const conn = await getUserDriveConnection();

  const status = conn?.connection_status ?? 'not_connected';

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi Google Drive"
        description="Conecta tu Drive para guardar y organizar los archivos que SellUp genere en tu espacio de trabajo."
      />

      {/* Banner de éxito */}
      {justConnected && (
        <div className="flex items-start gap-2 rounded-xl border border-success/20 bg-success/10 px-4 py-3 text-sm text-success">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          Google Drive conectado correctamente. La carpeta SellUp está lista en tu Drive.
        </div>
      )}

      {/* Banner de error */}
      {errorParam && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 break-words">{errorParam}</span>
        </div>
      )}

      {/* Estado de conexión */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Estado de la conexión"
          description="Cada persona conecta su propio Drive. Esta conexión es solo tuya."
        />

        <div className="space-y-4">
          {/* Estado: una sola respuesta a «¿funciona?» */}
          <div className="min-w-0 space-y-1.5">
            <p className="text-xs font-semibold text-muted-foreground">Estado</p>
            <ConnectionStatusBlock status={status} />
          </div>

          {/* Carpeta raíz */}
          {conn?.drive_folder_id && (
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Carpeta en tu Drive
              </p>
              <div className="flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-surface-subtle px-3 py-2">
                <FolderOpen className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
                <span className="min-w-0 truncate text-sm font-medium text-foreground">
                  {conn.drive_folder_name ?? 'SellUp'}
                </span>
              </div>
            </div>
          )}

          {/* Fechas */}
          <div className="grid gap-4 border-t border-border/50 pt-4 sm:grid-cols-2">
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Última conexión
              </p>
              <p className="text-sm tabular-nums text-foreground">{formatDate(conn?.connected_at)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Última prueba
              </p>
              <p className="text-sm tabular-nums text-foreground">{formatDate(conn?.last_tested_at)}</p>
            </div>
          </div>

          {/* Error message if any */}
          {conn?.last_connection_error && status === 'error' && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2">
              <p className="text-xs text-muted-foreground">Último error:</p>
              <p className="break-words text-sm text-destructive">{conn.last_connection_error}</p>
            </div>
          )}

          {/* Acciones */}
          <div className="border-t border-border/50 pt-4">
            <DriveActionsPanel
              connectionStatus={status}
              folderId={conn?.drive_folder_id ?? null}
            />
          </div>
        </div>
      </SurfaceCard>

      {/* Info de alcance */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Qué puede hacer SellUp con tu Drive"
          description="Solo archivos creados por SellUp."
        />
        <ul className="space-y-2">
          {[
            'Crear una carpeta «SellUp» en tu Drive.',
            'Guardar ahí lo que genere: propuestas, casos de negocio e informes.',
            'Actualizar los archivos que él mismo creó.',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <span className="min-w-0">{item}</span>
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border/50 pt-4">
          <p className="text-xs leading-relaxed text-muted-foreground">
            SellUp solo puede ver y cambiar los archivos que él mismo crea. No puede leer, modificar ni
            borrar nada más de tu Drive.
          </p>
        </div>
      </SurfaceCard>
    </div>
  );
}
