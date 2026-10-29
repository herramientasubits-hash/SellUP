'use client';

// «Mapa de uso»: cifras, mapa de calor y, debajo, cuándo se usa y la evolución por agente.

import type { UsageMapData } from '@/modules/ai-usage/usage-map';
import { UsageHeatmap } from './usage-heatmap';
import { UsageDailyTrend, UsageMapMetrics, UsageWeekHours } from './usage-map-panels';
import type { UsageMapNames } from './usage-map-format';

export function UsageMapView({ data, names }: { data: UsageMapData; names: UsageMapNames }) {
  return (
    <div className="space-y-6">
      <UsageMapMetrics data={data} />
      <UsageHeatmap data={data} names={names} />
      <div className="grid gap-4 xl:grid-cols-2">
        <UsageWeekHours data={data} />
        <UsageDailyTrend data={data} />
      </div>
    </div>
  );
}
