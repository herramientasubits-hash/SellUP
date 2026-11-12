'use client';

import { useState } from 'react';
import { Users } from '@/icons';
import { EmptyState } from '@/components/ui/empty-state';
import type { NotificationSettingRow } from '@/modules/notifications/notification-catalog';
import { BulletinPeopleList } from './bulletin-people-list';
import { BulletinPersonPanel } from './bulletin-person-panel';
import {
  FREQUENCY_OPTIONS,
  type NotificationSettingsActions,
  type NotificationSettingsData,
  type RuleInput,
} from './notification-settings-types';

// ============================================================
// «Boletín» (dueña 11-11): a la izquierda las personas, a la derecha sus
// boletines y el visor. El envío es automático: encender = le llega solo.
// ============================================================

interface BulletinTabProps {
  users: NotificationSettingsData['users'];
  roles: NotificationSettingsData['roles'];
  rows: readonly NotificationSettingRow[];
  pendingKey: string | null;
  onChange: (input: RuleInput) => void;
  actions: Pick<NotificationSettingsActions, 'previewBulletin' | 'sendBulletinPreviewToMe' | 'getBulletinHistory' | 'getBulletinDelivery'>;
}

export function BulletinTab({ users, roles, rows, pendingKey, onChange, actions }: BulletinTabProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const person = users.find((u) => u.id === selectedId) ?? null;

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-muted-foreground">
          Los boletines se envían solos por Slack a las 8:15 a. m. a quien los tenga encendidos. Cada persona recibe lo de su
          equipo y, en cascada, lo de los equipos que le reportan, comparado con el período anterior.
        </p>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label="Cuándo llega cada boletín">
          {FREQUENCY_OPTIONS.map((o) => (
            <li key={o.value}>
              <span className="font-medium text-foreground">{o.label}:</span> {o.when.replace(' a las 8:15 a. m.', '').toLowerCase()}
            </li>
          ))}
        </ul>
      </div>

      <div className="grid gap-4 lg:grid-cols-[20rem_minmax(0,1fr)] lg:items-start">
        <BulletinPeopleList users={users} roles={roles} rows={rows} selectedId={selectedId} onSelect={setSelectedId} />
        {person ? (
          <BulletinPersonPanel key={person.id} person={person} rows={rows} pendingKey={pendingKey} onChange={onChange} actions={actions} />
        ) : (
          <EmptyState
            icon={Users}
            title="Elige una persona"
            description="Aquí verás sus boletines, podrás encenderlos o apagarlos y ver lo que recibe y lo que ya le llegó."
          />
        )}
      </div>
    </div>
  );
}
