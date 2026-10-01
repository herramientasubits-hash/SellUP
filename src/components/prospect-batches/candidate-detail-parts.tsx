'use client';

import * as React from 'react';
import { Copy } from '@/icons';
import { Button } from '@/components/ui/button';
import { DetailItem, DetailList } from '@/components/shared/detail-list';

interface FieldProps {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
}

/** Un par etiqueta/valor de la ficha: `DetailItem` con el valor por prop. */
export function Field({ label, value, mono }: FieldProps) {
  return (
    <DetailItem label={label}>
      {mono && value !== null && value !== undefined && value !== '' ? (
        <span className="font-mono">{value}</span>
      ) : (
        value
      )}
    </DetailItem>
  );
}

/** Los pares de una sección: dos columnas que colapsan a una en móvil. */
export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <DetailList className="gap-x-4 gap-y-3">{children}</DetailList>;
}

export function MissingText({ text }: { text: string }) {
  return <span className="text-text-muted italic">{text}</span>;
}

export function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = React.useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <Button
      variant="ghost"
      size="xs"
      className="px-1.5 text-muted-foreground hover:text-muted-foreground ml-1.5 gap-1 shrink-0 inline-flex items-center"
      onClick={handleCopy}
      type="button"
    >
      {copied ? (
        <span className="text-success font-medium">¡Copiado!</span>
      ) : (
        <>
          <Copy className="h-2.5 w-2.5" />
          <span>Copiar</span>
        </>
      )}
    </Button>
  );
}
