// TABLEROS-1 — Opciones de ECharts de /dashboards: se pintan sin errores (render
// SVG del lado del servidor, sin canvas), el USO va en el tono de su resultado
// pero tenue, los estados llevan su color de significado y los huecos son huecos.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as echarts from 'echarts';
import type { SeriesSet } from '@/modules/dashboards/dashboard-core';
import {
  CHART_TOKENS,
  USAGE_OPACITY,
  buildCompletenessBySourceOption,
  buildSeriesBarOption,
  buildSeriesLineOption,
  type TokenColors,
} from '../dashboard-chart-options';

const COLORS = Object.fromEntries(CHART_TOKENS.map((token, i) => [token, `rgb(${i}, ${i}, ${i})`])) as TokenColors;
const BUCKETS = [
  { key: '2026-11-09', label: 'Sem 9 nov' },
  { key: '2026-11-16', label: 'Sem 16 nov' },
];

type AnySeries = { name: string; data: unknown[]; stack?: string; itemStyle?: { color?: string; opacity?: number } };
const seriesOf = (option: ReturnType<typeof buildSeriesBarOption>) => option.series as AnySeries[];

/** Pinta la opción en SVG (sin DOM) y devuelve el SVG; lanza si ECharts no la entiende. */
function renderSvg(option: ReturnType<typeof buildSeriesBarOption>): string {
  const chart = echarts.init(null, null, { renderer: 'svg', ssr: true, width: 600, height: 300 });
  try {
    chart.setOption(option);
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

describe('buildSeriesBarOption', () => {
  const overview: SeriesSet = {
    buckets: BUCKETS,
    series: [
      { key: 'found', label: 'Encontrado (uso)', values: [5, 0] },
      { key: 'enriched', label: 'Enriquecido (resultado)', values: [2, 2] },
    ],
  };

  it('el uso va en el color de su resultado, tenue', () => {
    const [found, enriched] = seriesOf(buildSeriesBarOption(overview, { usageKeys: ['found'] }, COLORS));
    assert.equal(found.itemStyle?.color, enriched.itemStyle?.color);
    assert.equal(found.itemStyle?.opacity, USAGE_OPACITY);
    assert.equal(enriched.itemStyle?.opacity, undefined);
  });

  it('los estados llevan su color de significado y se apilan', () => {
    const states: SeriesSet = {
      buckets: BUCKETS,
      series: [
        { key: 'enriched', label: 'Enriquecida', values: [1, 0] },
        { key: 'failed', label: 'Fallida', values: [0, 1] },
      ],
    };
    const [enriched, failed] = seriesOf(buildSeriesBarOption(states, { stacked: true, semantic: true }, COLORS));
    assert.equal(enriched.itemStyle?.color, COLORS['--success']);
    assert.equal(failed.itemStyle?.color, COLORS['--destructive']);
    assert.equal(enriched.stack, 'total');
  });

  it('sin colores (en el servidor) deja que el tema ponga la paleta', () => {
    const [found] = seriesOf(buildSeriesBarOption(overview, {}, null));
    assert.equal(found.itemStyle?.color, undefined);
  });

  it('ECharts la pinta', () => {
    const svg = renderSvg(buildSeriesBarOption(overview, { usageKeys: ['found'] }, COLORS));
    assert.match(svg, /^<svg/);
    assert.match(svg, /Sem 9 nov/);
  });
});

describe('buildSeriesLineOption', () => {
  it('en porcentaje, de 0 a 100, y un periodo sin base es un hueco', () => {
    const rate: SeriesSet = { buckets: BUCKETS, series: [{ key: 'rate', label: 'Tasa', values: [50, null] }] };
    const option = buildSeriesLineOption(rate, true, COLORS);
    const [line] = option.series as (AnySeries & { connectNulls: boolean })[];
    assert.equal(line.connectNulls, false);
    assert.deepEqual(line.data, [50, null]);
    assert.deepEqual((option.yAxis as { min: number; max: number }).max, 100);
    assert.match(renderSvg(option), /^<svg/);
  });
});

describe('buildCompletenessBySourceOption', () => {
  it('cada fuente suma 100 % y sólo aparecen los estados que existen', () => {
    const option = buildCompletenessBySourceOption(
      [
        {
          source: 'apollo',
          label: 'Apollo',
          total: 4,
          parts: [
            { key: 'full', label: 'Completo', value: 1 },
            { key: 'missing_phone', label: 'Falta teléfono', value: 3 },
            { key: 'missing_email', label: 'Falta correo', value: 0 },
          ],
        },
      ],
      COLORS,
    );
    const series = option.series as AnySeries[];
    assert.deepEqual(series.map((item) => item.name), ['Completo', 'Falta teléfono']);
    assert.deepEqual(series.map((item) => item.data[0]), [25, 75]);
    assert.match(renderSvg(option), /Apollo \(4\)/);
  });
});
