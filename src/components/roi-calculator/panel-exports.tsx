"use client";

/**
 * Entregables: el PDF para mandar, el PPTX para presentar y el guion para
 * hablar. Los documentos llevan la marca UBITS porque son para el cliente; la
 * pantalla sigue el sistema de SellUP.
 */

import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { Check, Copy, Download, MessageSquareText, Presentation } from "@/icons";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/shared/section-header";
import { SurfaceCard } from "@/components/shared/surface-card";
import type { LMSInput } from "@/modules/roi-calculator/domain/lms/types";
import type { ROIResultado } from "@/modules/roi-calculator/domain/types";
import { guionCompleto, guionDeVenta } from "@/modules/roi-calculator/exports/guion-venta";
import { slugArchivo } from "@/modules/roi-calculator/lib/format";

export function PanelExports({ resultado }: { resultado: ROIResultado<LMSInput> }) {
  const bloques = useMemo(() => guionDeVenta(resultado), [resultado]);
  const [copiado, setCopiado] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generando, setGenerando] = useState<"pdf" | "pptx" | null>(null);
  const [guionAbierto, setGuionAbierto] = useState(false);

  // El prefijo dice que esto es una proyección, no un reporte de uso real.
  const nombreArchivo = `ROI_PROYECCION_UBITS_${slugArchivo(resultado.cliente)}_${resultado.periodo.anio}`;

  // jsPDF y pptxgenjs pesan más que toda la pantalla y solo hacen falta al
  // exportar: se cargan cuando el usuario pulsa el botón, no al abrir.
  async function descargar(formato: "pdf" | "pptx") {
    setGenerando(formato);
    setError(null);
    try {
      if (formato === "pdf") {
        const { descargarPDFProyeccion } = await import(
          "@/modules/roi-calculator/exports/proyeccion-pdf"
        );
        await descargarPDFProyeccion(resultado);
      } else {
        const { descargarPPTXProyeccion } = await import(
          "@/modules/roi-calculator/exports/proyeccion-pptx"
        );
        await descargarPPTXProyeccion(resultado);
      }
    } catch {
      setError(`No se pudo generar el ${formato.toUpperCase()}. Vuelve a intentarlo.`);
    } finally {
      setGenerando(null);
    }
  }

  async function copiar(id: string, texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(id);
      setTimeout(() => setCopiado((c) => (c === id ? null : c)), 2000);
    } catch {
      setError("El navegador no dejó copiar al portapapeles. Selecciona el texto y cópialo a mano.");
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <section className="grid gap-4">
        <SectionHeader
          title="Entregables"
          description={`Los archivos se descargan como ${nombreArchivo}.`}
        />

        {error && (
          <Alert variant="warning">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 lg:grid-cols-3">
          <TarjetaEntregable
            icono={<Download className="size-4" />}
            titulo="Reporte en PDF"
            formato="1 página"
            descripcion="Una hoja: lo que va a tener disponible, qué incluye la cotización y cómo se comprueba al cierre. Para mandársela al prospecto."
            accion={
              <Button
                className="w-full"
                onClick={() => void descargar("pdf")}
                disabled={generando !== null}
              >
                <Download />
                {generando === "pdf" ? "Generando…" : "Descargar PDF"}
              </Button>
            }
          />

          <TarjetaEntregable
            icono={<Presentation className="size-4" />}
            titulo="Presentación"
            formato="2 slides"
            descripcion="Lo que va a tener disponible y qué incluye la cotización. Para la reunión de venta."
            accion={
              <Button
                variant="outline"
                className="w-full"
                onClick={() => void descargar("pptx")}
                disabled={generando !== null}
              >
                <Presentation />
                {generando === "pptx" ? "Generando…" : "Descargar PPTX"}
              </Button>
            }
          />

          <TarjetaEntregable
            icono={<MessageSquareText className="size-4" />}
            titulo="Guion de conversación"
            formato={`${bloques.length} bloques`}
            descripcion="Las frases ya construidas con los números de esta cotización: apertura, qué está comprando y cómo se comprueba al cierre."
            accion={
              <Button
                variant="outline"
                className="w-full"
                onClick={() => setGuionAbierto((v) => !v)}
              >
                <MessageSquareText />
                {guionAbierto ? "Ocultar el guion" : "Ver el guion"}
              </Button>
            }
          />
        </div>
      </section>

      {guionAbierto && (
        <SurfaceCard>
          <SectionHeader
            title="Guion de conversación"
            description="Construido con los números de esta cotización. Listo para copiar y pegar."
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={() => void copiar("todo", guionCompleto(bloques))}
              >
                {copiado === "todo" ? <Check /> : <Copy />}
                {copiado === "todo" ? "Copiado" : "Copiar todo"}
              </Button>
            }
          />
          <div className="mt-4 grid gap-3">
            {bloques.map((b) => (
              <div key={b.id} className="rounded-xl border border-border/60 bg-surface-subtle p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-semibold text-foreground">{b.titulo}</h3>
                  <Button variant="ghost" size="sm" onClick={() => void copiar(b.id, b.texto)}>
                    {copiado === b.id ? <Check /> : <Copy />}
                    {copiado === b.id ? "Copiado" : "Copiar"}
                  </Button>
                </div>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-foreground">
                  {b.texto}
                </p>
              </div>
            ))}
          </div>
        </SurfaceCard>
      )}
    </div>
  );
}

function TarjetaEntregable({
  icono,
  titulo,
  formato,
  descripcion,
  accion,
}: {
  icono: ReactNode;
  titulo: string;
  formato: string;
  descripcion: string;
  accion: ReactNode;
}) {
  return (
    <SurfaceCard className="flex flex-col p-5" noPadding>
      <div className="flex items-center gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          {icono}
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{titulo}</h3>
          <p className="text-xs text-muted-foreground">{formato}</p>
        </div>
      </div>
      <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">{descripcion}</p>
      <div className="mt-4">{accion}</div>
    </SurfaceCard>
  );
}
