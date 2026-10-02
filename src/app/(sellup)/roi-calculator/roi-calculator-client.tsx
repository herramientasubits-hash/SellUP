'use client';

/**
 * Calculadora de ROI · proyección de venta.
 *
 * Dos pestañas y nada más: los datos del prospecto y el reporte. Los supuestos
 * del modelo viven en un panel lateral y los entregables son tarjetas del
 * reporte.
 */

import { FileText, LayoutDashboard, RotateCcw, Settings2, SlidersHorizontal } from '@/icons';
import { PageHeader } from '@/components/shared/page-header';
import { PageShell } from '@/components/layout/page-shell';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { FormularioProyeccion } from '@/components/roi-calculator/formulario-proyeccion';
import { PanelExports } from '@/components/roi-calculator/panel-exports';
import { PanelParametros } from '@/components/roi-calculator/panel-parametros';
import { PanelResultados } from '@/components/roi-calculator/panel-resultados';
import {
  useHidratarROI,
  useResultado,
  useROIStore,
  useTieneDatos,
  type VistaROI,
} from '@/modules/roi-calculator/store';

export function RoiCalculatorClient({ canEditParams }: { canEditParams: boolean }) {
  const hidratado = useHidratarROI();
  const vista = useROIStore((s) => s.vista);
  const setVista = useROIStore((s) => s.setVista);
  const cargarEjemplo = useROIStore((s) => s.cargarEjemplo);
  const limpiar = useROIStore((s) => s.limpiar);

  return (
    // `min-h-auto`: es una página que crece con su contenido, no una que llena
    // el alto. Con el `min-h-0` de PageShell se encogía al alto de la ventana y
    // el reporte la desbordaba, sin aire debajo de la última tarjeta.
    <PageShell className="min-h-auto">
      <PageHeader
        title="Calculadora de ROI"
        description="Proyección del valor que va a tener un prospecto durante la venta: lo que se cotiza, a precio de mercado, sobre lo que invierte."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={cargarEjemplo}>
              <FileText />
              Cargar ejemplo
            </Button>
            <Button variant="ghost" size="sm" onClick={limpiar}>
              <RotateCcw />
              Limpiar
            </Button>
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="outline" size="sm">
                    <Settings2 />
                    Parámetros
                  </Button>
                }
              />
              <SheetContent side="right" className="gap-0 p-0 data-[side=right]:sm:max-w-xl">
                <SheetHeader className="border-b border-border/60">
                  <SheetTitle>Parámetros del modelo</SheetTitle>
                  <SheetDescription>
                    {canEditParams
                      ? 'Cada supuesto con su fuente. Se guardan en este navegador y recalculan el reporte al instante.'
                      : 'Cada supuesto con su fuente. Solo los administradores pueden editarlos.'}
                  </SheetDescription>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  <PanelParametros editable={canEditParams} />
                </div>
              </SheetContent>
            </Sheet>
          </>
        }
      />

      {hidratado ? (
        <Tabs value={vista} onValueChange={(v) => setVista(v as VistaROI)}>
          <TabsList aria-label="Qué ver" className="mb-5">
            <TabsTrigger value="datos">
              <SlidersHorizontal />
              Datos del prospecto
            </TabsTrigger>
            <TabsTrigger value="reporte">
              <LayoutDashboard />
              Reporte
            </TabsTrigger>
          </TabsList>

          <TabsContent value="datos">
            <FormularioProyeccion />
          </TabsContent>

          <TabsContent value="reporte">
            <Reporte />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="grid gap-5" aria-busy="true">
          <Skeleton className="h-9 w-72 rounded-md" />
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-64 w-full rounded-2xl" />
        </div>
      )}
    </PageShell>
  );
}

function Reporte() {
  const resultado = useResultado();
  const tieneDatos = useTieneDatos();
  const setVista = useROIStore((s) => s.setVista);

  if (!tieneDatos) {
    return (
      <Alert variant="info">
        <AlertTitle>Falta el mínimo para calcular</AlertTitle>
        <AlertDescription>
          Indica al menos la población con acceso y la inversión anual del prospecto.
        </AlertDescription>
        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={() => setVista('datos')}>
            <SlidersHorizontal />
            Ir a los datos del prospecto
          </Button>
        </div>
      </Alert>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <PanelResultados resultado={resultado} />
      <PanelExports resultado={resultado} />
    </div>
  );
}
