'use client';

import { useCallback, useTransition } from 'react';
import { toast } from 'sonner';
import { SendHorizonal } from '@/icons';
import { Button } from '@/components/ui/button';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import {
  BULLETIN_KEY_BY_FREQUENCY,
  appliesToRole,
  isNotificationEnabled,
  notificationSource,
  type BulletinFrequency,
  type NotificationSettingRow,
} from '@/modules/notifications/notification-catalog';
import { BulletinViewer } from './bulletin-viewer';
import { NotificationSwitchRow } from './notification-switch-row';
import { ruleKey } from './use-rule-saver';
import {
  FREQUENCY_OPTIONS,
  activeFrequencies,
  type NotificationSettingsActions,
  type NotificationSettingsData,
  type RuleInput,
} from './notification-settings-types';

// ============================================================
// Panel derecho del «Boletín»: los boletines de UNA persona (se envían solos
// al encenderlos) y el visor con lo que recibe y lo que ya le llegó.
// ============================================================

type Person = NotificationSettingsData['users'][number];

interface BulletinPersonPanelProps {
  person: Person;
  rows: readonly NotificationSettingRow[];
  pendingKey: string | null;
  onChange: (input: RuleInput) => void;
  actions: Pick<NotificationSettingsActions, 'previewBulletin' | 'sendBulletinPreviewToMe' | 'getBulletinHistory' | 'getBulletinDelivery'>;
}

export function BulletinPersonPanel({ person, rows, pendingKey, onChange, actions }: BulletinPersonPanelProps) {
  const [isSending, startSending] = useTransition();
  const who = { userId: person.id, roleKey: person.roleKey };
  const applicable = FREQUENCY_OPTIONS.filter((o) => appliesToRole(BULLETIN_KEY_BY_FREQUENCY[o.value], person.roleKey));
  const defaultFrequency = activeFrequencies(person, rows)[0] ?? 'weekly';

  const { getBulletinHistory, previewBulletin, getBulletinDelivery, sendBulletinPreviewToMe } = actions;
  const loadHistory = useCallback(() => getBulletinHistory(person.id), [getBulletinHistory, person.id]);
  const loadPreview = useCallback(
    (frequency: BulletinFrequency, day: string | null) => previewBulletin({ userId: person.id, frequency, day }),
    [previewBulletin, person.id],
  );

  const sendToMe = (frequency: BulletinFrequency) =>
    startSending(async () => {
      const result = await sendBulletinPreviewToMe({ userId: person.id, frequency });
      if (result.success) toast.success('Listo: te llegó por Slack el boletín de prueba.');
      else toast.error(result.error);
    });

  return (
    <div className="min-w-0 space-y-4">
      <SurfaceCard>
        <SurfaceCardHeader title={`Sus boletines · ${person.name}`} description="Se envían solos; no hay que hacer nada más." />
        {applicable.length === 0 ? (
          <p className="text-sm text-muted-foreground">Su rol ({person.roleLabel}) no recibe boletines.</p>
        ) : (
          <ul className="divide-y divide-border/60 rounded-xl border border-border/60" aria-label={`Boletines de ${person.name}`}>
            {applicable.map((option) => {
              const key = BULLETIN_KEY_BY_FREQUENCY[option.value];
              const base = { scopeType: 'user' as const, scopeId: person.id, notificationKey: key };
              const isPersonal = notificationSource(key, who, rows) === 'personal';
              return (
                <NotificationSwitchRow
                  key={option.value}
                  label={option.label}
                  description={option.when}
                  checked={isNotificationEnabled(key, who, rows)}
                  sourceLabel={isPersonal ? 'Personal' : 'Por su rol'}
                  isPersonal={isPersonal}
                  resetLabel="Volver a lo de su rol"
                  busy={pendingKey === ruleKey(base)}
                  ariaLabel={`Boletín ${option.label.toLowerCase()} de ${person.name}`}
                  onToggle={(next) => onChange({ ...base, enabled: next })}
                  onReset={() => onChange({ ...base, enabled: null })}
                />
              );
            })}
          </ul>
        )}
      </SurfaceCard>

      <BulletinViewer
        defaultFrequency={defaultFrequency}
        loadPreview={loadPreview}
        loadHistory={loadHistory}
        loadDelivery={getBulletinDelivery}
        viewerDescription="Lo que recibe esta persona. Sin fecha, el que le llegaría hoy; con fecha, el del período que la contiene."
        historyTitle="Enviados a esta persona"
        historyEmpty="Todavía no le ha llegado ningún boletín."
        secondaryAction={(frequency) => (
          <Button variant="ghost" size="sm" onClick={() => sendToMe(frequency)} disabled={isSending}>
            <SendHorizonal aria-hidden="true" />
            {isSending ? 'Enviando…' : 'Enviarme una prueba por Slack'}
          </Button>
        )}
      />
    </div>
  );
}
