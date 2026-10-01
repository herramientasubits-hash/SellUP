'use client';

// ── Import Column Mapping Table — Hito 16AB.40 ────────────────────────────────
// Shows detected column→field mappings for Industry/Subindustry confirmation.
// Allows the user to change which column maps to Industry or Subindustry.

import * as React from 'react';
import { ArrowRight, Check, Info } from "@/icons";
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
      <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/10 p-3">
        <p className="text-xs font-semibold text-primary">
          Columnas detectadas para clasificación
        </p>
        <div className="flex flex-wrap gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Industria:</span>
            {industryMapping ? (
              <Badge variant="brand">
                {industryMapping.sourceColumn}
              </Badge>
            ) : (
              <span className="text-muted-foreground italic">No detectada</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <span className="text-muted-foreground">Subindustria:</span>
            {subindustryMapping ? (
              <Badge variant="brand">
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
        <div className="flex items-center gap-2 rounded-xl border border-destructive/20 bg-destructive/10 p-3">
          <Info className="h-3.5 w-3.5 text-destructive shrink-0" />
          <p className="text-xs text-destructive">
            Dos columnas no pueden asignarse al mismo campo. Corrige el mapeo antes de continuar.
          </p>
        </div>
      )}

      {/* Mapping table */}
      <div className="overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border/50 bg-surface-subtle">
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
          <tbody className="divide-y divide-border/50">
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
                    isKey ? 'bg-primary/10' : 'hover:bg-surface-muted',
                    isDuplicate && 'bg-destructive/10',
                  )}
                >
                  {/* Column name */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {isKey && (
                        <Check className="h-3 w-3 text-primary shrink-0" />
                      )}
                      <span className={cn(
                        'font-medium',
                        isKey ? 'text-foreground' : 'text-muted-foreground',
                      )}>
                        {mapping.sourceColumn}
                      </span>
                      {mapping.detectedAutomatically && isKey && (
                        <Badge variant="outline" className="text-muted-foreground">
                          auto
                        </Badge>
                      )}
                    </div>
                  </td>

                  {/* Target select */}
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-1.5">
                      <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                      {isKey || mapping.targetField === 'ignore' ? (
                        <Select
                          value={mapping.targetField}
                          onValueChange={(v) => onMappingChange(mapping.sourceColumn, v as ImportColumnTarget)}
                        >
                          <SelectTrigger size="sm" className={cn(
                            'min-w-36',
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
                        <span className="text-muted-foreground text-xs">
                          {TARGET_LABELS[mapping.targetField] ?? mapping.targetField}
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Sample values */}
                  <td className="px-3 py-2.5">
                    {mapping.sampleValues.length > 0 ? (
                      <span className="block max-w-48 truncate text-xs text-muted-foreground" title={mapping.sampleValues.slice(0, 3).join(', ')}>
                        {mapping.sampleValues.slice(0, 3).join(', ')}
                      </span>
                    ) : (
                      <span className="text-xs italic text-text-muted">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legacy note */}
      <p className="text-xs text-muted-foreground leading-relaxed">
        Columnas con nombres como <span className="font-medium">Sector</span> o{' '}
        <span className="font-medium">Subsector</span> son detectadas automáticamente como Industria y Subindustria.
        La subindustria es opcional: si el archivo no la incluye, la importación continuará sin ella.
      </p>
    </div>
  );
}
