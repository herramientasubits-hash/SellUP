'use client';
// VITRINA LOCAL TEMPORAL — no se sube. «Mis avisos de Slack» de una líder, con datos ficticios.
import { SettingsPage } from '@/components/settings/settings-page';
import { MyNotificationsClient } from '@/app/(sellup)/settings/my-notifications/my-notifications-client';
import { buildBulletinModel, bulletinPeriod, type PersonActivity } from '@/modules/bulletin/bulletin-model';
import { NOTIFICATION_CATALOG, appliesToRole, type BulletinFrequency } from '@/modules/notifications/notification-catalog';

const p = (id: string, name: string, o: Partial<PersonActivity> = {}): PersonActivity => ({ id, name, searches: 0, found: 0, approved: 0, discarded: 0, contactsApproved: 0, firstContacts: 0, firstContactsUsed: 0, usageUsd: 0, usageCredits: 0, pending: 0, oldestPendingDays: null, ...o });
const model = (frequency: BulletinFrequency) =>
  buildBulletinModel({
    period: bulletinPeriod(frequency, new Date('2026-11-16T13:15:00Z')),
    recipientName: 'Andrea', recipientId: 'carla', scopeLabel: 'Tu equipo', moneyVisible: true,
    current: [
      p('carla', 'Andrea López', { searches: 1, found: 14, approved: 5, discarded: 2, contactsApproved: 4, firstContacts: 3, usageUsd: 2.1, pending: 1, oldestPendingDays: 1 }),
      p('ana', 'Sofía Vargas', { searches: 2, found: 25, approved: 7, discarded: 3, contactsApproved: 6, firstContacts: 4, usageUsd: 3.1, pending: 2, oldestPendingDays: 1 }),
      p('luis', 'Daniel Ortiz', { searches: 1, found: 12, approved: 2, discarded: 1, usageUsd: 1.2, pending: 11, oldestPendingDays: 13 }),
      p('sofia', 'Paula Ríos', { searches: 2, found: 18, approved: 6, discarded: 2, usageUsd: 2.4 }),
      p('diego', 'Diego Paz'),
    ],
    previous: [p('carla', 'Andrea López', { searches: 1, found: 11, approved: 4, discarded: 2, contactsApproved: 3, firstContacts: 2, firstContactsUsed: 1, usageUsd: 1.8 }), p('ana', 'Sofía Vargas', { searches: 2, found: 24, approved: 9, discarded: 2, contactsApproved: 7, firstContacts: 3, firstContactsUsed: 2, usageUsd: 3.4 }), p('luis', 'Daniel Ortiz', { searches: 1, found: 10, approved: 4, discarded: 1, contactsApproved: 2, usageUsd: 0.9 }), p('sofia', 'Paula Ríos', { searches: 1, found: 9, approved: 3, discarded: 1, usageUsd: 1.1 }), p('diego', 'Diego Paz', { searches: 1, found: 8, approved: 2, discarded: 1, contactsApproved: 1, usageUsd: 0.6 })],
    teams: [{ name: 'Tu equipo', memberIds: ['carla', 'ana', 'luis', 'sofia', 'diego'] }],
  });
const wait = () => new Promise((r) => setTimeout(r, 400));
const items = NOTIFICATION_CATALOG.filter((d) => appliesToRole(d.key, 'commercial_lead')).map((definition) => ({
  definition,
  enabled: definition.key === 'bulletin_weekly' || definition.key === 'bulletin_monthly' || definition.group !== 'boletin',
  source: (definition.key === 'bulletin_monthly' ? 'personal' : 'rol') as 'personal' | 'rol',
}));
const history = [['2026-11-09', '2026-11-15'], ['2026-11-02', '2026-11-08'], ['2026-10-26', '2026-11-01']].map(([start, end], i) => ({
  id: `00000000-0000-4000-8000-00000000020${i}`, recipientId: 'carla', recipientName: 'Andrea López', frequency: 'weekly' as const,
  periodStart: start, periodEnd: end, status: 'sent', manual: false, createdAt: `${start}T13:16:00Z`,
}));

export default function VitrinaMisAvisos() {
  return (
    <div className="min-h-screen bg-background p-6">
      <SettingsPage title="Mis avisos de Slack" description="Elige qué te manda el bot de SellUp por Slack y cada cuánto recibes el boletín de tu equipo.">
        <MyNotificationsClient
          data={{ userId: 'carla', name: 'Andrea López', roleKey: 'commercial_lead', items, ready: true }}
          actions={{
            getMyNotificationSettings: async () => { await wait(); return { success: true, data: { userId: 'carla', name: 'Andrea López', roleKey: 'commercial_lead', items, ready: true } }; },
            setMyNotificationSetting: async () => { await wait(); return { success: true, data: undefined }; },
            previewMyBulletin: async ({ frequency }) => { await wait(); return { success: true, data: model(frequency) }; },
            getMyBulletinHistory: async () => { await wait(); return { success: true, data: history }; },
            getMyBulletinDelivery: async () => { await wait(); return { success: true, data: model('weekly') }; },
          }}
        />
      </SettingsPage>
    </div>
  );
}
