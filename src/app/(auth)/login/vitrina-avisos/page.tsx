'use client';
// VITRINA LOCAL TEMPORAL — no se sube. Datos ficticios, sin servidor.
import { SettingsPage } from '@/components/settings/settings-page';
import { NotificationsSettingsClient } from '@/app/(sellup)/settings/notifications/notifications-settings-client';
import { buildBulletinModel, bulletinPeriod, type PersonActivity } from '@/modules/bulletin/bulletin-model';
import { NOTIFICATION_CATALOG, ROLE_KEYS, type BulletinFrequency } from '@/modules/notifications/notification-catalog';
import { ROLE_LABELS } from '@/modules/access/role-labels';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const USERS = [
  { id: id(1), name: 'Martín Salas', email: 'martin@x.co', roleKey: 'commercial_manager' },
  { id: id(2), name: 'Andrea López', email: 'andrea@x.co', roleKey: 'commercial_lead' },
  { id: id(3), name: 'Mateo Díaz', email: 'mateo@x.co', roleKey: 'commercial_lead' },
  { id: id(4), name: 'Sofía Vargas', email: 'sofia@x.co', roleKey: 'seller_bd' },
  { id: id(5), name: 'Daniel Ortiz', email: 'daniel@x.co', roleKey: 'seller_bd' },
  { id: id(6), name: 'Valentina Ruiz', email: 'valentina@x.co', roleKey: 'seller_bd' },
  { id: id(7), name: 'Camilo Pérez', email: 'camilo@x.co', roleKey: 'growth' },
].map((u) => ({ ...u, roleLabel: ROLE_LABELS[u.roleKey] ?? u.roleKey }));

function p(pid: string, name: string, o: Partial<PersonActivity>): PersonActivity {
  return { id: pid, name, searches: 0, found: 0, approved: 0, discarded: 0, contactsApproved: 0, firstContacts: 0, firstContactsUsed: 0, usageUsd: 0, usageCredits: 0, pending: 0, oldestPendingDays: null, ...o };
}

function model(frequency: BulletinFrequency) {
  return buildBulletinModel({
    period: bulletinPeriod(frequency, new Date('2026-11-16T13:15:00Z')),
    recipientName: 'Martín',
    scopeLabel: 'Tu equipo y sus equipos (en cascada)',
    moneyVisible: true,
    current: [
      p('c', 'Andrea López', { searches: 3, found: 42, approved: 12, discarded: 6, contactsApproved: 9, firstContacts: 5, firstContactsUsed: 3, usageUsd: 6.4, usageCredits: 31, pending: 4, oldestPendingDays: 3 }),
      p('a', 'Sofía Vargas', { searches: 2, found: 25, approved: 7, discarded: 3, contactsApproved: 6, firstContacts: 4, firstContactsUsed: 2, usageUsd: 3.1, usageCredits: 14, pending: 2, oldestPendingDays: 1 }),
      p('l', 'Daniel Ortiz', { searches: 1, found: 12, approved: 2, discarded: 1, pending: 11, oldestPendingDays: 13, usageUsd: 1.2, usageCredits: 5 }),
      p('pe', 'Mateo Díaz', { searches: 2, found: 30, approved: 9, discarded: 5, contactsApproved: 7, firstContacts: 3, firstContactsUsed: 2, usageUsd: 4.0, usageCredits: 18, pending: 3, oldestPendingDays: 2 }),
      p('e', 'Valentina Ruiz', {}),
    ],
    previous: [
      p('c', 'Andrea López', { approved: 10, discarded: 4, usageUsd: 5 }), p('a', 'Sofía Vargas', { approved: 9, discarded: 2, usageUsd: 3.5 }),
      p('l', 'Daniel Ortiz', { approved: 4, usageUsd: 1 }), p('pe', 'Mateo Díaz', { approved: 6, discarded: 3, usageUsd: 3 }), p('e', 'Valentina Ruiz', { approved: 2 }),
    ],
    teams: [
      { name: 'Andrea López', memberIds: ['c', 'a', 'l'] },
      { name: 'Mateo Díaz', memberIds: ['pe', 'e'] },
    ],
  });
}

const HISTORY = [
  { id: id(101), recipientId: id(1), recipientName: 'Martín Salas', frequency: 'weekly' as const, periodStart: '2026-11-09', periodEnd: '2026-11-15', status: 'sent', manual: false, createdAt: '2026-11-16T13:16:00Z' },
  { id: id(102), recipientId: id(2), recipientName: 'Andrea López', frequency: 'weekly' as const, periodStart: '2026-11-09', periodEnd: '2026-11-15', status: 'sent', manual: false, createdAt: '2026-11-16T13:16:05Z' },
  { id: id(103), recipientId: id(3), recipientName: 'Mateo Díaz', frequency: 'weekly' as const, periodStart: '2026-11-09', periodEnd: '2026-11-15', status: 'not_in_slack', manual: false, createdAt: '2026-11-16T13:16:09Z' },
  { id: id(104), recipientId: id(8), recipientName: 'Laura Gil', frequency: 'monthly' as const, periodStart: '2026-10-01', periodEnd: '2026-10-31', status: 'sent', manual: true, createdAt: '2026-11-11T20:02:00Z' },
];

const wait = () => new Promise((r) => setTimeout(r, 400));

export default function VitrinaAvisos() {
  return (
    <div className="min-h-screen bg-background p-6">
      <SettingsPage title="Avisos de Slack" description="Qué avisos manda el bot de SellUp por Slack, a qué rol o persona, y el boletín de cada equipo.">
        <NotificationsSettingsClient
          data={{
            catalog: [...NOTIFICATION_CATALOG],
            roles: ROLE_KEYS.map((key) => ({ key, label: ROLE_LABELS[key] ?? key })),
            rows: [
              { scope_type: 'role', scope_id: 'seller_bd', notification_key: 'daily_reminder', enabled: true },
              { scope_type: 'user', scope_id: id(5), notification_key: 'bulletin_daily', enabled: true },
            ],
            users: USERS,
            ready: true,
          }}
          history={HISTORY}
          actions={{
            setNotificationSetting: async () => { await wait(); return { success: true, data: undefined }; },
            previewBulletin: async ({ frequency }) => { await wait(); return { success: true, data: model(frequency) }; },
            sendBulletinPreviewToMe: async () => { await wait(); return { success: true, data: undefined }; },
            getBulletinHistory: async (userId) => { await wait(); return { success: true, data: HISTORY.filter((h) => !userId || h.recipientId === userId) }; },
            getBulletinDelivery: async () => { await wait(); return { success: true, data: model('weekly') }; },
          }}
        />
      </SettingsPage>
    </div>
  );
}
