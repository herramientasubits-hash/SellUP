'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Loader2 } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
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
import { createAccount } from '@/modules/accounts/actions';
import {
  LATAM_COUNTRIES,
  INDUSTRIES,
  COMPANY_SIZES,
  TAX_IDENTIFIER_TYPE_LABELS,
  type TaxIdentifierType,
  type InternalUserOption,
} from '@/modules/accounts/types';

interface CreateAccountDrawerProps {
  users: InternalUserOption[];
}

export function CreateAccountDrawer({ users }: CreateAccountDrawerProps) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
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
  });

  function set(field: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [field]: value }));
  }

  const selectedCountry = LATAM_COUNTRIES.find((c) => c.code === form.country_code);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!form.name.trim()) {
      setError('El nombre es requerido');
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

      setOpen(false);
      setForm({
        name: '',
        legal_name: '',
        website: '',
        country_code: '',
        city: '',
        region: '',
        industry: '',
        company_size: '',
        tax_identifier: '',
        tax_identifier_type: '',
        owner_id: '',
        notes: '',
      });
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

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader>
            <SheetTitle>Nueva cuenta</SheetTitle>
            <SheetDescription>
              Registra una empresa o prospecto manualmente. Podrás enriquecerla más adelante.
            </SheetDescription>
          </SheetHeader>

          <form onSubmit={handleSubmit} className="mt-6 space-y-5 pb-6">
            {/* Nombre */}
            <div className="space-y-1.5">
              <Label htmlFor="name">
                Nombre de empresa / prospecto <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                placeholder="Ej. Bancolombia S.A."
                value={form.name}
                onChange={(e) => set('name', e.target.value)}
                required
              />
            </div>

            {/* Razón social */}
            <div className="space-y-1.5">
              <Label htmlFor="legal_name">Razón social</Label>
              <Input
                id="legal_name"
                placeholder="Ej. Bancolombia S.A. – NIT 890.903.938-8"
                value={form.legal_name}
                onChange={(e) => set('legal_name', e.target.value)}
              />
            </div>

            {/* Sitio web */}
            <div className="space-y-1.5">
              <Label htmlFor="website">Sitio web</Label>
              <Input
                id="website"
                type="url"
                placeholder="https://www.ejemplo.com"
                value={form.website}
                onChange={(e) => set('website', e.target.value)}
              />
            </div>

            {/* País + Ciudad */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>País</Label>
                <Select value={form.country_code} onValueChange={(v) => set('country_code', v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Seleccionar" />
                  </SelectTrigger>
                  <SelectContent>
                    {LATAM_COUNTRIES.map((c) => (
                      <SelectItem key={c.code} value={c.code}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="city">Ciudad</Label>
                <Input
                  id="city"
                  placeholder="Ej. Bogotá"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                />
              </div>
            </div>

            {/* Región */}
            <div className="space-y-1.5">
              <Label htmlFor="region">Región / Departamento / Estado</Label>
              <Input
                id="region"
                placeholder="Ej. Cundinamarca"
                value={form.region}
                onChange={(e) => set('region', e.target.value)}
              />
            </div>

            {/* Industria */}
            <div className="space-y-1.5">
              <Label>Industria</Label>
              <Select value={form.industry} onValueChange={(v) => set('industry', v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar industria" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((ind) => (
                    <SelectItem key={ind} value={ind}>
                      {ind}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Tamaño de empresa */}
            <div className="space-y-1.5">
              <Label>Tamaño de empresa</Label>
              <Select value={form.company_size} onValueChange={(v) => set('company_size', v ?? '')}>
                <SelectTrigger>
                  <SelectValue placeholder="Seleccionar tamaño" />
                </SelectTrigger>
                <SelectContent>
                  {COMPANY_SIZES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Identificador fiscal */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Tipo de ID fiscal</Label>
                <Select
                  value={form.tax_identifier_type}
                  onValueChange={(v) => set('tax_identifier_type', v ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Tipo" />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.entries(TAX_IDENTIFIER_TYPE_LABELS) as [TaxIdentifierType, string][]).map(
                      ([key, label]) => (
                        <SelectItem key={key} value={key}>
                          {label}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="tax_identifier">Número</Label>
                <Input
                  id="tax_identifier"
                  placeholder="Ej. 890.903.938-8"
                  value={form.tax_identifier}
                  onChange={(e) => set('tax_identifier', e.target.value)}
                />
              </div>
            </div>

            {/* Owner */}
            {users.length > 0 && (
              <div className="space-y-1.5">
                <Label>Owner / Responsable</Label>
                <Select value={form.owner_id} onValueChange={(v) => set('owner_id', v ?? '')}>
                  <SelectTrigger>
                    <SelectValue placeholder="Asignar responsable" />
                  </SelectTrigger>
                  <SelectContent>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.full_name ?? u.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Notas */}
            <div className="space-y-1.5">
              <Label htmlFor="notes">Notas iniciales</Label>
              <Textarea
                id="notes"
                placeholder="Contexto, por qué es relevante, próximos pasos…"
                value={form.notes}
                onChange={(e) => set('notes', e.target.value)}
                rows={3}
              />
            </div>

            {error && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancelar
              </Button>
              <Button type="submit" size="sm" disabled={pending}>
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
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}
