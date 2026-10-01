'use client';

import * as React from 'react';
import { FieldLabel } from '@/components/forms/field';

/**
 * PENDIENTE DE RETIRAR. Los formularios de empresas, contactos y lotes ya usan
 * `Field` de `@/components/forms/field` y `DrawerSection`. `Field` y `Row` se
 * quedan exportados solo porque los siguen importando tres archivos que esta
 * ronda no podía tocar: `generate-ai-batch-drawer.tsx`, `lusha-preview-drawer.tsx`
 * y `exploratory-search-form-v2.tsx`. Cuando esos pasen al `Field` del sistema,
 * aquí solo queda `getFlagEmoji`.
 */
export function Field({
  id,
  label,
  required,
  children,
}: {
  id?: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <FieldLabel htmlFor={id} className="block leading-none">
        {label}
        {required && (
          <span className="ml-1 text-destructive" aria-hidden="true">
            *
          </span>
        )}
      </FieldLabel>
      {children}
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>;
}

export function getFlagEmoji(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1e6 - 65))
    .join('');
}
