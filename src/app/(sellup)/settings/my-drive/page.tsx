import { redirect } from 'next/navigation';
import { CheckCircle2, XCircle, WifiOff, Clock, FolderOpen, AlertTriangle } from 'lucide-react';
import { PageHeader } from '@/components/shared/page-header';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { hasActiveAccess } from '@/modules/access/actions';
import { getUserDriveConnection } from '@/modules/drive/actions';
import { DriveActionsPanel } from './drive-actions-client';

function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('es-CO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
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
      color: 'text-emerald-500',
      bg: 'bg-emerald-500/10',
      border: 'border-emerald-500/20',
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
      bg: 'bg-muted/40',
      border: 'border-border/40',
    },
    not_connected: {
      label: 'No conectado',
      icon: Clock,
      color: 'text-muted-foreground',
      bg: 'bg-muted/40',
      border: 'border-border/40',
    },
  };

  const cfg = map[status] ?? map['not_connected'];
  const Icon = cfg.icon;

  return (
    <div className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${cfg.bg} ${cfg.border}`}>
      <Icon className={`h-4 w-4 flex-shrink-0 ${cfg.color}`} />
      <span className={`text-sm font-medium ${cfg.color}`}>{cfg.label}</span>
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
  const credStatus = conn?.credentials_status ?? 'missing';

  return (
    <div className="space-y-8">
      <PageHeader
        title="Mi Google Drive"
        description="Conecta tu Drive para guardar y organizar los archivos que SellUp genere en tu espacio de trabajo."
        backHref="/settings"
      />

      {/* Banner de éxito */}
      {justConnected && (
        <div className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4 w-4 flex-shrink-0" />
          Google Drive conectado correctamente. La carpeta SellUp está lista en tu Drive.
        </div>
      )}

      {/* Banner de error */}
      {errorParam && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 flex-shrink-0" />
          {errorParam}
        </div>
      )}

      {/* Estado de conexión */}
      <SurfaceCard>
        <SurfaceCardHeader
          title="Estado de la conexión"
          description="Estado actual de tu Google Drive personal en SellUp."
        />

        <div className="space-y-4">
          {/* Status block */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Estado
              </p>
              <ConnectionStatusBlock status={status} />
            </div>

            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Credenciales
              </p>
              <div
                className={`flex items-center gap-2 rounded-lg border px-3 py-2 ${
                  credStatus === 'stored'
                    ? 'border-emerald-500/20 bg-emerald-500/10'
                    : 'border-border/40 bg-muted/40'
                }`}
              >
                <span
                  className={`h-2 w-2 rounded-full ${
                    credStatus === 'stored' ? 'bg-emerald-500' : 'bg-muted-foreground/40'
                  }`}
                />
                <span className="text-sm font-medium text-foreground">
                  {credStatus === 'stored' ? 'Almacenadas' : 'Sin configurar'}
                </span>
              </div>
            </div>
          </div>

          {/* Carpeta raíz */}
          {conn?.drive_folder_id && (
            <div className="space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Carpeta raíz en Drive
              </p>
              <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-3 py-2">
                <FolderOpen className="h-4 w-4 text-su-brand flex-shrink-0" />
                <span className="text-sm font-medium text-foreground">
                  {conn.drive_folder_name ?? 'SellUp'}
                </span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground/60 hidden sm:block">
                  {conn.drive_folder_id.slice(0, 12)}…
                </span>
              </div>
            </div>
          )}

          {/* Fechas */}
          <div className="grid gap-3 sm:grid-cols-2 border-t border-border/40 pt-4">
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Última conexión
              </p>
              <p className="text-sm text-foreground">{formatDate(conn?.connected_at)}</p>
            </div>
            <div className="space-y-0.5">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                Última prueba
              </p>
              <p className="text-sm text-foreground">{formatDate(conn?.last_tested_at)}</p>
            </div>
          </div>

          {/* Error message if any */}
          {conn?.last_connection_error && status === 'error' && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2">
              <p className="text-xs text-muted-foreground">Último error:</p>
              <p className="text-sm text-destructive">{conn.last_connection_error}</p>
            </div>
          )}

          {/* Acciones */}
          <div className="border-t border-border/40 pt-4">
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
            'Crear una carpeta raíz "SellUp" en tu Drive.',
            'Crear archivos dentro de esa carpeta (propuestas, business cases, reportes).',
            'Modificar archivos que SellUp haya creado previamente.',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-emerald-500" />
              {item}
            </li>
          ))}
        </ul>
        <div className="mt-4 border-t border-border/40 pt-4">
          <p className="text-xs text-muted-foreground">
            SellUp usa el scope <code className="text-[11px] bg-muted px-1 rounded">drive.file</code>,
            que solo permite acceder a archivos creados por esta aplicación.
            SellUp no puede leer, modificar ni eliminar otros archivos de tu Drive.
          </p>
        </div>
      </SurfaceCard>
    </div>
  );
}
