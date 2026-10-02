import type { ReactNode } from 'react';
import { isCurrentUserAdmin, getUsersSummary, hasActiveAccess } from '@/modules/access/actions';
import { getUserDriveConnection } from '@/modules/drive/actions';
import { SettingsNav } from '@/components/settings/settings-nav';
import type { SettingsSectionBadge } from '@/components/settings/settings-sections';

/**
 * Marco de Configuración: la navegación entre secciones siempre a la vista y,
 * al lado, la pantalla. Cada sección lleva su aviso de estado («5 pendientes»,
 * «Conectado») para que se vea qué pide atención sin entrar a cada una.
 *
 * La columna de contenido es su propia caja con scroll: la navegación se queda
 * quieta mientras se recorre una pantalla larga, y una pantalla con tabla
 * (`DataTablePage`) sigue llenando el alto. El margen negativo deja sitio a
 * sombras y anillos de foco, que una caja con scroll recortaría.
 */
export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const [isAdmin, isActive] = await Promise.all([isCurrentUserAdmin(), hasActiveAccess()]);

  const [summary, driveConnection] = await Promise.all([
    isAdmin ? getUsersSummary().catch(() => null) : null,
    isActive ? getUserDriveConnection().catch(() => null) : null,
  ]);

  const badges: Record<string, SettingsSectionBadge | undefined> = {};

  if (summary && summary.pending > 0) {
    badges.users = {
      label: `${summary.pending} pendiente${summary.pending === 1 ? '' : 's'}`,
      tone: 'warning',
    };
  }
  if (isActive) {
    const isDriveConnected = driveConnection?.connection_status === 'connected';
    badges['my-drive'] = isDriveConnected
      ? { label: 'Conectado', tone: 'positive' }
      : { label: 'Sin conectar', tone: 'neutral' };
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 lg:flex-row lg:gap-8">
      <SettingsNav isAdmin={isAdmin} isActive={isActive} badges={badges} />
      <div className="-mx-3 flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto px-3 pb-1">
        {children}
      </div>
    </div>
  );
}
