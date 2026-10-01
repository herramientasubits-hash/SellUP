import { Progress } from '@/components/ui/progress';

const EFFECTIVENESS_GOOD_PCT = 80;
const EFFECTIVENESS_FAIR_PCT = 50;
const FULL_PCT = 100;

type MeterColor = 'success' | 'primary' | 'warning';

/** Verde si va bien, azul si va regular, ámbar si va mal. */
export function effectivenessColor(pct: number): MeterColor {
  if (pct >= EFFECTIVENESS_GOOD_PCT) return 'success';
  if (pct >= EFFECTIVENESS_FAIR_PCT) return 'primary';
  return 'warning';
}

/**
 * Un porcentaje de efectividad dentro de una celda: la barra del sistema
 * (`Progress`) con su cifra escrita al lado. La barra compara, el número informa.
 */
export function EffectivenessMeter({ pct, label }: { pct: number; label: string }) {
  const bounded = Math.min(Math.max(pct, 0), FULL_PCT);
  return (
    <div className="flex items-center justify-end gap-2">
      <Progress
        value={bounded}
        color={effectivenessColor(pct)}
        aria-label={label}
        className="h-1.5 w-20 bg-surface-subtle"
      />
      <span className="text-xs font-medium tabular-nums text-foreground">{pct.toFixed(1)}%</span>
    </div>
  );
}
