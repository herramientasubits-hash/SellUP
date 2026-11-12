'use client';

import { RotateCcw } from '@/icons';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

// ============================================================
// Una fila «aviso + interruptor»: qué es, si llega, de dónde sale el valor y,
// si es una elección personal, cómo volver a lo del rol. La usan el boletín de
// una persona (admin) y «Mis avisos de Slack».
// ============================================================

export interface NotificationSwitchRowProps {
  label: string;
  description?: string;
  checked: boolean;
  /** «Por su rol», «Personal», «Lo elegiste tú»… */
  sourceLabel: string;
  /** La regla es de la persona: se muestra la acción para volver a lo del rol. */
  isPersonal: boolean;
  resetLabel: string;
  busy?: boolean;
  disabled?: boolean;
  /** Nombre accesible del interruptor (y del botón de volver). */
  ariaLabel: string;
  onToggle: (next: boolean) => void;
  onReset: () => void;
}

export function NotificationSwitchRow({
  label,
  description,
  checked,
  sourceLabel,
  isPersonal,
  resetLabel,
  busy = false,
  disabled = false,
  ariaLabel,
  onToggle,
  onReset,
}: NotificationSwitchRowProps) {
  return (
    <li className="flex items-start justify-between gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium text-foreground">{label}</p>
        {description && <p className="text-xs text-muted-foreground">{description}</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={isPersonal ? 'brand' : 'neutral'}>{sourceLabel}</Badge>
          {isPersonal && (
            <Button variant="ghost" size="xs" disabled={busy || disabled} aria-label={`${resetLabel}: ${ariaLabel}`} onClick={onReset}>
              <RotateCcw aria-hidden="true" />
              {resetLabel}
            </Button>
          )}
        </div>
      </div>
      <Switch checked={checked} disabled={busy || disabled} aria-label={ariaLabel} onCheckedChange={(next) => onToggle(next)} />
    </li>
  );
}
