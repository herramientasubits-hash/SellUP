"use client";

/**
 * El reporte de la proyección.
 *
 * Itera sobre `resultado.palancas` y no menciona ninguna palanca por su
 * nombre. La UI no hace aritmética: cada número que aparece existe como campo
 * de `ROIResultado`.
 */

import { useState } from "react";
import { ChevronDown, TrendingUp } from "@/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/shared/section-header";
import { SurfaceCard } from "@/components/shared/surface-card";
import { cn } from "@/lib/utils";
import type { LMSInput } from "@/modules/roi-calculator/domain/lms/types";
import type { Benchmark, PalancaResultado, ROIResultado } from "@/modules/roi-calculator/domain/types";
import {
  fmtCantidad,
  fmtEntero,
  fmtMultiplo,
  fmtUSD,
} from "@/modules/roi-calculator/lib/format";
import { Explicador } from "./explicador";

export function PanelResultados({ resultado }: { resultado: ROIResultado<LMSInput> }) {
  const { totales, periodo } = resultado;
  const prorrateado = resultado.advertencias.some((a) => a.codigo === "PRORRATEO_ACCESO_ACTIVO");

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <Encabezado resultado={resultado} />

      {resultado.acotacion && (
        <Alert variant="info">
          <AlertDescription>
            El valor se acotó a {fmtCantidad(resultado.acotacion.techoMaximo)} veces la inversión.
            A precio de catálogo serían {fmtUSD(resultado.acotacion.instaladoSinAcotar)}: por encima
            de ese múltiplo la cifra deja de sostenerse delante del cliente.
          </AlertDescription>
        </Alert>
      )}

      {prorrateado && (
        <Alert variant="info">
          <AlertDescription>
            Cálculo prorrateado a {periodo.mesesContrato}{" "}
            {periodo.mesesContrato === 1 ? "mes" : "meses"} de contrato: las palancas de acceso se
            multiplicaron por {periodo.mesesContrato}/12.
          </AlertDescription>
        </Alert>
      )}

      <SurfaceCard noPadding>
        <SectionHeader
          className="px-6 pt-5"
          title="Palanca por palanca"
          description="Lo que va a tener disponible en cada palanca. Abre una fila para ver cómo se calcula."
        />
        <PalancasDetalle palancas={resultado.palancas} />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/60 bg-surface-subtle px-6 py-3.5">
          <span className="text-sm font-semibold text-foreground">Total</span>
          <span className="text-sm text-muted-foreground">
            Valor de mercado{" "}
            <span className="font-semibold tabular-nums text-foreground">
              {fmtUSD(totales.instalado)}
            </span>
          </span>
        </div>
      </SurfaceCard>

      <section className="grid gap-4">
        <SectionHeader
          title="Contra qué se le va a medir al cierre"
          description="Las tres varas del mercado. En la venta todavía no hay uso: aquí solo queda la referencia."
        />
        <Varas benchmarks={resultado.benchmarks} />
      </section>

      <Detalles
        resumen="Cómo se calculó"
        pista="Cifras intermedias, la base de Modo Estudio y las advertencias del modelo."
      >
        <div className="grid gap-5">
          <p className="rounded-xl bg-primary/5 p-4 text-sm leading-relaxed text-foreground">
            Modo Estudio se calculó con <strong>{resultado.fuenteActivos.etiquetaUsada}</strong>:{" "}
            <span className="font-semibold tabular-nums">
              {fmtCantidad(resultado.fuenteActivos.baseUsada)}
            </span>{" "}
            usuarios activos al mes.
          </p>

          <dl className="grid gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-4">
            {resultado.derivados.map((d) => (
              <div
                key={d.etiqueta}
                className="flex items-baseline justify-between gap-2 border-b border-border/60 py-1.5"
              >
                <dt className="text-xs text-muted-foreground">{d.etiqueta}</dt>
                <dd className="text-sm font-medium tabular-nums text-foreground">
                  {d.unidad === "usd_unitario"
                    ? fmtUSD(d.valor)
                    : d.unidad === "meses"
                      ? `${fmtEntero(d.valor)} ${d.valor === 1 ? "mes" : "meses"}`
                      : fmtEntero(d.valor)}
                </dd>
              </div>
            ))}
          </dl>

          {resultado.advertencias.length > 0 && (
            <div className="grid gap-2">
              {resultado.advertencias.map((a) => (
                <Alert key={a.id} variant={a.severidad === "info" ? "info" : "warning"}>
                  <AlertDescription>
                    <span className="block text-foreground">{a.mensaje}</span>
                    {a.correccion && (
                      <span className="mt-1 block text-muted-foreground">{a.correccion}</span>
                    )}
                  </AlertDescription>
                </Alert>
              ))}
            </div>
          )}
        </div>
      </Detalles>
    </div>
  );
}

