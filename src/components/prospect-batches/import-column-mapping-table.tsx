'use client';

// ── Import Column Mapping Table — Hito 16AB.40 ────────────────────────────────
// Shows detected column→field mappings for Industry/Subindustry confirmation.
// Allows the user to change which column maps to Industry or Subindustry.

import * as React from 'react';
import { ArrowRight, Check, Info } from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type {
  ImportColumnMapping,
  ImportColumnTarget,
} from '@/modules/prospect-batches/import-classification/import-classification-ui-types';

// ── Labels for column targets ─────────────────────────────────────────────────

const TARGET_LABELS: Record<ImportColumnTarget, string> = {
  company_name: 'Empresa',
  country: 'País',
  industry: 'Industria',
  subindustry: 'Subindustria',
  website: 'Sitio web',
  linkedin: 'LinkedIn',
  city: 'Ciudad',
  employee_size: 'Tamaño empresa',
  description: 'Descripción',
  primary_evidence_url: 'URL evidencia',
  evidence_source: 'Fuente',
  confidence: 'Confianza',
  notes: 'Notas',
  ignore: 'Ignorar columna',
};

// User-adjustable targets (restrict to meaningful options)
const ADJUSTABLE_TARGETS: ImportColumnTarget[] = [
  'industry',
  'subindustry',
  'ignore',
];

// ── Props ─────────────────────────────────────────────────────────────────────

type ImportColumnMappingTableProps = {
  columnMappings: ImportColumnMapping[];
  onMappingChange: (sourceColumn: string, newTarget: ImportColumnTarget) => void;
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function isKeyClassificationTarget(target: ImportColumnTarget): boolean {
  return target === 'industry' || target === 'subindustry';
}

function hasDuplicateTarget(
  mappings: ImportColumnMapping[],
  target: ImportColumnTarget,
): boolean {
  if (target === 'ignore') return false;
  return mappings.filter((m) => m.targetField === target).length > 1;
}

// ── Main component ────────────────────────────────────────────────────────────

export function ImportColumnMappingTable({
  columnMappings,
  onMappingChange,
}: ImportColumnMappingTableProps) {
  const industryMapping = columnMappings.find((m) => m.targetField === 'industry');
  const subindustryMapping = columnMappings.find((m) => m.targetField === 'subindustry');

  const hasDuplicateIndustry = hasDuplicateTarget(columnMappings, 'industry');
  const hasDuplicateSubindustry = hasDuplicateTarget(columnMappings, 'subindustry');
  const hasConflict = hasDuplicateIndustry || hasDuplicateSubindustry;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="rounded-xl border border-su-brand/20 bg-su-brand-soft/20 p-3 space-y-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-su-brand">
          Columnas detectadas para clasificación
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Industria:</span>
            {industryMapping ? (
              <Badge variant="secondary" className="text-[10px] bg-su-brand-soft text-su-brand border-0">
                {industryMapping.sourceColumn}
              </Badge>
            ) : (
              <span className="text-muted-foreground italic">No detectada</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Subindustria:</span>
            {subindustryMapping ? (
              <Badge variant="secondary" className="text-[10px] bg-su-brand-soft text-su-brand border-0">
                {subindustryMapping.sourceColumn}
              </Badge>
            ) : (
              <span className="text-muted-foreground italic">No detectada (opcional)</span>
            )}
          </div>
        </div>
      </div>

      {/* Conflict warning */}
      {hasConflict && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 flex items-center gap-2">
          <Info className="h-3.5 w-3.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive">
            Dos columnas no pueden asignarse al mismo campo. Corrige el mapeo antes de continuar.
          </p>
        </div>
      )}

      {/* Mapping table */}
      <div className="overflow-x-auto rounded-xl border border-border/40">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/30 bg-muted/30">
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                Columna del archivo
              </th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground whitespace-nowrap">
                Asignada a
              </th>
              <th className="px-3 py-2 text-left font-semibold text-muted-foreground">
                Valores de muestra
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/20">
            {columnMappings.map((mapping) => {
              const isKey = isKeyClassificationTarget(mapping.targetField);
              const isDuplicate =
                mapping.targetField !== 'ignore' &&
                hasDuplicateTarget(columnMappings, mapping.targetField);

              return (
                <tr
                  key={mapping.sourceColumn}
                  className={cn(
                    'transition-colors',
                    isKey ? 'bg-su-brand-soft/10 hover:bg-su-brand-soft/20' : 'hover:bg-muted/20',
                    isDuplicate && 'bg-destructive/5',
                  )}
                >
                  {/* Column name */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {isKey && (
                        <Check className="h-3 w-3 text-su-brand shrink-0" />
                      )}
                      <span className={cn(
                        'font-medium',
                        isKey ? 'text-foreground' : 'text-muted-foreground',
                      )}>
                        {mapping.sourceColumn}
                      </span>
                      {mapping.detectedAutomatically && isKey && (
                        <Badge variant="outline" className="text-[9px] text-muted-foreground px-1 py-0">
                          auto
                        </Badge>
                      )}
                    </div>
                  </td>

                  {/* Target select */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <ArrowRight className="h-3 w-3 text-muted-foreground/50 shrink-0" />
                      {isKey || mapping.targetField === 'ignore' ? (
                        <Select
                          value={mapping.targetField}
                          onValueChange={(v) => onMappingChange(mapping.sourceColumn, v as ImportColumnTarget)}
                        >
                          <SelectTrigger className={cn(
                            'h-7 text-xs min-w-[140px]',
                            isDuplicate && 'border-destructive',
                          )}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ADJUSTABLE_TARGETS.map((target) => (
                              <SelectItem key={target} value={target} className="text-xs">
                                {TARGET_LABELS[target]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span className="text-muted-foreground text-[11px]">
                          {TARGET_LABELS[mapping.targetField] ?? mapping.targetField}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Sample values */}
                  <td className="px-3 py-2.5">
                    {mapping.sampleValues.length > 0 ? (
                      <span className="text-[10px] text-muted-foreground truncate block max-w-[200px]">
                        {mapping.sampleValues.slice(0, 3).join(', ')}
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground/40 italic">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legacy note */}
      <p className="text-[10px] text-muted-foreground leading-relaxed">
        Columnas con nombres como <span className="font-medium">Sector</span> o{' '}
        <span className="font-medium">Subsector</span> son detectadas automáticamente como Industria y Subindustria.
        La subindustria es opcional: si el archivo no la incluye, la importación continuará sin ella.
      </p>
    </div>
  );
}
