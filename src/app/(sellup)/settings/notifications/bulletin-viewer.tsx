'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Eye } from '@/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SurfaceCard, SurfaceCardHeader } from '@/components/shared/surface-card';
import { formatAppDateTime } from '@/lib/format-date';
import type { BulletinModel } from '@/modules/bulletin/bulletin-model';
import type { BulletinFrequency } from '@/modules/notifications/notification-catalog';
import { BulletinPreview } from './bulletin-preview';
import { BulletinSentList } from './bulletin-sent-list';
import { FrequencySelect } from './frequency-select';
import { formatPeriod, frequencyLabel, type ActionResult, type BulletinDeliveryRow } from './notification-settings-types';

// ============================================================
// Visor del boletín de una persona: elige frecuencia y (opcional) una fecha y
// lo arma sin enviarlo; debajo, los que ya le llegaron (al pulsar uno se ve
// aquí mismo). Lo usan el admin (por persona) y «Mis avisos de Slack».
// ============================================================

type HistoryFilter = BulletinFrequency | 'all';

export interface BulletinViewerProps {
  defaultFrequency: BulletinFrequency;
  loadPreview: (frequency: BulletinFrequency, day: string | null) => Promise<ActionResult<BulletinModel>>;
  loadHistory: () => Promise<ActionResult<BulletinDeliveryRow[]>>;
  loadDelivery: (id: string) => Promise<ActionResult<BulletinModel>>;
  viewerDescription: string;
  historyTitle: string;
  historyEmpty: string;
  /** Acción secundaria junto a «Ver» (p. ej. enviarme una prueba). */
  secondaryAction?: (frequency: BulletinFrequency) => ReactNode;
}

interface Shown {
  model: BulletinModel;
  caption: string;
  deliveryId: string | null;
}

export function BulletinViewer({
  defaultFrequency,
  loadPreview,
  loadHistory,
  loadDelivery,
  viewerDescription,
  historyTitle,
  historyEmpty,
  secondaryAction,
}: BulletinViewerProps) {
  const [frequency, setFrequency] = useState<BulletinFrequency>(defaultFrequency);
  const [day, setDay] = useState('');
  const [shown, setShown] = useState<Shown | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [history, setHistory] = useState<BulletinDeliveryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<HistoryFilter>('all');

  useEffect(() => {
    let alive = true;
    loadHistory()
      .then((result) => {
        if (!alive) return;
        if (result.success) setHistory(result.data);
        else setHistoryError(result.error);
      })
      .catch(() => alive && setHistoryError('No se pudieron cargar los enviados.'))
      .finally(() => alive && setHistoryLoading(false));
    return () => {
      alive = false;
    };
  }, [loadHistory]);

  const run = async (load: () => Promise<ActionResult<BulletinModel>>, caption: string, deliveryId: string | null) => {
    setLoading(true);
    setError(null);
    try {
      const result = await load();
      if (result.success) setShown({ model: result.data, caption, deliveryId });
      else {
        setShown(null);
        setError(result.error);
      }
    } catch {
      setShown(null);
      setError('No se pudo armar el boletín. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  };

  const view = () =>
    void run(() => loadPreview(frequency, day || null), day ? 'Vista previa del período elegido · no se envía' : 'El que le llegaría hoy · no se envía', null);

  const openDelivery = (row: BulletinDeliveryRow) => {
    setFrequency(row.frequency);
    void run(() => loadDelivery(row.id), `Enviado el ${formatAppDateTime(row.createdAt)} · ${formatPeriod(row.periodStart, row.periodEnd)}`, row.id);
  };

  const visibleHistory = historyFilter === 'all' ? history : history.filter((r) => r.frequency === historyFilter);

  return (
    <div className="space-y-4">
      <SurfaceCard>
        <SurfaceCardHeader title="Ver el boletín" description={viewerDescription} />
        <div className="flex flex-wrap items-end gap-3">
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Frecuencia</span>
            <FrequencySelect value={frequency} onChange={setFrequency} ariaLabel="Frecuencia del boletín" />
          </label>
          <label className="space-y-1">
            <span className="block text-xs text-muted-foreground">Fecha (vacío = el de hoy)</span>
            <Input type="date" aria-label="Fecha del boletín" className="w-44" value={day} onChange={(e) => setDay(e.target.value)} />
          </label>
          <Button onClick={view} disabled={loading}>
            <Eye aria-hidden="true" />
            {loading ? 'Armando…' : 'Ver'}
          </Button>
          {secondaryAction?.(frequency)}
        </div>
        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </SurfaceCard>

      {shown && (
        <section aria-label="Boletín en pantalla" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {frequencyLabel(shown.model.frequency)} · {shown.caption}
          </p>
          <BulletinPreview model={shown.model} />
        </section>
      )}

      <SurfaceCard>
        <SurfaceCardHeader
          title={historyTitle}
          actions={
            <FrequencySelect
              value={historyFilter}
              onChange={setHistoryFilter}
              ariaLabel="Filtrar enviados por frecuencia"
              leading={[{ value: 'all', label: 'Todas' }]}
              size="sm"
              className="w-36"
            />
          }
        />
        <BulletinSentList
          rows={visibleHistory}
          selectedId={shown?.deliveryId ?? null}
          loading={historyLoading}
          error={historyError}
          emptyMessage={historyFilter === 'all' ? historyEmpty : `Ningún boletín ${frequencyLabel(historyFilter).toLowerCase()} enviado.`}
          onOpen={openDelivery}
        />
      </SurfaceCard>
    </div>
  );
}
