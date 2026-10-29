'use client';

// «Mapa de uso» — lo que acompaña al mapa de calor: las cifras de arriba, el
// «cuándo se usa» (día × hora, en la hora de Colombia) y la evolución diaria por
// agente. Mismo lenguaje visual que el mapa: tokens del sistema, sin colores sueltos.

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { EChart } from '@/components/charts/EChart';
import type { EChartsOption } from '@/components/charts/types';
import { Frame, FrameHeader, FramePanel } from '@/components/shared/frame';
import { MetricStrip, type MetricStripItem } from '@/components/shared/metric-strip';
import { formatInAppZone } from '@/lib/format-date';
import { OTHER_AGENT_KEY, type UsageMapData, type UsageMapMatrix } from '@/modules/ai-usage/usage-map';
import { agentLabel, formatCount, formatUsd } from './usage-labels';
import { WEEKDAY_LABELS, peakSlotLabel } from './usage-map-format';

function totalOf(matrix: UsageMapMatrix, key: string): number | null {
  return matrix.rows.find((r) => r.metric.key === key)?.total ?? null;
}

export function UsageMapMetrics({ data }: { data: UsageMapData }) {
  const m = data.matrices.rol;
  const people = totalOf(m, 'personas') ?? 0;
  const rate = totalOf(m, 'tasa');
  const cost = totalOf(m, 'costo');
  const perApproved = totalOf(m, 'costo_aprobada');
  const items: MetricStripItem[] = [
    {
      label: 'Personas activas',
      value: formatCount(people),
      description: `${data.matrices.lider.columns.length} ${data.matrices.lider.columns.length === 1 ? 'equipo' : 'equipos'} con uso`,
      hint: 'Personas que hicieron al menos una consulta o una búsqueda.',
    },
    {
      label: 'Búsquedas de empresas',
      value: formatCount(totalOf(m, 'busquedas') ?? 0),
      description: people > 0 ? `${((totalOf(m, 'busquedas') ?? 0) / people).toFixed(1).replace('.', ',')} por persona` : '—',
    },
    {
      label: 'Consultas a IA y proveedores',
      value: formatCount(totalOf(m, 'consultas') ?? 0),
      description: `${data.agentsInUse.filter((a) => a !== OTHER_AGENT_KEY).length} agentes en uso`,
    },
    {
      label: 'Empresas aprobadas',
      value: formatCount(totalOf(m, 'aprobadas') ?? 0),
      description: rate === null ? 'Sin empresas para revisar' : `${Math.round(rate * 100)} % de las que llegaron a revisión`,
    },
  ];
  if (cost !== null) {
    items.push({
      label: 'Costo estimado',
      value: formatUsd(cost),
      description: perApproved === null ? 'Sin aprobadas todavía' : `${formatUsd(perApproved)} por aprobada`,
    });
  }
  return <MetricStrip items={items} aria-label="Cifras del uso" />;
}

/** Intensidad de marca por cuartos del máximo (como el gasto en el mapa). */
const HOUR_TONE = ['bg-muted', 'bg-primary/15', 'bg-primary/30', 'bg-primary/50', 'bg-primary/75'] as const;

function hourTone(value: number, max: number): string {
  if (value <= 0 || max <= 0) return HOUR_TONE[0];
  const r = value / max;
  return HOUR_TONE[r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1];
}

export function UsageWeekHours({ data }: { data: UsageMapData }) {
  const max = Math.max(0, ...data.weekHours.flat());
  const peak = peakSlotLabel(data.weekHours);
  return (
    <Frame className="min-w-0">
      <FrameHeader
        title="Cuándo se usa"
        description={peak ? `Hora pico: ${peak} (hora de Colombia)` : 'Sin consultas en el periodo'}
      />
      <FramePanel>
        <Table containerClassName="overflow-x-auto" className="table-fixed border-separate border-spacing-0.5" aria-label="Consultas por día y hora">
            <TableHeader>
              <TableRow className="border-0 hover:bg-transparent">
                <TableHead scope="col" className="h-auto w-10 px-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <TableHead key={h} scope="col" className="h-auto min-w-4 px-0 text-center text-xs font-normal text-muted-foreground">
                    {h % 3 === 0 ? h : ''}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.weekHours.map((hours, day) => (
                <TableRow key={WEEKDAY_LABELS[day]} className="border-0 hover:bg-transparent">
                  <TableHead scope="row" className="h-auto py-0 pr-2 pl-0 text-left text-xs font-medium text-muted-foreground">
                    {WEEKDAY_LABELS[day]}
                  </TableHead>
                  {hours.map((value, hour) => (
                    <TableCell key={hour} className="p-0">
                      <div
                        title={`${WEEKDAY_LABELS[day]} ${String(hour).padStart(2, '0')}:00 · ${formatCount(value)} consultas`}
                        className={cn('h-6 w-full rounded-sm transition-colors', hourTone(value, max))}
                      />
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted-foreground" aria-hidden="true">
          Menos
          {HOUR_TONE.map((tone) => (
            <span key={tone} className={cn('h-3 w-4 rounded-sm', tone)} />
          ))}
          Más
        </div>
      </FramePanel>
    </Frame>
  );
}

const AGENT_COLOR_TOKENS = ['--primary', '--success', '--warning', '--info', '--muted-foreground'] as const;

/** Un token del sistema como `rgb(…)`: ECharts pinta en canvas y no entiende `var(--x)`. */
function resolveTokenColor(token: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${token})`;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}

export function UsageDailyTrend({ data }: { data: UsageMapData }) {
  // La paleta de gráficos de UBITS es una escala de azules: para que cada agente se
  // distinga se usan los tokens de marca, éxito, advertencia e información. Salen del
  // DOM: en el servidor no hay `document` y el gráfico sólo se pinta en el cliente, así
  // que no cambia el HTML que se hidrata.
  const [color] = React.useState<string[] | undefined>(() =>
    typeof document === 'undefined' ? undefined : AGENT_COLOR_TOKENS.map(resolveTokenColor),
  );
  const option = React.useMemo<EChartsOption>(() => {
    const days = data.daily.map((d) => d.day);
    return {
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, icon: 'roundRect' },
      grid: { left: 40, right: 16, top: 16, bottom: 56 },
      xAxis: {
        type: 'category',
        boundaryGap: false,
        data: days.map((day) => formatInAppZone(`${day}T12:00:00Z`, { day: 'numeric', month: 'short' }, 'es-CO', day)),
      },
      yAxis: { type: 'value', minInterval: 1 },
      // El color va en cada serie: `EChart` vuelve a poner la paleta (azul) del tema al
      // cambiar claro/oscuro, y eso sólo pisa el `color` general, no el de la serie.
      series: data.agentsInUse.map((agent, i) => ({
        name: agent === OTHER_AGENT_KEY ? 'Otros usos' : agentLabel(agent),
        ...(color?.[i] ? { itemStyle: { color: color[i] } } : {}),
        type: 'line',
        stack: 'total',
        smooth: true,
        showSymbol: days.length <= 14,
        areaStyle: { opacity: 0.18 },
        lineStyle: { width: 2 },
        emphasis: { focus: 'series' },
        data: data.daily.map((d) => d.byAgent[agent] ?? 0),
      })),
    };
  }, [data, color]);

  return (
    <Frame className="min-w-0">
      <FrameHeader title="Uso de los agentes en el tiempo" description="Consultas por día, apiladas por agente" />
      <FramePanel>
        <EChart option={option} height={260} empty={data.daily.length === 0} />
      </FramePanel>
    </Frame>
  );
}
