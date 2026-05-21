'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Loader2,
  Building2,
  Search,
  X,
  Check,
  Globe,
  MapPin,
  Briefcase,
  Hash,
  User,
  FileText,
} from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { createAccount } from '@/modules/accounts/actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  COMPANY_SIZES,
  TAX_IDENTIFIER_TYPE_LABELS,
  type TaxIdentifierType,
  type InternalUserOption,
} from '@/modules/accounts/types';

// ── Combobox con portal (evita clipping del overflow-y-auto) ──

function IndustryCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [query, setQuery] = React.useState('');
  const [open, setOpen] = React.useState(false);
  const [rect, setRect] = React.useState<DOMRect | null>(null);
  const [mounted, setMounted] = React.useState(false);
  const wrapperRef = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setMounted(true), []);

  const displayValue = open ? query : value;
  const filtered = INDUSTRIES.filter((i) =>
    i.toLowerCase().includes(query.toLowerCase()),
  );

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

  // Reposicionar al hacer scroll
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

// ── Helpers de layout ─────────────────────────────────────────

function Section({
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

function Field({
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

function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-4">{children}</div>;
}

function getFlagEmoji(code: string): string {
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) + 0x1f1e6 - 65))
    .join('');
}

// ── Drawer principal ──────────────────────────────────────────

interface CreateAccountDrawerProps {
  users: InternalUserOption[];
}

const EMPTY_FORM = {
  name: '',
  legal_name: '',
  website: '',
  country_code: '',
  city: '',
  region: '',
  industry: '',
  company_size: '',
  tax_identifier: '',
  tax_identifier_type: '' as TaxIdentifierType | '',
  owner_id: '',
  notes: '',
};

