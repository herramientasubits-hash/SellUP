"use client";

/**
 * Datos del prospecto para la proyección.
 *
 * Cuatro bloques: la propuesta, la población, qué incluye la cotización y
 * los supuestos. Abajo queda una franja fija con el valor al día: escribir un
 * número y ver el efecto es lo que convierte el formulario en algo legible.
 */

import { useMemo, useState } from "react";
import { ArrowRight } from "@/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Field } from "@/components/forms/field";
import { FormSection } from "@/components/forms/form-section";
import { NumberField } from "@/components/forms/number-field";
import { PARAM_IDS } from "@/modules/roi-calculator/domain/lms/params";
import { numeroParam } from "@/modules/roi-calculator/domain/params-core";
import { fmtCantidad, fmtEntero, fmtMultiplo, fmtUSD } from "@/modules/roi-calculator/lib/format";
import {
  useEngine,
  useResultado,
  useROIStore,
  useTieneDatos,
} from "@/modules/roi-calculator/store";
import { BloquePoblacion } from "./bloque-poblacion";

/** 0,2 -> 20; 0,2487 -> 24,87. Los campos de porcentaje muestran la tasa en %. */
const aPorcentaje = (r: number | null, decimales: number) =>
  r === null ? null : Math.round(r * 100 * 10 ** decimales) / 10 ** decimales;

