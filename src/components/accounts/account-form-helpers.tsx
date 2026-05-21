'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { Search, X, Check } from 'lucide-react';
import { Label } from '@/components/ui/label';
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
            className="rounded-xl border border-border bg-popover shadow-lg"
          >
            <div className="max-h-52 overflow-y-auto py-1">
              {filtered.map((ind) => (
                <button
                  key={ind}
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-accent',
                    value === ind && 'bg-su-brand-soft text-su-brand font-medium',
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
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
      <input
        ref={inputRef}
        className={cn(
          'h-8 w-full rounded-lg border border-input bg-transparent py-1 pl-8 pr-7 text-sm outline-none',
          'placeholder:text-muted-foreground/60 transition-colors',
          'focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
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
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/40 transition-colors hover:text-foreground"
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
  icon: Icon,
  label,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40" />}
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/50">
          {label}
        </span>
        <div className="h-px flex-1 bg-border/40" />
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

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
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs font-medium text-foreground/70">
        {label}
        {required && <span className="ml-0.5 text-destructive/80">*</span>}
      </Label>
      {children}
    </div>
  );
}

export function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

export function getFlagEmoji(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1e6 - 65))
    .join('');
}