export function CreateAccountDrawer({ users }: CreateAccountDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  function handleClose() {
    setOpen(false);
    setError(null);
    setForm(EMPTY_FORM);
  }

  const selectedCountry = LATAM_COUNTRIES.find((c) => c.code === form.country_code);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.name.trim()) {
      setError('El nombre de la empresa es requerido');
      return;
    }
    setPending(true);
    try {
      const result = await createAccount({
        name: form.name,
        legal_name: form.legal_name || undefined,
        website: form.website || undefined,
        country: selectedCountry?.name,
        country_code: form.country_code || undefined,
        city: form.city || undefined,
        region: form.region || undefined,
        industry: form.industry || undefined,
        company_size: form.company_size || undefined,
        tax_identifier: form.tax_identifier || undefined,
        tax_identifier_type: (form.tax_identifier_type as TaxIdentifierType) || undefined,
        owner_id: form.owner_id || undefined,
        notes: form.notes || undefined,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      handleClose();
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} size="sm">
        <Plus className="h-4 w-4" />
        Crear cuenta
      </Button>

      <Sheet open={open} onOpenChange={(v) => !v && handleClose()}>
        <SheetContent className="flex flex-col gap-0 overflow-hidden sm:max-w-[600px]">
          {/* ── Header ── */}
          <SheetHeader className="shrink-0 border-b border-border/50 px-7 pb-5 pt-6">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-su-brand-soft">
                <Building2 className="h-4 w-4 text-su-brand" />
              </div>
              <div className="space-y-0.5">
                <SheetTitle className="text-base font-semibold">Nueva cuenta</SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground/70">
                  Registra una empresa o prospecto. Podrás enriquecerla con IA más adelante.
                </SheetDescription>
              </div>
            </div>
          </SheetHeader>

          {/* ── Cuerpo scrollable ── */}
          <form
            id="create-account-form"
            onSubmit={handleSubmit}
            className="flex-1 space-y-8 overflow-y-auto px-7 py-6"
          >
            {/* Identificación */}
            <Section icon={Building2} label="Identificación">
              <Field id="name" label="Nombre de empresa / prospecto" required>
                <Input
                  id="name"
                  placeholder="Ej. Bancolombia, Rappi, Nubank…"
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  autoFocus
                />
              </Field>
              <Row>
                <Field id="legal_name" label="Razón social">
                  <Input
                    id="legal_name"
                    placeholder="Nombre legal registrado"
                    value={form.legal_name}
                    onChange={(e) => set('legal_name', e.target.value)}
                  />
                </Field>
                <Field id="website" label="Sitio web">
                  <div className="relative">
                    <Globe className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/40" />
                    <Input
                      id="website"
                      type="url"
                      placeholder="https://ejemplo.com"
                      value={form.website}
                      onChange={(e) => set('website', e.target.value)}
                      className="pl-8"
                    />
                  </div>
                </Field>
              </Row>
            </Section>

            {/* Empresa */}
            <Section icon={Briefcase} label="Empresa">
              <Row>
                <Field label="Industria">
                  <IndustryCombobox
                    value={form.industry}
                    onChange={(v) => set('industry', v)}
                  />
                </Field>
                <Field label="Tamaño de empresa">
                  <Select
                    value={form.company_size}
                    onValueChange={(v) => set('company_size', v ?? '')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Número de empleados" />
                    </SelectTrigger>
                    <SelectContent>
                      {COMPANY_SIZES.map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              </Row>
            </Section>

            {/* Ubicación */}
            <Section icon={MapPin} label="Ubicación">
              <Row>
                <Field label="País">
                  <Select
                    value={form.country_code}
                    onValueChange={(v) => set('country_code', v ?? '')}
                  >
                    <SelectTrigger>
                      {form.country_code ? (
                        <span className="flex items-center gap-2 text-sm">
                          <span className="text-base leading-none">
                            {getFlagEmoji(form.country_code)}
                          </span>
                          <span>{selectedCountry?.name}</span>
                        </span>
                      ) : (
                        <SelectValue placeholder="Seleccionar país" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {LATAM_COUNTRIES.map((c) => (
                        <SelectItem key={c.code} value={c.code}>
                          <span className="flex items-center gap-2">
                            <span className="text-base leading-none">
                              {getFlagEmoji(c.code)}
                            </span>
                            <span>{c.name}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="city" label="Ciudad">
                  <Input
                    id="city"
                    placeholder="Bogotá, CDMX, São Paulo…"
                    value={form.city}
                    onChange={(e) => set('city', e.target.value)}
                  />
                </Field>
              </Row>
              <Field id="region" label="Departamento / Estado / Provincia">
                <Input
                  id="region"
                  placeholder="Cundinamarca, Jalisco, São Paulo…"
                  value={form.region}
                  onChange={(e) => set('region', e.target.value)}
                />
              </Field>
            </Section>

            {/* Identificación fiscal */}
            <Section icon={Hash} label="Identificación fiscal">
              <Row>
                <Field label="Tipo de identificador">
                  <Select
                    value={form.tax_identifier_type}
                    onValueChange={(v) => set('tax_identifier_type', v ?? '')}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="NIT, RFC, RUT…" />
                    </SelectTrigger>
                    <SelectContent>
                      {(
                        Object.entries(TAX_IDENTIFIER_TYPE_LABELS) as [
                          TaxIdentifierType,
                          string,
                        ][]
                      ).map(([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field id="tax_id_number" label="Número">
                  <Input
                    id="tax_id_number"
                    placeholder={
                      form.tax_identifier_type === 'NIT'
                        ? '890.903.938-8'
                        : form.tax_identifier_type === 'RFC'
                          ? 'XAXX010101000'
                          : form.tax_identifier_type === 'CNPJ'
                            ? '00.000.000/0001-00'
                            : 'Número de identificación'
                    }
                    value={form.tax_identifier}
                    onChange={(e) => set('tax_identifier', e.target.value)}
                  />
                </Field>
              </Row>
            </Section>

            {/* Asignación */}
            <Section icon={User} label="Asignación">
              {users.length > 0 && (
                <Field label="Owner / Responsable">
                  <Select
                    value={form.owner_id}
                    onValueChange={(v) => set('owner_id', v ?? '')}
                  >
                    <SelectTrigger>
                      {form.owner_id ? (
                        <span className="flex items-center gap-2 text-sm">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-su-brand-soft text-[10px] font-semibold text-su-brand">
                            {(
                              users.find((u) => u.id === form.owner_id)?.full_name ?? 'U'
                            )
                              .charAt(0)
                              .toUpperCase()}
                          </span>
                          <span>
                            {users.find((u) => u.id === form.owner_id)?.full_name ??
                              users.find((u) => u.id === form.owner_id)?.email}
                          </span>
                        </span>
                      ) : (
                        <SelectValue placeholder="Sin asignar" />
                      )}
                    </SelectTrigger>
                    <SelectContent>
                      {users.map((u) => (
                        <SelectItem key={u.id} value={u.id}>
                          <span className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-[10px] font-semibold">
                              {(u.full_name ?? u.email).charAt(0).toUpperCase()}
                            </span>
                            <span>{u.full_name ?? u.email}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
              <Field id="notes" label="Notas iniciales">
                <div className="relative">
                  <FileText className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground/40" />
                  <Textarea
                    id="notes"
                    placeholder="Contexto, señales de compra, próximos pasos…"
                    value={form.notes}
                    onChange={(e) => set('notes', e.target.value)}
                    rows={3}
                    className="pl-8 pt-2 text-sm"
                  />
                </div>
              </Field>
            </Section>
          </form>

          {/* ── Footer sticky ── */}
          <SheetFooter className="shrink-0 flex-row items-center justify-between gap-3 border-t border-border/50 px-7 py-4">
            {error ? (
              <p className="flex-1 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs text-destructive">
                {error}
              </p>
            ) : (
              <p className="flex-1 text-[11px] text-muted-foreground/50">
                Estado inicial:{' '}
                <span className="font-medium text-muted-foreground">Nueva</span>
                {' · '}Fuente:{' '}
                <span className="font-medium text-muted-foreground">Manual</span>
              </p>
            )}
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClose}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button
                type="submit"
                form="create-account-form"
                size="sm"
                disabled={pending || !form.name.trim()}
              >
                {pending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Guardando…
                  </>
                ) : (
                  'Guardar cuenta'
                )}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  );
}