export function FormularioProyeccion() {
  const input = useROIStore((s) => s.input);
  const params = useROIStore((s) => s.params);
  const setCampo = useROIStore((s) => s.setCampo);
  const setVista = useROIStore((s) => s.setVista);
  const engine = useEngine();
  const resultado = useResultado();
  const tieneDatos = useTieneDatos();

  const { capacidad } = input;
  const P = capacidad.poblacion.poblacionTotal;
  const palancas = engine.getPalancas();
  // null = las seis. Se resuelve aquí para que el interruptor no tenga que
  // saber que "sin declarar" significa "todas".
  const cotizadas = capacidad.palancasCotizadas ?? null;
  const estaCotizada = (id: string) => cotizadas === null || cotizadas.includes(id);

  /** Las reglas viven en el dominio; aquí solo se pintan. */
  const errores = useMemo(() => {
    const validacion = engine.validarInput(input);
    if (validacion.ok) return {} as Record<string, string>;
    const mapa: Record<string, string> = {};
    for (const e of validacion.errores) if (!mapa[e.campo]) mapa[e.campo] = e.mensaje;
    return mapa;
  }, [engine, input]);

  // Un formulario recién abierto no se pinta de rojo.
  const [tocados, setTocados] = useState<Record<string, boolean>>({});
  const marcar = (ruta: string) => setTocados((t) => (t[ruta] ? t : { ...t, [ruta]: true }));
  const errorDe = (ruta: string) => (tocados[ruta] ? errores[ruta] : undefined);
  const tocar = (ruta: string) => ({ onBlur: () => marcar(ruta) });

  const rotacionDefecto = numeroParam(params, PARAM_IDS.rotacionAnual, 0.2);
  const asrDefecto = numeroParam(params, PARAM_IDS.asrEsperado, 0.15);
  // Las contrataciones no se escriben: salen de la rotación y las calcula el motor.
  const contrataciones =
    resultado.derivados.find((d) => d.etiqueta === "Contrataciones del periodo")?.valor ?? 0;

  function alternarPalanca(id: string, activo: boolean) {
    const actuales = cotizadas ?? palancas.map((x) => x.id);
    const siguiente = activo
      ? [...new Set([...actuales, id])]
      : actuales.filter((x) => x !== id);
    // Si vuelven a estar las seis se guarda null, para que el caso no arrastre
    // una lista equivalente a "todas".
    setCampo("capacidad.palancasCotizadas", siguiente.length === palancas.length ? null : siguiente);
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <FormSection
        title="La propuesta"
        description="A quién se le cotiza y cuánto invertiría al año."
        actions={<Badge variant="neutral">Año completo · 12 meses</Badge>}
      >
        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Nombre del prospecto" error={errorDe("cliente")} required>
            <Input
              value={input.cliente}
              onChange={(e) => setCampo("cliente", e.target.value)}
              placeholder="Empresa S.A.S."
              {...tocar("cliente")}
            />
          </Field>
          <Field
            label="Inversión anual cotizada"
            error={errorDe("capacidad.inversionAnualUSD")}
            required
          >
            <NumberField
              value={capacidad.inversionAnualUSD === 0 ? null : capacidad.inversionAnualUSD}
              onValueChange={(v) => setCampo("capacidad.inversionAnualUSD", v ?? 0)}
              min={0}
              step={100}
              prefix="US$"
              stepper="none"
              {...tocar("capacidad.inversionAnualUSD")}
            />
          </Field>
          <Field
            label="Año de la propuesta"
            description="Define cuántos meses de Modo Estudio aplican."
            error={errorDe("capacidad.anio")}
          >
            <NumberField
              value={capacidad.anio}
              onValueChange={(v) => setCampo("capacidad.anio", v ?? 0)}
              min={2000}
              {...tocar("capacidad.anio")}
            />
          </Field>
        </div>
      </FormSection>

      <BloquePoblacion error={errorDe} />

      <FormSection
        title="Qué incluye la cotización"
        description="Marca solo lo que entra en la propuesta. Lo que dejes fuera no suma valor de mercado."
        actions={
          <Badge variant={cotizadas === null ? "neutral" : "warning"}>
            {cotizadas === null ? "Las 6" : `${cotizadas.length} de ${palancas.length}`}
          </Badge>
        }
      >
        <div className="grid gap-3 md:grid-cols-2">
          {palancas.map((pal) => {
            const activo = estaCotizada(pal.id);
            const id = `palanca-${pal.id}`;
            return (
              <label
                key={pal.id}
                htmlFor={id}
                className="flex cursor-pointer items-start justify-between gap-3 rounded-xl border border-border/60 bg-surface-subtle p-4 transition-colors hover:border-primary/30"
              >
                <span className="min-w-0">
                  <span className="block text-sm font-medium text-foreground">
                    <span className="mr-1.5 text-muted-foreground tabular-nums">{pal.codigo}</span>
                    {pal.nombre}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {pal.descripcionCorta}
                  </span>
                </span>
                <Switch
                  id={id}
                  checked={activo}
                  onCheckedChange={(v) => alternarPalanca(pal.id, v)}
                />
              </label>
            );
          })}
        </div>
      </FormSection>

      <FormSection
        title="Supuestos"
        description="Alimentan Onboarding y Modo Estudio. Si los dejas vacíos se usa el supuesto de mercado."
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Rotación anual"
            description={`Vacío = ${Math.round(rotacionDefecto * 100)}%. De aquí salen las ${fmtEntero(contrataciones)} contrataciones del año que alimentan Onboarding: quien se va, se reemplaza.`}
            error={errorDe("capacidad.rotacionAnual")}
          >
            <NumberField
              value={aPorcentaje(capacidad.rotacionAnual, 1)}
              onValueChange={(v) => setCampo("capacidad.rotacionAnual", v === null ? null : v / 100)}
              min={0}
              max={100}
              step={0.1}
              suffix="%"
              stepper="none"
              placeholder={String(Math.round(rotacionDefecto * 100))}
              {...tocar("capacidad.rotacionAnual")}
            />
          </Field>
          <Field
            label="ASR mensual esperado"
            description={
              `Modo Estudio se calcula con esta tasa: ${fmtCantidad(resultado.fuenteActivos.baseUsada)} usuarios activos sobre ${fmtEntero(P)} personas.` +
              (capacidad.asr6Meses === null
                ? ` Vacío = ${Math.round(asrDefecto * 100)}%, el punto medio del mercado.`
                : "")
            }
            error={errorDe("capacidad.asr6Meses")}
          >
            <NumberField
              value={aPorcentaje(capacidad.asr6Meses, 2)}
              onValueChange={(v) => setCampo("capacidad.asr6Meses", v === null ? null : v / 100)}
              min={0}
              max={100}
              step={0.1}
              suffix="%"
              stepper="none"
              placeholder={String(Math.round(asrDefecto * 100))}
              {...tocar("capacidad.asr6Meses")}
            />
          </Field>
        </div>
      </FormSection>

      {/* Franja fija: el efecto de lo que se escribe, sin cambiar de pestaña.
          Flota separada del borde (bottom-4/6): pegada a él parecía cortada. */}
      {tieneDatos && (
        <div className="sticky bottom-4 z-10 mt-2 flex lg:bottom-6 flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card px-5 py-3 shadow-drawer">
          <div className="flex flex-wrap items-center gap-x-8 gap-y-1">
            <Metrica etiqueta="Valor de mercado" valor={fmtUSD(resultado.totales.instalado)} />
            <Metrica
              etiqueta="Sobre la inversión"
              valor={fmtMultiplo(resultado.totales.techoMultiplo)}
              destacado
            />
          </div>
          <Button size="sm" onClick={() => setVista("reporte")}>
            Ver el reporte
            <ArrowRight />
          </Button>
        </div>
      )}
    </div>
  );
}

function Metrica({
  etiqueta,
  valor,
  destacado,
}: {
  etiqueta: string;
  valor: string;
  destacado?: boolean;
}) {
  return (
    <span className="flex flex-col gap-0.5">
      <span className="text-xs text-muted-foreground">{etiqueta}</span>
      <span
        className={
          destacado
            ? "text-xl font-semibold leading-none tabular-nums text-primary"
            : "text-base font-semibold leading-none tabular-nums text-foreground"
        }
      >
        {valor}
      </span>
    </span>
  );
}
