'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Tabs, TabsBadge, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { NotificationSettingRow } from '@/modules/notifications/notification-catalog';
import { BulletinHistory } from './bulletin-history';
import { BulletinTab } from './bulletin-tab';
import { PersonOverrides, personCellKey } from './person-overrides';
import { RoleMatrix, cellKey } from './role-matrix';
import {
  findRule,
  withRule,
  type BulletinDeliveryRow,
  type NotificationSettingsActions,
  type NotificationSettingsData,
  type RuleInput,
} from './notification-settings-types';

// ============================================================
// Configuración › Avisos de Slack — pestañas Avisos, Boletín e Historial.
// Los cambios se ven al instante y se deshacen si el servidor no los guarda.
// ============================================================

export interface NotificationsSettingsClientProps {
  data: NotificationSettingsData;
  history: BulletinDeliveryRow[];
  actions: NotificationSettingsActions;
}

function keyFor(input: RuleInput): string {
  return input.scopeType === 'role' ? cellKey(input.notificationKey, input.scopeId) : personCellKey(input.scopeId, input.notificationKey);
}

export function NotificationsSettingsClient({ data, history, actions }: NotificationsSettingsClientProps) {
  const [rows, setRows] = useState<NotificationSettingRow[]>(data.rows);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const saveRule = async (input: RuleInput) => {
    const previous = findRule(rows, input.scopeType, input.scopeId, input.notificationKey);
    const restore: RuleInput = { ...input, enabled: previous ? previous.enabled : null };
    setRows((current) => withRule(current, input));
    setPendingKey(keyFor(input));
    try {
      const result = await actions.setNotificationSetting(input);
      if (!result.success) {
        setRows((current) => withRule(current, restore));
        toast.error(result.error);
        return;
      }
      toast.success(input.enabled === null ? 'Listo: vuelve a su valor heredado.' : input.enabled ? 'Aviso encendido.' : 'Aviso apagado.');
    } catch {
      setRows((current) => withRule(current, restore));
      toast.error('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setPendingKey(null);
    }
  };

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
          <BulletinTab users={data.users} actions={actions} />
        </TabsContent>

        <TabsContent value="historial" className="pt-2">
          <BulletinHistory history={history} getBulletinDelivery={actions.getBulletinDelivery} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
