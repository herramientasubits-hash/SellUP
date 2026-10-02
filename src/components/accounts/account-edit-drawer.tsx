'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import {
  Loader2,
  Building2,
  Briefcase,
  Hash,
  MapPin,
  User,
} from "@/icons";
import { DrawerShell } from '@/components/shared/drawer-shell';
import { SurfaceCard } from '@/components/shared/surface-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { getAccountById, updateAccount } from '@/modules/accounts/actions';
import {
  LATAM_COUNTRIES,
  COMPANY_SIZES,
  TAX_IDENTIFIER_TYPE_LABELS,
  type TaxIdentifierType,
  type InternalUserOption,
} from '@/modules/accounts/types';
import { Field } from '@/components/forms/field';
import { DrawerSection } from '@/components/shared/drawer-section';
import { SearchableSelect } from '@/components/forms/searchable-select';
import { getFlagEmoji } from './account-form-helpers';
import { buildIndustryOptions } from './industry-options';

interface AccountEditDrawerProps {
  accountId: string;
  users: InternalUserOption[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

export function AccountEditDrawer({
  accountId,
  users,
  open,
  onOpenChange,
}: AccountEditDrawerProps) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  React.useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const account = await getAccountById(accountId);
        if (cancelled) return;
        if (!account) {
          setError('No encontramos esta empresa.');
          return;
        }
        setForm({
          name: account.name ?? '',
          legal_name: account.legal_name ?? '',
          website: account.website ?? '',
          country_code: account.country_code ?? '',
          city: account.city ?? '',
          region: account.region ?? '',
          industry: account.industry ?? '',
          company_size: account.company_size ?? '',
          tax_identifier: account.tax_identifier ?? '',
          tax_identifier_type: (account.tax_identifier_type as TaxIdentifierType) ?? '',
          owner_id: account.owner_id ?? '',
          notes: account.notes ?? '',
        });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; };
  }, [open, accountId]);

  function handleClose() {
    onOpenChange(false);
    setError(null);
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
      const result = await updateAccount(accountId, {
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
      toast.success('Empresa actualizada');
    } finally {
      setPending(false);
    }
  }

  return (
    <DrawerShell
      open={open}
      onOpenChange={(v) => !v && handleClose()}
      title="Editar empresa"
      description="Modifica los datos de la empresa. Los cambios quedan registrados en auditoría."
      icon={<Building2 className="h-4 w-4" />}
      size="xl"
      actions={
        <>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleClose}
            disabled={pending}
          >
            Cancelar
          </Button>
          {error && (
            <p role="alert" className="min-w-0 flex-1 rounded-lg bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive">
              {error}
            </p>
          )}
          <Button
            type="submit"
            form="edit-account-form"
            size="sm"
            disabled={pending || loading || !form.name.trim()}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Guardando…
              </>
            ) : (
              'Guardar cambios'
            )}
          </Button>
        </>
      }
    >
      {/* ── Loading skeleton ── */}
      {loading ? (
        <div className="space-y-4" aria-busy="true">
          {Array.from({ length: 3 }).map((_, i) => (
            <SurfaceCard key={i} className="space-y-6">
              <Skeleton className="h-5 w-28" />
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-10 w-full" />
                </div>
                <div className="space-y-1.5">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="h-10 w-full" />
                </div>
              </div>
            </SurfaceCard>
          ))}
        </div>
      ) : (
        /* ── Form ── */
        <form
          id="edit-account-form"
          onSubmit={handleSubmit}
          className="space-y-4"
        >
          {/* Identificación */}
          <DrawerSection title="Identificación" icon={Building2} contentClassName="space-y-4">
            <Field label="Nombre de empresa / prospecto" required>
              <Input
                id="edit-name"
                placeholder="Ej. Bancolombia, Rappi, Nubank…"
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                autoFocus
              />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Razón social">
                <Input
                  id="edit-legal_name"
                  placeholder="Nombre legal registrado"
                  value={form.legal_name}
                  onChange={(e) => set('legal_name', e.target.value)}
                />
              </Field>
              <Field label="Sitio web">
                <Input
                  id="edit-website"
                  type="url"
                  placeholder="https://ejemplo.com"
                  value={form.website}
                  onChange={(e) => set('website', e.target.value)}
                />
              </Field>
            </div>
          </DrawerSection>

          {/* Empresa */}
          <DrawerSection title="Empresa" icon={Briefcase} contentClassName="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Industria">
                <SearchableSelect
                  options={buildIndustryOptions(form.industry)}
                  value={form.industry}
                  onValueChange={(v) => set('industry', v)}
                  placeholder="Seleccionar industria"
                  searchPlaceholder="Buscar industria…"
                  emptyMessage="No hay industrias con ese nombre."
                  compact
                  />
              </Field>
              <Field label="Tamaño de empresa">
                <Select
                  value={form.company_size}
                  onValueChange={(v) => set('company_size', v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Número de empleados" />
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                    {COMPANY_SIZES.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            </div>
          </DrawerSection>

          {/* Ubicación */}
          <DrawerSection title="Ubicación" icon={MapPin} contentClassName="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="País">
                <Select
                  value={form.country_code}
                  onValueChange={(v) => set('country_code', v ?? '')}
                >
                  <SelectTrigger className="w-full">
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
                  <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
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
              <Field label="Ciudad">
                <Input
                  id="edit-city"
                  placeholder="Bogotá, CDMX, São Paulo…"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                />
              </Field>
            </div>
            <Field label="Departamento / Estado / Provincia">
              <Input
                id="edit-region"
                placeholder="Cundinamarca, Jalisco, São Paulo…"
                value={form.region}
                onChange={(e) => set('region', e.target.value)}
              />
            </Field>
          </DrawerSection>

          {/* Identificación fiscal */}
          <DrawerSection title="Identificación fiscal" icon={Hash} contentClassName="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Tipo de identificador">
                <Select
                  value={form.tax_identifier_type}
                  onValueChange={(v) => set('tax_identifier_type', v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="NIT, RFC, RUT…" />
                  </SelectTrigger>
                  <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
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
              <Field label="Número">
                <Input
                  id="edit-tax-number"
                  placeholder="Número de identificación"
                  value={form.tax_identifier}
                  onChange={(e) => set('tax_identifier', e.target.value)}
                />
              </Field>
            </div>
          </DrawerSection>

          {/* Asignación */}
          <DrawerSection title="Asignación" icon={User} contentClassName="space-y-4">
            {users.length > 0 && (
              <Field label="Owner / Responsable">
                <Select
                  value={form.owner_id}
                  onValueChange={(v) => set('owner_id', v ?? '')}
                >
                  <SelectTrigger className="w-full">
                    {form.owner_id ? (
                      <span className="flex items-center gap-2 text-sm">
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
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
                  <SelectContent className="!w-auto min-w-[var(--anchor-width)]">
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        <span className="flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-xs font-semibold">
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
            <Field label="Notas">
              <Textarea
                id="edit-notes"
                placeholder="Contexto, señales de compra, próximos pasos…"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
              />
            </Field>
          </DrawerSection>
        </form>
      )}
    </DrawerShell>
  );
}
