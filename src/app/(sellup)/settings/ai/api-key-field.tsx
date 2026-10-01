'use client';

import { useState } from 'react';
import { Eye, EyeOff } from '@/icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FieldDescription, FieldLabel } from '@/components/forms/field';

interface ApiKeyFieldProps {
  id: string;
  label: string;
  placeholder: string;
  /** Ayuda bajo el campo; queda enlazada al control. */
  description?: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter dentro del campo: guardar sin ir al botón. */
  onSubmit?: () => void;
}

/**
 * El campo de una API key: oculto por defecto, con el botón de ojo para
 * revisarla antes de guardar. Vuelve a ocultarse cada vez que se monta.
 */
export function ApiKeyField({ id, label, placeholder, description, value, onChange, onSubmit }: ApiKeyFieldProps) {
  const [isVisible, setIsVisible] = useState(false);
  const descriptionId = `${id}-description`;

  return (
    <div className="w-full space-y-1.5">
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <div className="relative">
        <Input
          id={id}
          type={isVisible ? 'text' : 'password'}
          placeholder={placeholder}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onSubmit?.();
          }}
          autoComplete="off"
          aria-describedby={description ? descriptionId : undefined}
          className="pr-10 font-mono"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? 'Ocultar API key' : 'Mostrar API key'}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground"
        >
          {isVisible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </Button>
      </div>
      {description && <FieldDescription id={descriptionId}>{description}</FieldDescription>}
    </div>
  );
}