/** La cifra que manda en la pantalla: cuánto va a tener y qué múltiplo saca. */
function Encabezado({ resultado }: { resultado: ROIResultado<LMSInput> }) {
  const { totales, periodo } = resultado;
  const cliente = resultado.cliente.trim() || "Este prospecto";

  return (
    <SurfaceCard className="overflow-hidden" noPadding>
      <div className="grid gap-6 p-6 sm:p-8 lg:grid-cols-[1.4fr_1fr] lg:items-center">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="warning">Proyección</Badge>
            <span className="text-sm text-muted-foreground">
              {cliente} · {periodo.anio} · {periodo.mesesContrato} meses
            </span>
          </div>

          <h2 className="mt-4 text-2xl leading-tight font-semibold tracking-tight text-foreground sm:text-3xl">
            Va a tener disponible{" "}
            <span className="tabular-nums text-primary">{fmtUSD(totales.instalado)}</span> sobre{" "}
            <span className="tabular-nums text-primary">{fmtUSD(totales.inversion)}</span> de
            inversión.
          </h2>

          <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Capacidad instalada sobre {fmtEntero(totales.poblacionCubierta)} personas, disponible
            desde el primer día. Se juzga por cobertura: UBITS es un all you can eat, y todo depende
            de cuánto valor tomen.
          </p>
        </div>

        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingUp className="size-3.5 text-primary" />
            Valor disponible sobre la inversión
            <Explicador
              titulo="Valor disponible sobre la inversión"
              explicacion={{
                formula: "capacidad cotizada ÷ inversión cotizada",
                texto: `${fmtUSD(totales.instalado)} ÷ ${fmtUSD(totales.inversion)}`,
                lineas: [],
                notas: ["Aritmética sobre la cotización: no es una medición."],
              }}
            />
          </div>

          <p className="mt-2 text-5xl leading-none font-semibold tracking-tight tabular-nums text-primary">
            {fmtMultiplo(totales.techoMultiplo)}
          </p>

          <dl className="mt-5 grid gap-2 border-t border-primary/15 pt-4 text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Inversión anual</dt>
              <dd className="font-medium tabular-nums text-foreground">{fmtUSD(totales.inversion)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="text-muted-foreground">Población cubierta</dt>
              <dd className="font-medium tabular-nums text-foreground">
                {fmtEntero(totales.poblacionCubierta)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      {resultado.proyeccion.descargo && (
        <p className="border-t border-border/60 bg-surface-subtle px-6 py-3 text-xs text-muted-foreground sm:px-8">
          {resultado.proyeccion.descargo}
        </p>
      )}
    </SurfaceCard>
  );
}

/** Cada palanca, una fila con su barra; la barra llena es lo que vale, sin reparto. */
function PalancasDetalle({ palancas }: { palancas: PalancaResultado[] }) {
  const ordenadas = [...palancas].sort((a, b) => b.instalado - a.instalado);
  const maximo = Math.max(...ordenadas.map((p) => p.instalado), 1);

  return (
    <ul className="divide-y divide-border/60">
      {ordenadas.map((p) => (
        <FilaPalanca key={p.id} palanca={p} maximo={maximo} />
      ))}
    </ul>
  );
}

function FilaPalanca({ palanca: p, maximo }: { palanca: PalancaResultado; maximo: number }) {
  const [abierta, setAbierta] = useState(false);
  const ancho = Math.max(2, (p.instalado / maximo) * 100);

  return (
    <li>
      <button
        type="button"
        onClick={() => setAbierta((v) => !v)}
        aria-expanded={abierta}
        className="w-full px-6 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="text-xs tabular-nums text-muted-foreground">{p.codigo}</span>
            <span className="truncate text-sm font-semibold text-foreground">{p.nombre}</span>
            {!p.enCotizacion && <Badge variant="neutral">Fuera de la cotización</Badge>}
          </span>
          <span className="flex items-center gap-3 text-sm">
            <span className="font-semibold tabular-nums text-foreground">{fmtUSD(p.instalado)}</span>
            <ChevronDown
              aria-hidden
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                abierta && "rotate-180",
              )}
            />
          </span>
        </div>

        <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-surface-muted">
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500",
              p.enCotizacion ? "bg-primary" : "bg-border",
            )}
            style={{ width: `${ancho}%` }}
          />
        </div>
      </button>

      {abierta && (
        <div className="border-t border-border/60 bg-surface-subtle px-6 py-4">
          <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            Capacidad instalada
            <Explicador
              titulo={`${p.codigo} · capacidad instalada`}
              explicacion={p.explicacionInstalado}
            />
          </p>
          <p className="mt-1 text-lg font-semibold tabular-nums text-foreground">{fmtUSD(p.instalado)}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {p.explicacionInstalado.texto}
          </p>
          {p.explicacionInstalado.notas.length > 0 && (
            <ul className="mt-2 grid gap-0.5 text-xs text-muted-foreground">
              {p.explicacionInstalado.notas.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
}

/** Las tres varas: en venta no miden, solo dicen contra qué se medirá. */
function Varas({ benchmarks }: { benchmarks: Benchmark[] }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {benchmarks.map((b) => (
        <SurfaceCard key={b.id} className="p-5" noPadding>
          <h3 className="flex min-w-0 items-start gap-1.5 text-sm leading-snug font-semibold text-foreground">
            <span className="min-w-0">{b.nombre}</span>
            <Explicador explicacion={b.explicacion} titulo={b.nombre} />
          </h3>

          <p className="mt-4 text-xs text-muted-foreground">Referencia del mercado</p>
          <p className="mt-1 text-2xl leading-none font-semibold tabular-nums text-foreground">
            {b.referenciaTexto}
          </p>

          {b.fuenteReferencia && (
            <p className="mt-4 border-t border-border/60 pt-2 text-xs text-muted-foreground">
              {b.fuenteReferencia}
            </p>
          )}
        </SurfaceCard>
      ))}
    </div>
  );
}

/** Bloque plegable para el detalle que no todos necesitan ver siempre. */
function Detalles({
  resumen,
  pista,
  children,
}: {
  resumen: string;
  pista: string;
  children: React.ReactNode;
}) {
  const [abierto, setAbierto] = useState(false);

  return (
    <SurfaceCard noPadding className="overflow-hidden">
      <button
        type="button"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        className="flex w-full items-center justify-between gap-3 px-6 py-4 text-left transition-colors hover:bg-surface-subtle focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground">{resumen}</span>
          <span className="mt-0.5 block text-sm text-muted-foreground">{pista}</span>
        </span>
        <ChevronDown
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-muted-foreground transition-transform",
            abierto && "rotate-180",
          )}
        />
      </button>
      {abierto && <div className="border-t border-border/60 p-6">{children}</div>}
    </SurfaceCard>
  );
}
