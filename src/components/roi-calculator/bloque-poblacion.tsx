"use client";

/**
 * Reparto de la población. Los cuatro campos se mantienen coherentes entre sí
 * para que nadie tenga que hacer restas: cambiar la población reajusta lo que
 * esté en automático, escribir un porcentaje rellena los dos segmentos, y
 * escribir uno de los segmentos recalcula el otro.
 *
 * Las reglas viven en `modules/roi-calculator/domain/lms/poblacion.ts`; aquí
 * solo se pintan.
 */

import { Wand } from "@/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/forms/field";
import { FormSection } from "@/components/forms/form-section";
import { NumberField } from "@/components/forms/number-field";
import {
  aplicarEdicionPoblacion,
  aplicarReparacion,
  derivarSegmentos,
  modoDe,
  reparacionesSugeridas,
  volverAAutomatico,
  type CampoPoblacion,
} from "@/modules/roi-calculator/domain/lms/poblacion";
import type { PoblacionInput } from "@/modules/roi-calculator/domain/lms/types";
import { fmtEntero } from "@/modules/roi-calculator/lib/format";
import { useROIStore } from "@/modules/roi-calculator/store";

const pctLegible = (pct: number): string =>
  new Intl.NumberFormat("es-CO", { maximumFractionDigits: 1 }).format(pct * 100);

const ATAJOS_PCT = [0.05, 0.1, 0.15] as const;

export function BloquePoblacion({ error }: { error: (ruta: string) => string | undefined }) {
  const poblacion = useROIStore((s) => s.input.capacidad.poblacion);
  const aplicarAlInput = useROIStore((s) => s.aplicarAlInput);

  /** Una sola escritura por edición, aunque toque tres campos. */
  const setPoblacionCampo = (campo: CampoPoblacion, valor: number | null) =>
    aplicarAlInput((input) => ({
      ...input,
      capacidad: {
        ...input.capacidad,
        poblacion: aplicarEdicionPoblacion(input.capacidad.poblacion, campo, valor),
      },
    }));

  const setPoblacion = (siguiente: PoblacionInput) =>
    aplicarAlInput((input) => ({
      ...input,
      capacidad: { ...input.capacidad, poblacion: siguiente },
    }));

  const d = derivarSegmentos(poblacion);
  const modo = modoDe(poblacion);
  const P = poblacion.poblacionTotal;
  const reparaciones = reparacionesSugeridas(poblacion);

  const pctMostrado = modo === "porcentaje" ? poblacion.pctLideresDefault : (d.pctReal ?? 0);
  const enAutomatico = modo === "porcentaje";

  const botonAutomatico = enAutomatico ? null : (
    <Button
      variant="ghost"
      size="xs"
      onClick={() => setPoblacion(volverAAutomatico(poblacion))}
    >
      <Wand />
      Volver a automático
    </Button>
  );

  return (
    <FormSection
      title="La población"
      description="Cuánta gente tendrá acceso y cómo se reparte entre líderes y resto."
      actions={
        P > 0 ? (
          <Badge variant={d.coherente ? "brand" : "warning"}>
            {fmtEntero(d.lideres)} líderes · {fmtEntero(d.resto)} resto
          </Badge>
        ) : null
      }
    >
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
        <Field
          label="Población con acceso (licencias)"
          description="El reparto se ajusta solo al cambiarla."
          error={error("capacidad.poblacion.poblacionTotal")}
        >
          <NumberField
            value={P === 0 ? null : P}
            onValueChange={(v) => setPoblacionCampo("poblacionTotal", v)}
            min={0}
            suffix="pers."
            stepper="none"
          />
        </Field>

        <div className="space-y-2">
          <Field
            label="% de líderes"
            description={
              enAutomatico
                ? "Reparte la población entre líderes y resto."
                : `${pctLegible(pctMostrado)}% real. Escribe uno para repartir de nuevo.`
            }
          >
            <NumberField
              value={P === 0 ? null : Number(pctLegible(pctMostrado).replace(",", "."))}
              onValueChange={(v) => setPoblacionCampo("pctLideres", v === null ? null : v / 100)}
              min={0}
              max={100}
              step={0.1}
              suffix="%"
              stepper="none"
            />
          </Field>
          <div className="flex gap-1">
            {ATAJOS_PCT.map((pct) => (
              <Button
                key={pct}
                variant="outline"
                size="xs"
                onClick={() => setPoblacionCampo("pctLideres", pct)}
              >
                {pctLegible(pct)}%
              </Button>
            ))}
          </div>
        </div>

        <div className="space-y-1">
          <Field
            label="Líderes"
            description={
              d.lideresEstimados
                ? `Calculado: ${pctLegible(pctMostrado)}% de ${fmtEntero(P)}.`
                : "Lo escribiste tú."
            }
          >
            <NumberField
              value={P === 0 ? null : d.lideres}
              onValueChange={(v) => setPoblacionCampo("nLideres", v)}
              min={0}
              stepper="none"
            />
          </Field>
          {!d.lideresEstimados && botonAutomatico}
        </div>

        <div className="space-y-1">
          <Field
            label="Usuarios del resto"
            description={
              d.restoEstimado ? "Calculado: población menos líderes." : "Lo escribiste tú."
            }
          >
            <NumberField
              value={P === 0 ? null : d.resto}
              onValueChange={(v) => setPoblacionCampo("nResto", v)}
              min={0}
              stepper="none"
            />
          </Field>
          {!d.restoEstimado && d.lideresEstimados && botonAutomatico}
        </div>
      </div>

      {P > 0 && (
        <div>
          <div className="flex h-2.5 overflow-hidden rounded-full bg-surface-muted">
            <div
              className="bg-primary transition-[width] duration-500"
              style={{ width: `${Math.min(100, (d.lideres / P) * 100)}%` }}
            />
            <div
              className="bg-chart-3 transition-[width] duration-500"
              style={{ width: `${Math.min(100, (d.resto / P) * 100)}%` }}
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-primary" />
              {fmtEntero(d.lideres)} líderes
            </span>
            <span className="flex items-center gap-1.5">
              <span className="size-2 rounded-full bg-chart-3" />
              {fmtEntero(d.resto)} del resto
            </span>
            {d.sinAsignar !== 0 && (
              <span className="flex items-center gap-1.5 text-warning">
                <span className="size-2 rounded-full bg-warning" />
                {fmtEntero(Math.abs(d.sinAsignar))} {d.sinAsignar > 0 ? "sin asignar" : "de más"}
              </span>
            )}
          </div>
        </div>
      )}

      {reparaciones.length > 0 && (
        <Alert variant="warning">
          <AlertDescription>
            Líderes ({fmtEntero(d.lideres)}) más resto ({fmtEntero(d.resto)}) suman{" "}
            {fmtEntero(d.suma)}, y la población es {fmtEntero(P)}.
          </AlertDescription>
          <div className="mt-2 flex flex-wrap gap-2">
            {reparaciones.map((r) => (
              <Button
                key={r.tipo}
                variant="outline"
                size="sm"
                onClick={() => setPoblacion(aplicarReparacion(poblacion, r))}
              >
                {r.etiqueta}
              </Button>
            ))}
          </div>
        </Alert>
      )}
    </FormSection>
  );
}
