'use client';

import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  appliesToRole,
  isNotificationEnabled,
  notificationSource,
  type NotificationDefinition,
  type NotificationSettingRow,
} from '@/modules/notifications/notification-catalog';
import { findRule, type NotificationSettingsData, type RuleInput } from './notification-settings-types';

// ============================================================
// «Por persona»: la regla de la persona gana sobre la de su rol.
// Tres estados: «Según su rol» (sin regla), Encendido, Apagado.
// ============================================================

type Choice = 'inherit' | 'on' | 'off';

const CHOICES: ReadonlyArray<{ value: Choice; label: string }> = [
  { value: 'inherit', label: 'Según su rol' },
  { value: 'on', label: 'Encendido' },
  { value: 'off', label: 'Apagado' },
];

const SOURCE_BADGE = {
  personal: { label: 'Personal', variant: 'brand' },
  rol: { label: 'Según su rol', variant: 'neutral' },
  por_defecto: { label: 'Por defecto', variant: 'outline' },
} as const;

interface PersonOverridesProps {
  catalog: readonly NotificationDefinition[];
  users: NotificationSettingsData['users'];
  rows: readonly NotificationSettingRow[];
  pendingKey: string | null;
  onChange: (input: RuleInput) => void;
}

export function personCellKey(userId: string, notificationKey: string): string {
  return `user:${userId}:${notificationKey}`;
}

export function PersonOverrides({ catalog, users, rows, pendingKey, onChange }: PersonOverridesProps) {
  const [userId, setUserId] = useState<string>('');
  const person = users.find((u) => u.id === userId) ?? null;
  const applicable = person ? catalog.filter((d) => appliesToRole(d.key, person.roleKey)) : [];

  return (
    <SurfaceCard>
      <SurfaceCardHeader
        title="Por persona"
        description="Una excepción para alguien en particular. Lo que elijas aquí gana sobre lo de su rol."
      />
      <div className="max-w-sm">
        <SearchableSelect
          options={users.map((u) => ({ value: u.id, label: u.name, description: u.roleLabel }))}
          value={userId}
          onValueChange={setUserId}
          placeholder="Elige una persona"
          searchPlaceholder="Buscar por nombre…"
          emptyMessage="Nadie con ese nombre."
        />
      </div>

      {person && applicable.length === 0 && (
        <p className="mt-4 text-sm text-muted-foreground">Su rol ({person.roleLabel}) no recibe avisos por Slack.</p>
      )}

      {person && applicable.length > 0 && (
        <ul className="mt-4 divide-y divide-border/60 rounded-xl border border-border/60" aria-label={`Avisos de ${person.name}`}>
          {applicable.map((def) => {
            const who = { userId: person.id, roleKey: person.roleKey };
            const enabled = isNotificationEnabled(def.key, who, rows);
            const source = notificationSource(def.key, who, rows);
            const rule = findRule(rows, 'user', person.id, def.key);
            const choice: Choice = rule ? (rule.enabled ? 'on' : 'off') : 'inherit';
            const badge = source === 'no_aplica' ? null : SOURCE_BADGE[source];
            return (
              <li key={def.key} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{def.label}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className={enabled ? 'text-success' : 'text-muted-foreground'}>{enabled ? 'Le llega' : 'No le llega'}</span>
                    {badge && <Badge variant={badge.variant}>{badge.label}</Badge>}
                  </p>
                </div>
                <Select
                  value={choice}
                  disabled={pendingKey === personCellKey(person.id, def.key)}
                  onValueChange={(value) => {
                    const next = value as Choice;
                    if (next === choice) return;
                    onChange({
                      scopeType: 'user',
                      scopeId: person.id,
                      notificationKey: def.key,
                      enabled: next === 'inherit' ? null : next === 'on',
                    });
                  }}
                >
                  <SelectTrigger size="sm" className="w-40" aria-label={`${def.label} para ${person.name}`}>
                    <SelectValue>{CHOICES.find((c) => c.value === choice)?.label}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {CHOICES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </li>
            );
          })}
        </ul>
      )}
    </SurfaceCard>
  );
}
