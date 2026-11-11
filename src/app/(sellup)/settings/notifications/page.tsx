import { redirect } from 'next/navigation';
import { SettingsPage } from '@/components/settings/settings-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { isCurrentUserAdmin } from '@/modules/access/actions';
import {
  getBulletinDelivery,
  getBulletinHistory,
  getNotificationSettingsData,
  previewBulletin,
  sendBulletinPreviewToMe,
  setNotificationSetting,
} from '@/modules/notifications/notification-settings-actions';
import { NotificationsSettingsClient } from './notifications-settings-client';

const TITLE = 'Avisos de Slack';
const DESCRIPTION = 'Qué avisos manda el bot de SellUp por Slack, a qué rol o persona, y el boletín de cada equipo.';

export default async function NotificationSettingsPage() {
  if (!(await isCurrentUserAdmin())) redirect('/settings');

  const [settings, history] = await Promise.all([getNotificationSettingsData(), getBulletinHistory()]);

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      {settings.success ? (
        <NotificationsSettingsClient
          data={settings.data}
          history={history.success ? history.data : []}
          actions={{ setNotificationSetting, previewBulletin, sendBulletinPreviewToMe, getBulletinDelivery }}
        />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>No se pudo cargar la configuración</AlertTitle>
          <AlertDescription>{settings.error}</AlertDescription>
        </Alert>
      )}
    </SettingsPage>
  );
}
