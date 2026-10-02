import * as React from "react";

import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";

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
    <Card data-slot="form-section" className={className} {...props}>
      {hasHeader && (
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="min-w-0 space-y-1">
            {title && <CardTitle className="text-base font-semibold text-foreground">{title}</CardTitle>}
            {description && <CardDescription>{description}</CardDescription>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </CardHeader>
      )}
      <CardContent className="space-y-6">{children}</CardContent>
    </Card>
  );
}
