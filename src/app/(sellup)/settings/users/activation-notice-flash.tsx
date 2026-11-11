'use client';

// ============================================================
// Aviso tras activar accesos (dueña 11-11). La pantalla de Usuarios se recarga
// al confirmar; el resultado de los mensajes de Slack se guarda un momento en
// la pestaña y se muestra como toast cuando la página vuelve a cargar.
// ============================================================

import { useEffect } from 'react';
import { toast } from 'sonner';
import {
  summarizeActivationNotices,
  type SlackInviteOutcome,
} from '@/modules/access/slack-invitation-message';

const STORAGE_KEY = 'sellup:users:activation-notices';
const OUTCOMES: ReadonlySet<string> = new Set(['sent', 'not_in_slack', 'slack_not_connected', 'failed']);

/** Guarda lo que pasó con los avisos para mostrarlo después de recargar. */
export function rememberActivationNotices(outcomes: ReadonlyArray<SlackInviteOutcome> | undefined): void {
  if (!outcomes || outcomes.length === 0) return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(outcomes));
  } catch {
    // Sin almacenamiento (ventana privada): la activación ya quedó hecha.
  }
}

function takeActivationNotices(): SlackInviteOutcome[] {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((o): o is SlackInviteOutcome => typeof o === 'string' && OUTCOMES.has(o))
      : [];
  } catch {
    return [];
  }
}

/** Muestra el aviso guardado (una sola vez) al volver a cargar Usuarios. */
export function ActivationNoticeFlash() {
  useEffect(() => {
    const summary = summarizeActivationNotices(takeActivationNotices());
    if (!summary) return;
    const show = summary.tone === 'success' ? toast.success : toast.warning;
    show(summary.title, { description: summary.description });
  }, []);
  return null;
}
