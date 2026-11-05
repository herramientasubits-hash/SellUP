'use client';

/**
 * LAUNCH-GATE-2026-11 — aviso del login mientras el ingreso está cerrado hasta el lanzamiento.
 *   · `leaders`: cuenta regresiva hasta la apertura de líderes.
 *   · `team`: «hasta la reunión de lanzamiento interno», sin cuenta regresiva.
 *   · sin audiencia (nadie ha intentado entrar): las dos cosas, cada una para quien corresponde.
 */

import { useEffect, useState } from 'react';
import { Clock } from '@/icons';
import type { LaunchAudience } from '@/modules/auth/launch-gate';

interface LaunchHoldNoticeProps {
  audience: LaunchAudience | null;
  leadersOpenAt: string;
}

const SECOND_MS = 1000;
const UNITS = [
  { label: 'días', ms: 86_400_000 },
  { label: 'horas', ms: 3_600_000 },
  { label: 'min', ms: 60_000 },
  { label: 'seg', ms: SECOND_MS },
] as const;

function splitRemaining(ms: number): number[] {
  let rest = Math.max(0, ms);
  return UNITS.map(({ ms: unit }) => {
    const value = Math.floor(rest / unit);
    rest -= value * unit;
    return value;
  });
}

function formatOpening(iso: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  }).format(new Date(iso));
}

function useRemainingMs(targetIso: string): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);
  useEffect(() => {
    const target = Date.parse(targetIso);
    const tick = () => setRemaining(target - Date.now());
    tick();
    const id = window.setInterval(tick, SECOND_MS);
    return () => window.clearInterval(id);
  }, [targetIso]);
  return remaining;
}

function LeadersCountdown({ leadersOpenAt }: { leadersOpenAt: string }) {
  const remaining = useRemainingMs(leadersOpenAt);
  if (remaining !== null && remaining <= 0) {
    return <p className="text-sm font-medium text-success">Ya puedes entrar: inicia sesión con tu cuenta de UBITS.</p>;
  }
  const parts = splitRemaining(remaining ?? 0);
  return (
    <div className="grid gap-2">
      <ol className="grid grid-cols-4 gap-2" aria-live="off" aria-label="Tiempo que falta para el lanzamiento">
        {UNITS.map((unit, i) => (
          <li key={unit.label} className="grid justify-items-center rounded-xl bg-primary/10 px-2 py-2.5">
            <span className="text-2xl font-semibold tabular-nums text-primary">
              {remaining === null ? '–' : String(parts[i]).padStart(2, '0')}
            </span>
            <span className="text-xs text-muted-foreground">{unit.label}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted-foreground">Abre el {formatOpening(leadersOpenAt)} (hora de Bogotá).</p>
    </div>
  );
}

export function LaunchHoldNotice({ audience, leadersOpenAt }: LaunchHoldNoticeProps) {
  return (
    <section
      aria-labelledby="launch-hold-title"
      className="grid gap-4 rounded-2xl border border-primary/20 bg-primary/5 p-4 animate-su-fade-in"
    >
      <div className="flex items-start gap-2.5">
        <Clock className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="grid gap-1">
          <h2 id="launch-hold-title" className="text-sm font-semibold">
            El ingreso está cerrado hasta el lanzamiento
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Estamos dejando SellUp listo para ti. Mientras tanto, el ingreso está bloqueado por un momento.
          </p>
        </div>
      </div>

      {audience !== 'team' && (
        <div className="grid gap-2">
          {audience === null && <p className="text-xs font-semibold">Líderes comerciales</p>}
          <LeadersCountdown leadersOpenAt={leadersOpenAt} />
        </div>
      )}

      {audience !== 'leaders' && (
        <div className="grid gap-1">
          {audience === null && <p className="text-xs font-semibold">Vendedores y resto del equipo</p>}
          <p className="text-sm">
            Podrás entrar después de la <span className="font-semibold">reunión de lanzamiento interno</span>. Te
            avisaremos.
          </p>
        </div>
      )}
    </section>
  );
}
