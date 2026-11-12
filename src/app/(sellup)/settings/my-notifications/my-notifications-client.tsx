'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import type { BulletinModel } from '@/modules/bulletin/bulletin-model';
import type { MyNotificationItem, MyNotificationSettings } from '@/modules/notifications/my-notification-actions';
import { BULLETIN_KEY_BY_FREQUENCY, type BulletinFrequency } from '@/modules/notifications/notification-catalog';
import { BulletinViewer } from '../notifications/bulletin-viewer';
import { NotificationSwitchRow } from '../notifications/notification-switch-row';
import { FREQUENCY_OPTIONS, type ActionResult, type BulletinDeliveryRow } from '../notifications/notification-settings-types';

// ============================================================
// Configuración › Mis avisos de Slack: cada persona elige sus avisos y sus
// boletines (sólo los que aplican a su rol; la lista llega ya filtrada del
// servidor). Lo que elige gana sobre lo de su rol.
// ============================================================

export interface MyNotificationsActions {
  getMyNotificationSettings: () => Promise<ActionResult<MyNotificationSettings>>;
  setMyNotificationSetting: (input: { notificationKey: string; enabled: boolean | null }) => Promise<ActionResult>;
  previewMyBulletin: (input: { frequency: BulletinFrequency; day?: string | null }) => Promise<ActionResult<BulletinModel>>;
  getMyBulletinHistory: () => Promise<ActionResult<BulletinDeliveryRow[]>>;
  getMyBulletinDelivery: (id: string) => Promise<ActionResult<BulletinModel>>;
}

interface MyNotificationsClientProps {
  data: MyNotificationSettings;
  actions: MyNotificationsActions;
}

/** Los boletines van primero y en el orden de las frecuencias. */
function bulletinOrder(item: MyNotificationItem): number {
  return FREQUENCY_OPTIONS.findIndex((o) => BULLETIN_KEY_BY_FREQUENCY[o.value] === item.definition.key);
}

function frequencyOf(item: MyNotificationItem): BulletinFrequency | null {
  return FREQUENCY_OPTIONS.find((o) => BULLETIN_KEY_BY_FREQUENCY[o.value] === item.definition.key)?.value ?? null;
}

export function MyNotificationsClient({ data, actions }: MyNotificationsClientProps) {
  const [items, setItems] = useState<MyNotificationItem[]>(data.items);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const bulletins = items.filter((i) => i.definition.group === 'boletin').sort((a, b) => bulletinOrder(a) - bulletinOrder(b));
  const notices = items.filter((i) => i.definition.group !== 'boletin');
  const firstOn = bulletins.find((i) => i.enabled);
  const defaultFrequency = (firstOn && frequencyOf(firstOn)) ?? 'weekly';

  const save = async (key: string, enabled: boolean | null) => {
    const before = items;
    setItems((current) =>
      current.map((i) =>
        i.definition.key !== key ? i : { ...i, enabled: enabled ?? i.enabled, source: enabled === null ? 'rol' : 'personal' },
      ),
    );
    setPendingKey(key);
    try {
      const result = await actions.setMyNotificationSetting({ notificationKey: key, enabled });
      if (!result.success) {
        setItems(before);
        toast.error(result.error);
        return;
      }
      toast.success(enabled === null ? 'Listo: vuelve a lo de tu rol.' : enabled ? 'Aviso encendido.' : 'Aviso apagado.');
      // Al volver a lo del rol, el valor real lo sabe el servidor.
      const fresh = await actions.getMyNotificationSettings().catch(() => null);
      if (fresh?.success) setItems(fresh.data.items);
    } catch {
      setItems(before);
      toast.error('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setPendingKey(null);
    }
  };

  const renderItem = (item: MyNotificationItem) => {
    const isPersonal = item.source === 'personal';
    return (
      <NotificationSwitchRow
        key={item.definition.key}
        label={item.definition.label}
        description={item.definition.description}
        checked={item.enabled}
        sourceLabel={isPersonal ? 'Lo elegiste tú' : 'Por tu rol'}
        isPersonal={isPersonal}
        resetLabel="Volver a lo de mi rol"
        busy={pendingKey === item.definition.key}
        disabled={!data.ready}
        ariaLabel={item.definition.label}
        onToggle={(next) => void save(item.definition.key, next)}
        onReset={() => void save(item.definition.key, null)}
      />
    );
  };

  return (
    <div className="space-y-4">
      {!data.ready && (
        <Alert variant="info">
          <AlertTitle>Todavía no se pueden guardar cambios</AlertTitle>
          <AlertDescription>Ves lo que te llega hoy según tu rol. Muy pronto podrás cambiarlo desde aquí.</AlertDescription>
        </Alert>
      )}

      {bulletins.length > 0 && (
        <SurfaceCard>
          <SurfaceCardHeader
            title="Boletín"
            description="El resumen de tu equipo por Slack a las 8:15 a. m. Se envía solo; puedes tener varias frecuencias."
          />
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60" aria-label="Mis boletines">
            {bulletins.map(renderItem)}
          </ul>
        </SurfaceCard>
      )}

      {notices.length > 0 && (
        <SurfaceCard>
          <SurfaceCardHeader title="Avisos" description="Lo que te pasa en tu trabajo diario. La campanita de SellUp no cambia." />
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60" aria-label="Mis avisos">
            {notices.map(renderItem)}
          </ul>
        </SurfaceCard>
      )}

      {bulletins.length > 0 && (
        <BulletinViewer
          defaultFrequency={defaultFrequency}
          loadPreview={(frequency, day) => actions.previewMyBulletin({ frequency, day })}
          loadHistory={actions.getMyBulletinHistory}
          loadDelivery={actions.getMyBulletinDelivery}
          viewerDescription="Tu boletín sin enviarlo. Sin fecha, el que te llegaría hoy; con fecha, el del período que la contiene."
          historyTitle="Mis boletines enviados"
          historyEmpty="Todavía no te ha llegado ningún boletín."
        />
      )}
    </div>
  );
}
