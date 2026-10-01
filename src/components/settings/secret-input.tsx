'use client';

import * as React from 'react';

import { Eye, EyeOff } from '@/icons';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface SecretInputProps
  extends Omit<React.ComponentProps<typeof Input>, 'type' | 'value' | 'onChange'> {
  value: string;
  onValueChange: (value: string) => void;
  /**
   * Cómo se llama lo que se escribe, para el botón del ojo: «Mostrar token»,
   * «Ocultar API Key». Va tal cual detrás del verbo.
   */
  secretName: string;
}

/**
 * SecretInput — el campo de una credencial (token, API Key, secreto).
 *
 * Es un `Input` que nace oculto y lleva a la derecha el botón del ojo para
 * verlo mientras se pega. Recibe `id`, `disabled` y `aria-describedby` como un
 * `Input` cualquiera, así que va directo dentro de `Field`:
 *
 * @example
 * <Field label="Access token" description="Lo generas en HubSpot → Private Apps.">
 *   <SecretInput value={token} onValueChange={setToken} secretName="token" />
 * </Field>
 */
export function SecretInput({
  value,
  onValueChange,
  secretName,
  className,
  disabled,
  ...props
}: SecretInputProps) {
  const [isVisible, setIsVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        {...props}
        type={isVisible ? 'text' : 'password'}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        disabled={disabled}
        autoComplete="off"
        className={cn('pr-10 font-mono', className)}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        onClick={() => setIsVisible((current) => !current)}
        aria-label={`${isVisible ? 'Ocultar' : 'Mostrar'} ${secretName}`}
      >
        {isVisible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </Button>
    </div>
  );
}
