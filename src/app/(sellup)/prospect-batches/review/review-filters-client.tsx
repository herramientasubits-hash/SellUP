'use client';

import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { useCallback } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { ConfidenceBand, PendingReviewFilterOptions } from '@/modules/prospect-review/types';

// Presentation-only labels. Country codes fall back to the raw code when not
// mapped (no invented data). Confidence/duplicate labels are Spanish operativa
// copy consistent with the rest of the console.
const COUNTRY_LABELS: Record<string, string> = {
  CO: 'Colombia',
  MX: 'México',
  PE: 'Perú',
  CL: 'Chile',
  CR: 'Costa Rica',
  GT: 'Guatemala',
  PA: 'Panamá',
  DO: 'República Dominicana',
  HN: 'Honduras',
  EC: 'Ecuador',
};

const CONFIDENCE_LABELS: Record<ConfidenceBand, string> = {
  high: 'Confianza alta (≥70)',
  medium: 'Confianza media (40–69)',
  low: 'Confianza baja (<40)',
};

const DUPLICATE_LABELS: Record<string, string> = {
  no_match: 'Sin coincidencia',
  possible_duplicate: 'Posible duplicado',
  duplicate: 'Duplicado',
  unique: 'Único',
};

function countryLabel(code: string): string {
  return COUNTRY_LABELS[code] ?? code;
}

function duplicateLabel(value: string): string {
  return DUPLICATE_LABELS[value] ?? value.replace(/_/g, ' ');
}

interface ReviewFiltersClientProps {
  options: PendingReviewFilterOptions;
  currentCountry: string;
  currentIndustry: string;
  currentBatch: string;
  currentConfidence: string;
  currentDuplicate: string;
}

export function ReviewFiltersClient({
  options,
  currentCountry,
  currentIndustry,
  currentBatch,
  currentConfidence,
  currentDuplicate,
}: ReviewFiltersClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (!value || value === 'all') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      const qs = params.toString();
      router.push(qs ? `${pathname}?${qs}` : pathname);
    },
    [router, pathname, searchParams],
  );

  const countryTriggerLabel = (value: string) =>
    !value || value === 'all' ? 'Todos los países' : countryLabel(value);
  const industryTriggerLabel = (value: string) =>
    !value || value === 'all' ? 'Todas las industrias' : value;
  const batchTriggerLabel = (value: string) => {
    if (!value || value === 'all') return 'Todos los lotes';
    return options.batches.find((b) => b.id === value)?.label ?? 'Lote no encontrado';
  };
  const confidenceTriggerLabel = (value: string) =>
    !value || value === 'all'
      ? 'Toda confianza'
      : CONFIDENCE_LABELS[value as ConfidenceBand] ?? value;
  const duplicateTriggerLabel = (value: string) =>
    !value || value === 'all' ? 'Todo estado de duplicado' : duplicateLabel(value);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mr-1 text-xs font-semibold text-muted-foreground">
        Filtrar
      </span>

      {/* País */}
      {options.countries.length > 0 && (
        <Select value={currentCountry || 'all'} onValueChange={(v) => setParam('country', v)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue placeholder="País">{countryTriggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Todos los países
            </SelectItem>
            {options.countries.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {countryLabel(c.code)} ({c.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Industria */}
      {options.industries.length > 0 && (
        <Select value={currentIndustry || 'all'} onValueChange={(v) => setParam('industry', v)}>
          <SelectTrigger size="sm" className="w-44">
            <SelectValue placeholder="Industria">{industryTriggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Todas las industrias
            </SelectItem>
            {options.industries.map((i) => (
              <SelectItem key={i.name} value={i.name}>
                {i.name} ({i.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Lote */}
      {options.batches.length > 0 && (
        <Select value={currentBatch || 'all'} onValueChange={(v) => setParam('batch', v)}>
          <SelectTrigger size="sm" className="w-50">
            <SelectValue placeholder="Lote">{batchTriggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Todos los lotes
            </SelectItem>
            {options.batches.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {b.label} ({b.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Confianza */}
      {options.confidenceBands.length > 0 && (
        <Select
          value={currentConfidence || 'all'}
          onValueChange={(v) => setParam('confidence', v)}
        >
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Confianza">{confidenceTriggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Toda confianza
            </SelectItem>
            {options.confidenceBands.map((b) => (
              <SelectItem key={b.band} value={b.band}>
                {CONFIDENCE_LABELS[b.band]} ({b.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Estado de duplicado */}
      {options.duplicateStatuses.length > 0 && (
        <Select value={currentDuplicate || 'all'} onValueChange={(v) => setParam('duplicate', v)}>
          <SelectTrigger size="sm" className="w-48">
            <SelectValue placeholder="Duplicado">{duplicateTriggerLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">
              Todo estado de duplicado
            </SelectItem>
            {options.duplicateStatuses.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {duplicateLabel(d.value)} ({d.count})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}
