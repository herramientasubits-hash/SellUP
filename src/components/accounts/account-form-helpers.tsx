'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check, type LucideIcon } from 'lucide-react';
import { DrawerSection } from '@/components/shared/drawer-section';
import { FieldLabel } from '@/components/forms/field';
import { cn } from '@/lib/utils';
import { INDUSTRIES } from '@/modules/accounts/types';

export function IndustryCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // SSR-safe mount detection — avoids setState-in-effect lint rule
  const mounted = React.useSyncExternalStore(
    (cb) => { cb(); return () => {}; },
    () => true,
    () => false,
  );

  const displayValue = open ? query : value;
  const filtered = INDUSTRIES.filter((i) => i.toLowerCase().includes(query.toLowerCase()));

  function updateRect() {
    if (wrapperRef.current) setRect(wrapperRef.current.getBoundingClientRect());
  }

  function openDropdown() {
    updateRect();
    setQuery('');
    setOpen(true);
  }

  function closeDropdown() {
    setTimeout(() => {
      setOpen(false);
      setQuery('');
    }, 100);
  }

  function select(industry: string) {
    onChange(industry);
    setOpen(false);
    setQuery('');
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange('');
    setQuery('');
    inputRef.current?.focus();
  }

  React.useEffect(() => {
    if (!open) return;
    const onScroll = () => updateRect();
    window.addEventListener('scroll', onScroll, true);
    return () => window.removeEventListener('scroll', onScroll, true);
  }, [open]);

  const dropdown =
    mounted && open && rect && filtered.length > 0
      ? createPortal(
          <div
            style={{
              position: 'fixed',
              top: rect.bottom + 2,
              left: rect.left,
              width: rect.width,
              zIndex: 9999,
            }}
            className="rounded-xl border border-border bg-popover shadow-drawer"
          >
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-muted',
                    value === ind && 'bg-primary/10 text-primary font-medium',
                  )}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    select(ind);
                  }}
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                    {value === ind && <Check className="h-3.5 w-3.5" />}
                  </span>
                  {ind}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={wrapperRef} className="relative">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
      <input
        ref={inputRef}
        className={cn(
          'h-10 w-full rounded-md border border-input bg-card py-1 pl-8 pr-8 text-sm outline-none dark:bg-muted',
          'placeholder:text-muted-foreground transition-colors',
          'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/40',
        )}
        placeholder={value || 'Buscar industria…'}
        value={displayValue}
        onChange={(e) => {
          setQuery(e.target.value);
          if (!open) openDropdown();
          if (value) onChange('');
        }}
        onFocus={openDropdown}
        onBlur={closeDropdown}
      />
      {(value || query) && (
        <button
          type="button"
          tabIndex={-1}
          aria-label="Limpiar industria"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-sm text-text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          onMouseDown={clear}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      )}
      {dropdown}
    </div>
  );
}

export function Section({
  icon,
  label,
  children,
}: {
  icon?: LucideIcon;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <DrawerSection title={label} icon={icon} contentClassName="space-y-4">
      {children}
    </DrawerSection>
  );
}

/**
 * Campo de los drawers de empresa: la etiqueta del sistema (`FieldLabel`)
 * enlazada por `id` al control. No se usa `Field` de `@/components/forms/field`
 * porque estos controles traen su propio `id` (o son un `Select`/combobox que
 * no admite que se le inyecte uno).
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
