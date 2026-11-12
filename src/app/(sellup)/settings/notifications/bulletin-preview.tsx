import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { FREQUENCY_TITLE, deltaPct, type BulletinMember, type BulletinModel, type PulseMetric } from '@/modules/bulletin/bulletin-model';

// ============================================================
// El boletín pintado como un reporte: el mismo modelo que va a Slack, con
// semáforo, cifras contra el período anterior, barras y embudo. Sirve para la
// vista previa y para abrir un boletín del historial.
// ============================================================

const STATUS: Record<BulletinModel['status'], { label: string; variant: 'success' | 'warning' | 'negative'; dot: string }> = {
  verde: { label: 'En buen ritmo', variant: 'success', dot: 'bg-success' },
  amarillo: { label: 'Para revisar', variant: 'warning', dot: 'bg-warning' },
  rojo: { label: 'Atención prioritaria', variant: 'negative', dot: 'bg-destructive' },
};

function sentenceCase(text: string): string {
  return text.charAt(0) + text.slice(1).toLowerCase();
}

function formatValue(value: number, format: PulseMetric['format']): string {
  return format === 'usd'
    ? `US$${value.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : value.toLocaleString('es-CO');
}

function pct(value: number, max: number): number {
  return max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
}

function Bar({ value, max, tone = 'primary', label }: { value: number; max: number; tone?: 'primary' | 'muted'; label: string }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-muted" role="img" aria-label={label}>
      <div
        className={cn('h-full rounded-full', tone === 'primary' ? 'bg-primary' : 'bg-muted-foreground')}
        style={{ width: `${pct(value, max)}%` }}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h4 className="text-sm font-semibold text-foreground">{children}</h4>;
}

function PulseCard({ metric }: { metric: PulseMetric }) {
  const delta = deltaPct(metric.value, metric.previous);
  const good = delta !== null && delta !== 0 && delta > 0 === metric.higherIsBetter;
  const tone = delta === null || delta === 0 ? 'text-muted-foreground' : good ? 'text-success' : 'text-destructive';
  const deltaText = delta === null ? 'Nuevo' : delta === 0 ? '0 %' : `${delta > 0 ? '▲ +' : '▼ '}${delta} %`;
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3" data-testid={`pulse-${metric.key}`}>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <span aria-hidden="true">{metric.emoji}</span>
        {metric.label}
      </p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-foreground">{formatValue(metric.value, metric.format)}</p>
      <p className="mt-0.5 text-xs tabular-nums">
        <span className={cn('font-medium', tone)}>{deltaText}</span>
        <span className="text-muted-foreground"> · antes {formatValue(metric.previous, metric.format)}</span>
      </p>
    </div>
  );
}

function ApprovalRate({ before, now, previousLabel }: { before: number | null; now: number | null; previousLabel: string }) {
  const rows = [
    { label: 'Ahora', value: now, tone: 'primary' as const },
    { label: `Antes (${previousLabel})`, value: before, tone: 'muted' as const },
  ];
  return (
    <div className="space-y-2">
      <SectionTitle>Tasa de aprobación</SectionTitle>
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[8rem_1fr_3.5rem] items-center gap-3 text-xs">
          <span className="truncate text-muted-foreground">{row.label}</span>
          <Bar value={row.value ?? 0} max={100} tone={row.tone} label={`${row.label}: ${row.value ?? 0} %`} />
          <span className="text-right tabular-nums text-foreground">{row.value === null ? '—' : `${row.value} %`}</span>
        </div>
      ))}
    </div>
  );
}

function Funnel({ steps }: { steps: BulletinModel['funnel'] }) {
  const max = Math.max(0, ...steps.map((s) => s.value));
  return (
    <div className="space-y-2">
      <SectionTitle>Embudo del período</SectionTitle>
      {steps.map((step) => (
        <div key={step.label} className="grid grid-cols-[10rem_1fr_3rem] items-center gap-3 text-xs">
          <span className="truncate text-muted-foreground">{step.label}</span>
          <Bar value={step.value} max={max} label={`${step.label}: ${step.value}`} />
          <span className="text-right tabular-nums text-foreground">{step.value.toLocaleString('es-CO')}</span>
        </div>
      ))}
    </div>
  );
}

const SIGNAL_DOT: Record<BulletinMember['signal'], { dot: string; label: string }> = {
  rojo: { dot: 'bg-destructive', label: 'Urge acompañar' },
  naranja: { dot: 'bg-warning', label: 'Algo que mirar' },
  verde: { dot: 'bg-success', label: 'En ritmo' },
  gris: { dot: 'bg-muted-foreground', label: 'Sin actividad' },
};

function daysLabel(days: number): string {
  return days === 1 ? '1 día' : `${days} días`;
}

function count(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function memberFacts(m: BulletinMember, moneyVisible: boolean): string[] {
  return [
    m.searches ? count(m.searches, 'búsqueda', 'búsquedas') : null,
    m.found ? count(m.found, 'encontrada', 'encontradas') : null,
    `${count(m.approved, 'aprobada', 'aprobadas')}${m.approvedPrevious !== m.approved ? ` (antes ${m.approvedPrevious})` : ''}`,
    m.discarded ? count(m.discarded, 'descartada', 'descartadas') : null,
    m.contactsApproved ? count(m.contactsApproved, 'contacto', 'contactos') : null,
    m.firstContacts ? count(m.firstContacts, 'primer contacto', 'primeros contactos') : null,
    m.pending ? `${m.pending} por revisar${m.oldestDays ? ` (${daysLabel(m.oldestDays)})` : ''}` : null,
    m.usage ? (moneyVisible ? formatValue(m.usage, 'usd') : count(m.usage, 'crédito', 'créditos')) : null,
  ].filter((part): part is string => Boolean(part));
}

function Members({ members, moneyVisible }: { members: BulletinMember[]; moneyVisible: boolean }) {
  if (members.length === 0) return null;
  return (
    <ul className="mt-2 divide-y divide-border/60 rounded-xl border border-border/60">
      {members.map((m) => (
        <li key={m.name} className="space-y-0.5 px-3 py-2">
          <div className="flex items-center gap-2 text-sm">
            <span
              className={cn('size-2 shrink-0 rounded-full', SIGNAL_DOT[m.signal].dot)}
              role="img"
              aria-label={SIGNAL_DOT[m.signal].label}
            />
            <span className="truncate font-medium text-foreground">{m.name}</span>
          </div>
          <p className="pl-4 text-xs text-muted-foreground">{memberFacts(m, moneyVisible).join(' · ')}</p>
          {m.note && <p className="pl-4 text-xs text-foreground">↳ {m.note}</p>}
        </li>
      ))}
    </ul>
  );
}

function Teams({ teams, moneyVisible }: { teams: BulletinModel['teams']; moneyVisible: boolean }) {
  if (teams.length === 0) return null;
  const max = Math.max(0, ...teams.map((t) => t.approved));
  return (
    <div className="space-y-4">
      <SectionTitle>Por equipo y por persona</SectionTitle>
      {teams.map((team) => (
        <div key={team.name} className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate font-medium text-foreground">{team.name}</span>
            <span className="shrink-0 tabular-nums text-foreground">{team.approved} aprobadas</span>
          </div>
          <Bar value={team.approved} max={max} label={`${team.name}: ${team.approved} aprobadas`} />
          <p className="text-xs text-muted-foreground">
            {team.active} de {team.people} activos · {team.discarded} descartadas · {team.pending} por revisar
            {team.oldestDays ? ` · la más antigua, ${daysLabel(team.oldestDays)}` : ''}
          </p>
          <Members members={team.members ?? []} moneyVisible={moneyVisible} />
        </div>
      ))}
    </div>
  );
}

function Behind({ behind, inactive }: { behind: BulletinModel['behind']; inactive: string[] }) {
  if (behind.length === 0 && inactive.length === 0) return null;
  return (
    <div className="space-y-2">
      <SectionTitle>A quién acompañar</SectionTitle>
      <ul className="divide-y divide-border/60 rounded-xl border border-border/60">
        {behind.map((person) => (
          <li key={person.name} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <span className="truncate text-foreground">{person.name}</span>
            <span className={cn('shrink-0 text-xs tabular-nums', (person.oldestDays ?? 0) > 7 ? 'text-destructive' : 'text-muted-foreground')}>
              {person.pending} por revisar{person.oldestDays ? ` · ${person.oldestDays === 1 ? '1 día' : `${person.oldestDays} días`}` : ''}
            </span>
          </li>
        ))}
        {inactive.length > 0 && (
          <li className="px-3 py-2 text-xs text-muted-foreground">Sin actividad: {inactive.join(', ')}</li>
        )}
      </ul>
    </div>
  );
}

export interface BulletinPreviewProps {
  model: BulletinModel & { previewOf?: string };
  className?: string;
}

export function BulletinPreview({ model, className }: BulletinPreviewProps) {
  const status = STATUS[model.status] ?? STATUS.amarillo;
  return (
    <article
      aria-label={`Boletín de ${model.recipientName}`}
      className={cn('overflow-hidden rounded-2xl border border-border/60 bg-card shadow-card', className)}
    >
      <header className="space-y-3 border-b border-border/60 bg-primary/10 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            <h3 className="text-lg font-semibold tracking-tight text-foreground">{sentenceCase(FREQUENCY_TITLE[model.frequency] ?? 'Boletín')}</h3>
            <p className="text-sm text-muted-foreground">
              {model.period.label} · {model.scopeLabel} · {model.teamSize} {model.teamSize === 1 ? 'persona' : 'personas'}
            </p>
            <p className="text-xs text-muted-foreground">
              Para {model.recipientName}
              {model.previewOf ? ` · vista de ${model.previewOf}` : ''}
            </p>
          </div>
          <Badge variant={status.variant}>
            <span className={cn('size-1.5 rounded-full', status.dot)} aria-hidden="true" />
            {status.label}
          </Badge>
        </div>
        <p className="text-sm font-medium text-foreground">{model.headline}</p>
        {model.mainAlert && (
          <p className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-foreground">{model.mainAlert}</p>
        )}
      </header>

      <div className="space-y-6 p-5">
        <section className="space-y-2" aria-label="Pulso">
          <SectionTitle>Pulso</SectionTitle>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {model.pulse.map((metric) => (
              <PulseCard key={metric.key} metric={metric} />
            ))}
          </div>
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <ApprovalRate before={model.approvalRate.before} now={model.approvalRate.now} previousLabel={model.period.previousLabel} />
          <Funnel steps={model.funnel} />
        </div>

        <Teams teams={model.teams} moneyVisible={model.moneyVisible} />
        <Behind behind={model.behind} inactive={model.inactive} />

        <section className="rounded-xl bg-surface-muted p-4" aria-label="Cierre">
          <SectionTitle>Cierre</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">{model.closing}</p>
        </section>
      </div>
    </article>
  );
}
