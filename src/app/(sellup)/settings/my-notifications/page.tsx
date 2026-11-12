import { redirect } from 'next/navigation';
import { SettingsPage } from '@/components/settings/settings-page';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { hasActiveAccess } from '@/modules/access/actions';
import {
  getMyBulletinDelivery,
  getMyBulletinHistory,
  getMyNotificationSettings,
  previewMyBulletin,
  setMyNotificationSetting,
} from '@/modules/notifications/my-notification-actions';
import { MyNotificationsClient } from './my-notifications-client';

const TITLE = 'Mis avisos de Slack';
const DESCRIPTION = 'Elige qué avisos y qué boletines te manda el bot de SellUp por Slack.';

export default async function MyNotificationsPage() {
  if (!(await hasActiveAccess())) redirect('/settings');

  const settings = await getMyNotificationSettings();

  return (
    <SettingsPage title={TITLE} description={DESCRIPTION}>
      {settings.success ? (
        <MyNotificationsClient
          data={settings.data}
          actions={{
            getMyNotificationSettings,
            setMyNotificationSetting,
            previewMyBulletin,
            getMyBulletinHistory,
            getMyBulletinDelivery,
          }}
        />
      ) : (
        <Alert variant="destructive">
          <AlertTitle>No se pudieron cargar tus avisos</AlertTitle>
          <AlertDescription>{settings.error}</AlertDescription>
        </Alert>
      )}
    </SettingsPage>
  );
}
