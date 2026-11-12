'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import type { NotificationSettingRow } from '@/modules/notifications/notification-catalog';
import { findRule, withRule, type NotificationSettingsActions, type RuleInput } from './notification-settings-types';

// ============================================================
// Guardar una regla (rol o persona): se ve al instante y se deshace si el
// servidor no la guarda. La comparten «Avisos» y «Boletín».
// ============================================================

/** Identidad de una celda (rol × aviso o persona × aviso) para saber cuál se está guardando. */
export function ruleKey(input: Pick<RuleInput, 'scopeType' | 'scopeId' | 'notificationKey'>): string {
  return input.scopeType === 'role'
    ? `role:${input.scopeId}:${input.notificationKey}`
    : `user:${input.scopeId}:${input.notificationKey}`;
}

function successMessage(input: RuleInput): string {
  if (input.enabled === null) return 'Listo: vuelve a su valor heredado.';
  return input.enabled ? 'Aviso encendido.' : 'Aviso apagado.';
}

export interface RuleSaver {
  rows: NotificationSettingRow[];
  pendingKey: string | null;
  saveRule: (input: RuleInput) => Promise<void>;
}

export function useRuleSaver(
  initialRows: readonly NotificationSettingRow[],
  setNotificationSetting: NotificationSettingsActions['setNotificationSetting'],
): RuleSaver {
  const [rows, setRows] = useState<NotificationSettingRow[]>([...initialRows]);
  const [pendingKey, setPendingKey] = useState<string | null>(null);

  const saveRule = async (input: RuleInput) => {
    const previous = findRule(rows, input.scopeType, input.scopeId, input.notificationKey);
    const restore: RuleInput = { ...input, enabled: previous ? previous.enabled : null };
    setRows((current) => withRule(current, input));
    setPendingKey(ruleKey(input));
    try {
      const result = await setNotificationSetting(input);
      if (!result.success) {
        setRows((current) => withRule(current, restore));
        toast.error(result.error);
        return;
      }
      toast.success(successMessage(input));
    } catch {
      setRows((current) => withRule(current, restore));
      toast.error('No se pudo guardar. Intenta de nuevo.');
    } finally {
      setPendingKey(null);
    }
  };

  return { rows, pendingKey, saveRule };
}
