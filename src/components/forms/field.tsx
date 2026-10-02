import * as React from "react";

import { cn } from "@/lib/utils";

export interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  /** Ayuda bajo el control (texto o texto con formato). Se oculta mientras haya `error`. */
  description?: React.ReactNode;
  /** Mensaje de validación. Sustituye a la descripción y se enlaza al control. */
  error?: string;
  required?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

/** Lo que `Field` inyecta en el control que envuelve. */
interface FieldControlProps {
  id?: string;
  disabled?: boolean;
  "aria-describedby"?: string;
}

/**
 * Field
 *
 * El envoltorio de un control de formulario: etiqueta arriba, control, y debajo
 * la ayuda o el error. Clona al hijo para darle el `id` que enlaza con la
 * etiqueta y el `aria-describedby` que enlaza con la ayuda o el error, de modo
 * que la pantalla no tenga que cablear esos ids a mano. Si el hijo ya trae su
 * propio `id` o `aria-describedby`, se respetan.
 *
 * @example
 * <Field label="NIT" description="Sin dígito de verificación." error={errors.nit} required>
 *   <Input name="nit" />
 * </Field>
 */
export function Field({
  label,
  description,
  error,
  required,
  disabled,
  className,
  children,
  ...props
}: FieldProps) {
  const generatedId = React.useId();
  // Si el control ya trae su `id`, la etiqueta apunta a ese: generar otro la
  // dejaría sin asociar.
  const childId = React.Children.toArray(children)
    .map((child) =>
      React.isValidElement<{ id?: string }>(child) ? child.props.id : undefined,
    )
    .find((value): value is string => typeof value === "string" && value.length > 0);
  const id = childId ?? generatedId;
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <div data-slot="field" className={cn("w-full space-y-1.5", className)} {...props}>
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className={cn(
              "text-sm leading-none font-medium text-foreground",
              disabled && "cursor-not-allowed opacity-70",
            )}
          >
            {label}
            {required && (
              <span className="ml-1 text-destructive" aria-hidden="true">
                *
              </span>
            )}
          </label>
        </div>
      )}

      <div className="relative">
        {/* Se inyecta el id en el hijo si es un elemento válido y no trae uno. */}
        {React.Children.map(children, (child) => {
          if (!React.isValidElement<FieldControlProps>(child)) return child;
          const describedBy = cn(
            child.props["aria-describedby"],
            description && !error && descriptionId,
            error && errorId,
          );
          return React.cloneElement(child, {
            id: child.props.id || id,
            disabled: child.props.disabled || disabled,
            "aria-describedby": describedBy || undefined,
          });
        })}
      </div>

      {description && !error && (
        <FieldDescription id={descriptionId} className="leading-relaxed">
          {description}
        </FieldDescription>
      )}

      {error && (
        <FieldError id={errorId} className="animate-su-fade-in motion-reduce:animate-none">
          {error}
        </FieldError>
      )}
    </div>
  );
}

/** Etiqueta suelta, para un control que no pasa por `Field`. */
export function FieldLabel({
  children,
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("text-sm font-medium text-foreground", className)} {...props}>
      {children}
    </label>
  );
}

/** Texto de ayuda bajo un control. */
export function FieldDescription({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs text-muted-foreground", className)} {...props}>
      {children}
    </p>
  );
}

/** Mensaje de validación bajo un control. */
export function FieldError({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-xs font-medium text-destructive", className)} {...props}>
      {children}
    </p>
  );
}
