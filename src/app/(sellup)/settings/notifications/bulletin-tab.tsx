'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { Eye, SendHorizonal } from '@/icons';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import type { BulletinModel } from '@/modules/bulletin/bulletin-model';
import type { BulletinFrequency } from '@/modules/notifications/notification-catalog';
import { BulletinPreview } from './bulletin-preview';
import {
  FREQUENCY_OPTIONS,
  type NotificationSettingsActions,
  type NotificationSettingsData,
} from './notification-settings-types';

// ============================================================
// «Boletín»: qué recibe cada quien, vista previa gráfica y envío de prueba.
// ============================================================

interface BulletinTabProps {
  users: NotificationSettingsData['users'];
  actions: Pick<NotificationSettingsActions, 'previewBulletin' | 'sendBulletinPreviewToMe'>;
}

export function BulletinTab({ users, actions }: BulletinTabProps) {
  const [userId, setUserId] = useState('');
  const [frequency, setFrequency] = useState<BulletinFrequency>('weekly');
  const [model, setModel] = useState<BulletinModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, startLoading] = useTransition();
  const [isSending, startSending] = useTransition();

  const request = { userId, frequency };

  const loadPreview = () =>
    startLoading(async () => {
      setError(null);
      const result = await actions.previewBulletin(request);
      if (result.success) {
        setModel(result.data);
      } else {
        setModel(null);
        setError(result.error);
      }
    });

  const sendToMe = () =>
    startSending(async () => {
      const result = await actions.sendBulletinPreviewToMe(request);
      if (result.success) toast.success('Listo: te llegó por Slack el boletín de prueba.');
      else toast.error(result.error);
    });

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <SurfaceCardHeader
          title="Cómo funciona el boletín"
          description="Cada persona recibe lo que pasó en su equipo y, en cascada según el organigrama, en los equipos de quienes le reportan. Compara con el período anterior."
        />
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {FREQUENCY_OPTIONS.map((option) => (
            <li key={option.value} className="rounded-xl border border-border/60 bg-surface-subtle p-3">
              <p className="text-sm font-medium text-foreground">{option.label}</p>
              <p className="text-xs text-muted-foreground">{option.when}</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted-foreground">
          Quién recibe cada frecuencia se elige en la pestaña «Avisos», por rol o por persona.
        </p>
      </SurfaceCard>

      <SurfaceCard>
        <SurfaceCardHeader title="Vista previa" description="Mira el boletín que recibiría una persona hoy. No se envía a nadie." />
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-full max-w-xs space-y-1">
            <span className="text-xs text-muted-foreground">Persona</span>
            <SearchableSelect
              options={users.map((u) => ({ value: u.id, label: u.name, description: u.roleLabel }))}
              value={userId}
              onValueChange={(value) => {
                setUserId(value);
                setModel(null);
              }}
              placeholder="Elige una persona"
              searchPlaceholder="Buscar por nombre…"
              emptyMessage="Nadie con ese nombre."
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs text-muted-foreground">Frecuencia</span>
            <Select
              value={frequency}
              onValueChange={(value) => {
                setFrequency(value as BulletinFrequency);
                setModel(null);
              }}
            >
              <SelectTrigger className="w-40" aria-label="Frecuencia">
                <SelectValue>{FREQUENCY_OPTIONS.find((o) => o.value === frequency)?.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FREQUENCY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={loadPreview} disabled={!userId || isLoading}>
            <Eye aria-hidden="true" />
            {isLoading ? 'Armando…' : 'Ver vista previa'}
          </Button>
          <Button variant="outline" onClick={sendToMe} disabled={!userId || isSending}>
            <SendHorizonal aria-hidden="true" />
            {isSending ? 'Enviando…' : 'Enviármelo por Slack'}
          </Button>
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </SurfaceCard>

      {model && <BulletinPreview model={model} />}
    </div>
  );
}
