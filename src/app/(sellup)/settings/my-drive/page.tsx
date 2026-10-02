import { withAppTimeZone } from '@/lib/format-date';
import { redirect } from 'next/navigation';
import { CheckCircle2, FolderOpen } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { StatusBadge, type StatusType } from '@/components/data-display';
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

const CONNECTION_STATUS: Record<string, { status: StatusType; label: string }> = {
  connected: { status: 'active', label: 'Conectado' },
  error: { status: 'error', label: 'Error de conexión' },
  disconnected: { status: 'neutral', label: 'Desconectado' },
  not_connected: { status: 'neutral', label: 'No conectado' },
};

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
  const connectionStatus = CONNECTION_STATUS[status] ?? CONNECTION_STATUS.not_connected;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Mi Google Drive"
        description="Conecta tu Drive para guardar y organizar los archivos que SellUp genere en tu espacio de trabajo."
      />

      {/* Banner de éxito */}
      {justConnected && (
        <Alert variant="success">
          <AlertTitle>Google Drive conectado</AlertTitle>
          <AlertDescription>La carpeta SellUp ya está lista en tu Drive.</AlertDescription>
        </Alert>
      )}

      {/* Banner de error */}
      {errorParam && (
        <Alert variant="destructive">
          <AlertTitle>No se pudo conectar Google Drive</AlertTitle>
          <AlertDescription className="break-words">{errorParam}</AlertDescription>
        </Alert>
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
            <StatusBadge status={connectionStatus.status} label={connectionStatus.label} />
          </div>

          {/* Carpeta raíz */}
          {conn?.drive_folder_id && (
            <div className="min-w-0 space-y-1.5">
              <p className="text-xs font-semibold text-muted-foreground">
                Carpeta en tu Drive
              </p>
              <div className="flex min-w-0 items-center gap-2 rounded-xl bg-surface-subtle px-3 py-2">
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
            <Alert variant="destructive">
              <AlertTitle>Último error</AlertTitle>
              <AlertDescription className="break-words">{conn.last_connection_error}</AlertDescription>
            </Alert>
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
