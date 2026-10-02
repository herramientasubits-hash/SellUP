import * as React from "react";
import { Database } from "@/icons";

import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Heading } from "@/components/typography";

export interface TableShellProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  /**
   * El título de la lista. Acepta un nodo, no solo texto, para lo que suele
   * ir pegado a él: el total en un `Badge`, una insignia de estado.
   */
  title?: React.ReactNode;
  description?: string;
  /** Buscador, filtros, configuración de columnas: lo que opera la lista. */
  actions?: React.ReactNode;
  children: React.ReactNode;
  empty?: boolean;
  emptyState?: React.ReactNode;
  stickyHeader?: boolean;
  /**
   * Dónde pinta el marco. `card` lo pone en todo: fondo y borde alrededor de
   * la tabla. `header` los deja solo en la barra de título y descarga el
   * cuerpo, para cuando las filas ya traen su propio borde —una lista de
   * tarjetas— y encerrarlas otra vez sería una caja dentro de otra.
   */
  surface?: "card" | "header";
  /**
   * El pie del marco: paginación, el resumen de «x de y», una acción de
   * cierre. Va dentro de la tarjeta y separado por su propia línea, para que
   * la paginación no quede flotando fuera de la lista a la que pertenece.
   */
  footer?: React.ReactNode;
}

/**
 * TableShell
 *
 * El marco de una lista: una sola superficie que sostiene la barra de título
 * y acciones, la tabla y su pie.
 *
 * La tabla va a sangre dentro del marco (el cuerpo no lleva padding) y lo que
 * se alinea con el título es el **texto** de la primera columna, no la caja:
 * así las líneas que separan las filas cruzan la tarjeta de lado a lado —como
 * en una lista de verdad— y las columnas siguen empezando donde empieza el
 * título. Nunca una caja con borde dentro de otra: el marco ya es el borde.
 *
 * Es el marco para tablas estáticas o de solo lectura (`Table` de
 * `@/components/ui/table`). Una lista operable —orden, filtros, selección—
 * sigue siendo `DataTable`, que ya trae su propia barra y su pie.
 *
 * @example
 * <TableShell
 *   title={<>Lotes recientes <Badge variant="neutral">{batches.length}</Badge></>}
 *   description="Importaciones de las últimas dos semanas."
 *   actions={<Button size="sm">Nuevo lote</Button>}
 *   empty={batches.length === 0}
 *   footer={<Text variant="caption">{batches.length} lotes</Text>}
 * >
 *   <Table>…</Table>
 * </TableShell>
 */
export function TableShell({
  title,
  description,
  actions,
  children,
  empty = false,
  emptyState,
  stickyHeader = false,
  surface = "card",
  footer,
  className,
  ...props
}: TableShellProps) {
  const hasHeader = Boolean(title || description || actions);
  const isHeaderOnly = surface === "header";

  return (
    <Card
      data-slot="table-shell"
      data-surface={surface}
      className={cn(
        // La `Card` de SellUp trae su propio padding y separación: aquí se
        // anulan porque la tabla va a sangre. El radio se queda aunque el
        // marco se descargue: `overflow-hidden` lo recorta sobre la cabecera,
        // que es la que sigue teniendo superficie.
        "gap-0 overflow-hidden p-0",
        isHeaderOnly && "border-transparent bg-transparent shadow-none",
        className,
      )}
      {...props}
    >
      {hasHeader && (
        <div
          data-slot="table-shell-header"
          className={cn(
            "flex flex-row flex-wrap items-center justify-between gap-2 border-b border-border/60 px-6 py-4",
            isHeaderOnly && "bg-card",
          )}
        >
          <div className="flex min-w-0 flex-col gap-1">
            {/*
              Encabezado de verdad, no una `CardTitle` (que es un `div`): el
              título de una lista es la cabecera de su sección, y quien navega
              por encabezados tiene que poder saltar a ella. `h2` porque el
              h1 de la pantalla es su `PageHeader`.
            */}
            {title && (
              <Heading level={6} as="h2" className="flex items-center gap-2">
                {title}
              </Heading>
            )}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}

      <div data-slot="table-shell-body">
        {empty ? (
          emptyState ?? (
            <EmptyState
              variant="plain"
              icon={Database}
              title="Sin información"
              description="No se encontraron registros para mostrar en esta tabla."
            />
          )
        ) : (
          <div
            className={cn(
              "relative w-full overflow-x-auto",
              // El texto de los bordes se alinea con el título; la línea de
              // cada fila sigue cruzando la tarjeta completa.
              "[&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6",
              stickyHeader && "[&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-card",
            )}
          >
            {children}
          </div>
        )}
      </div>

      {footer && (
        <div
          data-slot="table-shell-footer"
          className="flex flex-wrap items-center gap-2 border-t border-border/60 px-6 py-3"
        >
          {footer}
        </div>
      )}
    </Card>
  );
}
