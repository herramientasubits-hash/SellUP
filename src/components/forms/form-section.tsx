import * as React from "react";

import { cn } from "@/lib/utils";

export interface FormSectionProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string;
  description?: string;
  /** Acciones de la sección, a la derecha del título (un «Editar», un «Restablecer»). */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * FormSection
 *
 * Un bloque de formulario: una card con su título, su descripción y sus
 * acciones, y debajo los campos separados con el ritmo del sistema. Agrupa
 * los `Field` que se deciden juntos, para que un formulario largo se lea por
 * secciones y no como una sola columna de controles.
 *
 * @example
 * <FormSection title="Datos fiscales" description="Se usan para validar la empresa.">
 *   <Field label="NIT"><Input name="nit" /></Field>
 *   <Field label="Razón social"><Input name="legalName" /></Field>
 * </FormSection>
 */
export function FormSection({
  title,
  description,
  actions,
  children,
  className,
  ...props
}: FormSectionProps) {
  const hasHeader = Boolean(title || description || actions);

  return (
    // El marco de UBITS: el título de la sección en la franja gris y los campos en el panel.
    <div
      data-slot="form-section"
      className={cn(
        "flex min-w-0 flex-col gap-0.75 rounded-2xl border border-border bg-frame p-0.75 text-card-foreground",
        className,
      )}
      {...props}
    >
      {hasHeader && (
        <div className="flex flex-row flex-wrap items-center justify-between gap-2 px-3 pt-2 pb-1.5">
          <div className="min-w-0 space-y-0.5">
            {title && <h3 className="text-sm font-medium text-foreground">{title}</h3>}
            {description && <p className="text-sm text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className="min-w-0 space-y-6 rounded-xl border border-border bg-card bg-clip-padding p-5 shadow-card">
        {children}
      </div>
    </div>
  );
}
