import * as React from "react";
import { cn } from "@/lib/utils";

interface FieldProps extends React.HTMLAttributes<HTMLDivElement> {
  label?: string;
  description?: string;
  error?: string;
  required?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}

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
  const id = React.useId();
  const descriptionId = `${id}-description`;
  const errorId = `${id}-error`;

  return (
    <div className={cn("space-y-1.5 w-full", className)} {...props}>
      {label && (
        <div className="flex items-center justify-between">
          <label
            htmlFor={id}
            className={cn(
              "text-sm font-bold text-foreground leading-none",
              disabled && "opacity-70 cursor-not-allowed"
            )}
          >
            {label}
            {required && (
              <span className="text-destructive ml-1" aria-hidden="true">
                *
              </span>
            )}
          </label>
        </div>
      )}

      <div className="relative">
        {React.Children.map(children, (child) => {
          if (React.isValidElement(child)) {
            const childProps = child.props as Record<string, unknown>;
            const existingDescribedBy = childProps["aria-describedby"] as string | undefined;
            return React.cloneElement(child as React.ReactElement<Record<string, unknown>>, {
              id: (childProps.id as string) || id,
              disabled: (childProps.disabled as boolean) || disabled,
              "aria-describedby": cn(
                existingDescribedBy,
                description && descriptionId,
                error && errorId
              ) || undefined,
            });
          }
          return child;
        })}
      </div>

      {description && !error && (
        <p
          id={descriptionId}
          className="text-sm text-muted-foreground leading-relaxed"
        >
          {description}
        </p>
      )}

      {error && (
        <p
          id={errorId}
          className="text-sm font-medium text-destructive animate-in fade-in slide-in-from-top-1 duration-200"
        >
          {error}
        </p>
      )}
    </div>
  );
}

export function FieldLabel({
  children,
  className,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label className={cn("text-sm font-bold text-foreground", className)} {...props}>
      {children}
    </label>
  );
}

export function FieldDescription({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)} {...props}>
      {children}
    </p>
  );
}

export function FieldError({
  children,
  className,
  ...props
}: React.HTMLAttributes<HTMLParagraphElement>) {
  return (
    <p className={cn("text-sm font-medium text-destructive", className)} {...props}>
      {children}
    </p>
  );
}