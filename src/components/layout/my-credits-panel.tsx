"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatUSD } from "@/lib/format-money";
import { formatInAppZone } from "@/lib/format-date";
import { getMyCreditUsage } from "@/modules/my-credits/actions";
import type { MyCreditsResult, MyCreditsRow, MyCreditsTone } from "@/modules/my-credits/core";

/** Mientras la pestaña siga abierta, abrir y cerrar el menú no vuelve a consultar. */
export const MY_CREDITS_CACHE_MS = 60_000;

let cache: { at: number; data: MyCreditsResult } | null = null;

/** Sólo para pruebas. */
export function resetMyCreditsCache() {
  cache = null;
}

const countFormat = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 0 });

export function formatMyCreditsAmount(row: Pick<MyCreditsRow, "unit">, value: number): string {
  return row.unit === "usd" ? formatUSD(value) : countFormat.format(Math.round(value));
}

/** «noviembre»: el mes del período (en UTC, como lo cuenta el presupuesto). */
export function myCreditsMonthLabel(periodStart: string): string {
  return new Intl.DateTimeFormat("es-CO", { month: "long", timeZone: "UTC" }).format(new Date(periodStart));
}

/** «30 de nov, 7:00 p. m.»: cuándo se renueva, en hora de Colombia. */
export function myCreditsRenewalLabel(periodEnd: string): string {
  const day = formatInAppZone(periodEnd, { day: "numeric", month: "short" });
  const time = formatInAppZone(periodEnd, { hour: "numeric", minute: "2-digit" });
  return `${day.replace(".", "")}, ${time}`;
}

const TONE_TO_COLOR: Record<MyCreditsTone, "primary" | "warning" | "destructive"> = {
  normal: "primary",
  warning: "warning",
  danger: "destructive",
};

function CreditsRow({ row }: { row: MyCreditsRow }) {
  const amount = (v: number) => formatMyCreditsAmount(row, v);
  const extras: string[] = [];
  if (row.extras?.grantsForUser) extras.push(`${amount(row.extras.grantsForUser)} aprobados para ti`);
  if (row.extras?.carriedIn) extras.push(`${amount(row.extras.carriedIn)} del mes anterior`);
  if (row.extras?.topUps) extras.push(`${amount(row.extras.topUps)} de recarga`);

  return (
    <li className="space-y-1" data-provider={row.providerKey}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate font-medium text-foreground">{row.displayName}</span>
        <span
          className={cn(
            "shrink-0 tabular-nums",
            row.tone === "danger" ? "font-semibold text-destructive" : "text-text-muted",
          )}
        >
          {row.limit === null
            ? `${amount(row.used)} usados`
            : `${amount(row.used)} / ${amount(row.limit)}`}
        </span>
      </div>

      {row.limit !== null && row.percent !== null && (
        <div className="flex items-center gap-2">
          <Progress
            value={Math.min(100, Math.max(0, row.percent))}
            color={TONE_TO_COLOR[row.tone]}
            aria-label={`Consumo de ${row.displayName}: ${Math.round(row.percent)} %`}
          />
          <span className="w-9 shrink-0 text-right text-xs tabular-nums text-text-muted">
            {Math.round(row.percent)} %
          </span>
        </div>
      )}

      {row.shared && row.ownUsed !== null && (
        <p className="text-xs text-text-muted">Cupo de equipo · tú usaste {amount(row.ownUsed)}</p>
      )}
      {extras.length > 0 && <p className="text-xs text-text-muted">Incluye {extras.join(", ")}</p>}

      {row.exhausted &&
        (row.onExceed === "require_approval" ? (
          <Link href="/credit-approvals" className="text-xs font-semibold text-primary hover:underline">
            Sin créditos · Pedir más créditos
          </Link>
        ) : row.onExceed === "block" ? (
          <p className="text-xs font-semibold text-destructive">Sin créditos este mes, habla con tu líder</p>
        ) : (
          <p className="text-xs font-semibold text-destructive">Llegaste al límite de este mes</p>
        ))}
    </li>
  );
}

/**
 * «Mis créditos · {mes}» dentro del menú de cuenta. Se monta al abrir el menú y
 * consulta en ese momento; un fallo aquí nunca impide «Cerrar sesión».
 */
export function MyCreditsPanel() {
  const [state, setState] = React.useState<
    { status: "loading" } | { status: "error" } | { status: "ready"; data: MyCreditsResult }
  >(() =>
    cache && Date.now() - cache.at < MY_CREDITS_CACHE_MS
      ? { status: "ready", data: cache.data }
      : { status: "loading" },
  );

  // Sólo pone estado DESPUÉS de la consulta: el «cargando» inicial ya viene del useState.
  const fetchUsage = React.useCallback(async () => {
    try {
      const data = await getMyCreditUsage();
      if (!data) {
        setState({ status: "error" });
        return;
      }
      cache = { at: Date.now(), data };
      setState({ status: "ready", data });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  const startedLoading = React.useRef(state.status === "loading");
  React.useEffect(() => {
    // Sólo al montar (con el menú abierto); el reintento lo pide la persona.
    if (startedLoading.current) void fetchUsage();
  }, [fetchUsage]);

  const retry = () => {
    setState({ status: "loading" });
    void fetchUsage();
  };

  const title =
    state.status === "ready" ? `Mis créditos · ${myCreditsMonthLabel(state.data.periodStart)}` : "Mis créditos";

  return (
    <section aria-label="Mis créditos" className="space-y-2 px-2.5 py-2">
      <p className="text-xs font-semibold text-foreground">{title}</p>

      {state.status === "loading" && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-7 w-full" />
          <Skeleton className="h-7 w-full" />
        </div>
      )}

      {state.status === "error" && (
        <div className="flex items-center justify-between gap-2 text-xs text-text-muted">
          <span>No pudimos cargar tus créditos.</span>
          <button
            type="button"
            className="font-semibold text-primary hover:underline"
            onClick={(event) => {
              // Que el clic no cierre el menú.
              event.preventDefault();
              event.stopPropagation();
              retry();
            }}
          >
            Reintentar
          </button>
        </div>
      )}

      {state.status === "ready" && (
        <>
          {state.data.rows.length === 0 ? (
            <p className="text-xs text-text-muted">Este mes aún no has usado créditos.</p>
          ) : (
            <ul className="space-y-3">
              {state.data.rows.map((row) => (
                <CreditsRow key={row.providerKey} row={row} />
              ))}
            </ul>
          )}
          {state.data.partial && (
            <p className="text-xs text-text-muted">Alguna fuente no se pudo leer; puede faltar consumo.</p>
          )}
          <p className="text-xs text-text-muted">Se renueva el {myCreditsRenewalLabel(state.data.periodEnd)}</p>
        </>
      )}
    </section>
  );
}
