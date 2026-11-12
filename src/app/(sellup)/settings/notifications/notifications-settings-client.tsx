'use client';

import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsBadge, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BulletinHistory } from './bulletin-history';
import { BulletinTab } from './bulletin-tab';
import { PersonOverrides } from './person-overrides';
import { RoleMatrix } from './role-matrix';
import { useRuleSaver } from './use-rule-saver';
import type { BulletinDeliveryRow, NotificationSettingsActions, NotificationSettingsData } from './notification-settings-types';

// ============================================================
// Configuración › Avisos de Slack — pestañas Avisos, Boletín e Historial.
// Los cambios se ven al instante y se deshacen si el servidor no los guarda.
// ============================================================

export interface NotificationsSettingsClientProps {
  data: NotificationSettingsData;
  history: BulletinDeliveryRow[];
  actions: NotificationSettingsActions;
}

export function NotificationsSettingsClient({ data, history, actions }: NotificationsSettingsClientProps) {
  const { rows, pendingKey, saveRule } = useRuleSaver(data.rows, actions.setNotificationSetting);

  return (
    <div className="space-y-4">
      {!data.ready && (
        <Alert variant="warning">
          <AlertTitle>Falta aplicar la migración 165</AlertTitle>
          <AlertDescription>
            Mientras tanto se muestran los valores por defecto y los cambios no se pueden guardar.
          </AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="avisos">
        <TabsList>
          <TabsTrigger value="avisos">Avisos</TabsTrigger>
          <TabsTrigger value="boletin">Boletín</TabsTrigger>
          <TabsTrigger value="historial">
            Historial
            <TabsBadge count={history.length} tone="neutral" />
          </TabsTrigger>
        </TabsList>

        <TabsContent value="avisos" className="space-y-4 pt-2">
          <RoleMatrix catalog={data.catalog} roles={data.roles} rows={rows} pendingKey={pendingKey} onChange={(i) => void saveRule(i)} />
          <PersonOverrides catalog={data.catalog} users={data.users} rows={rows} pendingKey={pendingKey} onChange={(i) => void saveRule(i)} />
        </TabsContent>

        <TabsContent value="boletin" className="pt-2">
          <BulletinTab
            users={data.users}
            roles={data.roles}
            rows={rows}
            pendingKey={pendingKey}
            onChange={(i) => void saveRule(i)}
            actions={actions}
          />
        </TabsContent>

        <TabsContent value="historial" className="pt-2">
          <BulletinHistory history={history} getBulletinDelivery={actions.getBulletinDelivery} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
