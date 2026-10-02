"use client";

/**
 * Supuestos del modelo, dentro del panel lateral.
 *
 * Solo los administradores editan. El resto ve cada supuesto con su valor y
 * su fuente, que es lo que necesita para defender la cifra delante del
 * cliente. Los cambios se guardan en el navegador de quien los hace.
 */

import { useRef, useState } from "react";
import { Download, Plus, RotateCcw, Trash2, Upload } from "@/icons";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { agruparParams, diffDesdeDefaults } from "@/modules/roi-calculator/domain/params-core";
import type {
  CurvaValue,
  ParamSpec,
  StepsValue,
  VentanaValue,
} from "@/modules/roi-calculator/domain/types";
import { fmtUSD2, nombreMes, slugArchivo } from "@/modules/roi-calculator/lib/format";
import { useROIStore } from "@/modules/roi-calculator/store";

export function PanelParametros({ editable }: { editable: boolean }) {
  const params = useROIStore((s) => s.params);
  const setParamValor = useROIStore((s) => s.setParamValor);
  const setParamFuente = useROIStore((s) => s.setParamFuente);
  const restaurarUnParam = useROIStore((s) => s.restaurarUnParam);
  const restaurarTodos = useROIStore((s) => s.restaurarTodosLosParams);
  const exportar = useROIStore((s) => s.exportarConfiguracion);
  const importar = useROIStore((s) => s.importarConfiguracion);

  const entrada = useRef<HTMLInputElement>(null);
  const [mensajes, setMensajes] = useState<{ errores: string[]; avisos: string[] } | null>(null);

  const grupos = agruparParams(params);
  const modificados = diffDesdeDefaults(params);

  function descargar() {
    const blob = new Blob([exportar()], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `parametros_roi_${slugArchivo(params.productId)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function subir(archivo: File) {
    const resultado = importar(await archivo.text());
    setMensajes({ errores: resultado.errores, avisos: resultado.avisos });
  }

  return (
    <div className="grid gap-5">
      {editable ? (
        <div className="flex flex-wrap items-center gap-2">
          {modificados.length > 0 && (
            <Badge variant="warning">
              {modificados.length}{" "}
              {modificados.length === 1 ? "supuesto modificado" : "supuestos modificados"}
            </Badge>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={descargar}>
              <Download />
              Exportar
            </Button>
            <Button variant="outline" size="sm" onClick={() => entrada.current?.click()}>
              <Upload />
              Importar
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                restaurarTodos();
                setMensajes(null);
              }}
              disabled={modificados.length === 0}
            >
              <RotateCcw />
              Restaurar
            </Button>
          </div>
          <input
            ref={entrada}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void subir(f);
              e.target.value = "";
            }}
          />
        </div>
      ) : (
        <Alert variant="info">
          <AlertDescription>
            Solo los administradores pueden editar los supuestos. Aquí ves cada uno con su fuente.
          </AlertDescription>
        </Alert>
      )}

      {mensajes && (mensajes.errores.length > 0 || mensajes.avisos.length > 0) && (
        <div className="grid gap-2">
          {mensajes.errores.map((e) => (
            <Alert key={e} variant="destructive">
              <AlertTitle>No se pudo importar</AlertTitle>
              <AlertDescription>{e}</AlertDescription>
            </Alert>
          ))}
          {mensajes.avisos.map((a) => (
            <Alert key={a} variant="warning">
              <AlertDescription>{a}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {grupos.map((g) => (
        <section key={g.grupo}>
          <h3 className="border-b border-border/60 pb-2 text-sm font-semibold text-foreground">
            {g.grupo}
          </h3>
          <div>
            {g.params.map((spec) => (
              <EditorParam
                key={spec.id}
                spec={spec}
                editable={editable && spec.editable}
                onValor={(valor) => setParamValor(spec.id, valor)}
                onFuente={(fuente) => setParamFuente(spec.id, fuente)}
                onRestaurar={() => restaurarUnParam(spec.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const esIgual = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Editor de un parámetro. Se renderiza a partir de `kind`, así que agregar un
 * supuesto en `params.ts` lo hace editable sin tocar este archivo.
 */
function EditorParam({
  spec,
  editable,
  onValor,
  onFuente,
  onRestaurar,
}: {
  spec: ParamSpec;
  editable: boolean;
  onValor: (valor: ParamSpec["value"]) => void;
  onFuente: (fuente: string) => void;
  onRestaurar: () => void;
}) {
  const modificado = !esIgual(spec.value, spec.defaultValue);

  return (
    <div className="border-b border-border/60 py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
            {spec.label}
            {modificado && <Badge variant="warning">Modificado</Badge>}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{spec.descripcion}</p>
        </div>
        {editable && modificado && (
          <Button variant="ghost" size="sm" onClick={onRestaurar}>
            <RotateCcw />
            Restaurar
          </Button>
        )}
      </div>

      <div className="mt-3 grid gap-3">
        {editable ? (
          <div>
            <ControlValor spec={spec} onValor={onValor} />
            <p className="mt-1.5 text-xs text-muted-foreground">
              Por defecto: <ValorLegible spec={spec} valor={spec.defaultValue} />
            </p>
          </div>
        ) : (
          <p className="text-sm font-medium tabular-nums text-foreground">
            <ValorLegible spec={spec} valor={spec.value} />
          </p>
        )}

        {editable ? (
          <label className="grid gap-1">
            <span className="text-xs font-medium text-muted-foreground">Fuente</span>
            <Textarea
              value={spec.fuente}
              onChange={(e) => onFuente(e.target.value)}
              rows={2}
              placeholder="De dónde sale este número"
            />
          </label>
        ) : (
          spec.fuente && (
            <p className="rounded-xl bg-surface-subtle px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              Fuente: {spec.fuente}
            </p>
          )
        )}
      </div>
    </div>
  );
}

function ControlValor({
  spec,
  onValor,
}: {
  spec: ParamSpec;
  onValor: (valor: ParamSpec["value"]) => void;
}) {
  switch (spec.kind) {
    case "boolean":
      return (
        <label className="flex cursor-pointer items-center gap-2 text-sm text-foreground">
          <Switch checked={Boolean(spec.value)} onCheckedChange={onValor} />
          {spec.value ? "Activado" : "Desactivado"}
        </label>
      );

    case "enum":
      return (
        <Select
          items={(spec.opciones ?? []).map((o) => ({ value: o.value, label: o.label }))}
          value={String(spec.value)}
          onValueChange={(v) => onValor(v ?? "")}
        >
          <SelectTrigger size="sm" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {spec.opciones?.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );

    case "percent":
      // El rango del spec se pasa: sin esto se podía escribir 150% y el motor
      // lo acotaba por su cuenta, así que las dos cifras dejaban de coincidir.
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            value={Math.round(Number(spec.value) * 10000) / 100}
            onChange={(e) => onValor(Number(e.target.value) / 100)}
            min={spec.min === undefined ? undefined : spec.min * 100}
            max={spec.max === undefined ? undefined : spec.max * 100}
            step={spec.step === undefined ? 1 : spec.step * 100}
            className="w-32 max-w-full tabular-nums"
          />
          <span className="text-sm text-muted-foreground">%</span>
        </div>
      );

    case "steps": {
      const steps = spec.value as StepsValue;
      return (
        <div className="grid gap-1.5">
          {steps.tramos.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-32 shrink-0 text-xs text-muted-foreground">
                {t.hasta === null ? "Más de lo anterior" : `Hasta ${t.hasta}`}
              </span>
              <Input
                type="number"
                value={t.valor}
                onChange={(e) => {
                  const tramos = steps.tramos.map((x, j) =>
                    j === i ? { ...x, valor: Number(e.target.value) } : x,
                  );
                  onValor({ tramos });
                }}
                className="w-32 max-w-full tabular-nums"
              />
            </div>
          ))}
        </div>
      );
    }

    case "curva": {
      const curva = spec.value as CurvaValue;
      // Las anclas se guardan ordenadas de menos a más cantidad: una lista
      // desordenada en pantalla se lee como un error.
      const conAnclas = (anclas: CurvaValue["anclas"]) =>
        onValor({ anclas: [...anclas].sort((a, b) => a.cantidad - b.cantidad) });

      return (
        <div className="grid gap-1.5">
          {curva.anclas.map((a, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <Input
                type="number"
                value={a.cantidad}
                aria-label="Cantidad"
                onChange={(e) =>
                  conAnclas(
                    curva.anclas.map((x, j) =>
                      j === i ? { ...x, cantidad: Number(e.target.value) } : x,
                    ),
                  )
                }
                className="w-28 tabular-nums"
              />
              <span className="shrink-0 text-xs text-muted-foreground">→</span>
              <Input
                type="number"
                value={a.valor}
                aria-label="Precio unitario"
                onChange={(e) =>
                  conAnclas(
                    curva.anclas.map((x, j) =>
                      j === i ? { ...x, valor: Number(e.target.value) } : x,
                    ),
                  )
                }
                className="w-28 tabular-nums"
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Quitar el nivel de ${a.cantidad}`}
                disabled={curva.anclas.length <= 2}
                onClick={() => conAnclas(curva.anclas.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const ultima = curva.anclas[curva.anclas.length - 1];
                conAnclas([
                  ...curva.anclas,
                  { cantidad: (ultima?.cantidad ?? 100) * 2, valor: ultima?.valor ?? 0 },
                ]);
              }}
            >
              <Plus />
              Añadir nivel
            </Button>
          </div>
        </div>
      );
    }

    case "ventana": {
      const v = spec.value as VentanaValue;
      const meses = Array.from({ length: 12 }, (_, i) => i + 1);
      return (
        <div className="flex items-center gap-2">
          <Select
            items={meses.map((m) => ({ value: String(m), label: nombreMes(m) }))}
            value={String(v.desde.mes)}
            onValueChange={(mes) => onValor({ desde: { ...v.desde, mes: Number(mes) } })}
          >
            <SelectTrigger size="sm" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {meses.map((m) => (
                <SelectItem key={m} value={String(m)}>
                  {nombreMes(m)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            type="number"
            value={v.desde.anio}
            onChange={(e) => onValor({ desde: { ...v.desde, anio: Number(e.target.value) } })}
            className="w-24 tabular-nums"
          />
        </div>
      );
    }

    default:
      return (
        <Input
          type="number"
          value={Number(spec.value)}
          onChange={(e) => onValor(Number(e.target.value))}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          className="w-40 tabular-nums"
        />
      );
  }
}

function ValorLegible({ spec, valor }: { spec: ParamSpec; valor: ParamSpec["value"] }) {
  switch (spec.kind) {
    case "boolean":
      return <>{valor ? "Activado" : "Desactivado"}</>;
    case "percent":
      return <>{Math.round(Number(valor) * 100)}%</>;
    case "currency":
      return <>{fmtUSD2(Number(valor))}</>;
    case "enum":
      return <>{spec.opciones?.find((o) => o.value === valor)?.label ?? String(valor)}</>;
    case "steps":
      return <>{(valor as StepsValue).tramos.map((t) => t.valor).join(" · ")}</>;
    case "curva": {
      const anclas = (valor as CurvaValue).anclas;
      const primera = anclas[0];
      const ultima = anclas[anclas.length - 1];
      if (!primera || !ultima) return <>Sin niveles</>;
      return (
        <>
          {fmtUSD2(primera.valor)} en {primera.cantidad} → {fmtUSD2(ultima.valor)} en{" "}
          {ultima.cantidad} · {anclas.length} niveles
        </>
      );
    }
    case "ventana": {
      const v = valor as VentanaValue;
      return (
        <>
          Desde {nombreMes(v.desde.mes)} de {v.desde.anio}
        </>
      );
    }
    default:
      return <>{String(valor)}</>;
  }
}
