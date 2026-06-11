"use client";

import * as React from "react";
import { FileSpreadsheet, Upload, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  UploadFileItem,
  UploadProgressStatus,
  CsvPreviewColumn,
  CsvPreviewRow,
} from "./uploadTypes";
import { UploadZone } from "./UploadZone";
import { FilePreview } from "./FilePreview";
import { UploadProgress } from "./UploadProgress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/feedback/EmptyState";

export interface ImportCsvPanelProps {
  /** Selected file or metadata */
  file?: File | UploadFileItem;
  /** Callback when a file is selected or dropped */
  onFileChange?: (files: File[]) => void;
  /** Columns for the preview table */
  previewColumns?: CsvPreviewColumn[];
  /** Rows for the preview table (simulated) */
  previewRows?: CsvPreviewRow[];
  /** Progress percentage (0-100) */
  progress?: number;
  /** Current operation status */
  status?: UploadProgressStatus;
  /** Error message to display */
  error?: string;
  /** Whether the panel is disabled */
  disabled?: boolean;
  /** Maximum file size in MB */
  maxSizeMB?: number;
  /** Additional actions to show in the footer */
  actions?: React.ReactNode;
  /** Additional CSS classes */
  className?: string;
}

/**
 * ImportCsvPanel - SellUp component for CSV import experience.
 * Orchestrates upload, progress, and data preview.
 */
export function ImportCsvPanel({
  file,
  onFileChange,
  previewColumns,
  previewRows,
  progress = 0,
  status = "idle",
  error,
  disabled = false,
  maxSizeMB = 10,
  actions,
  className,
}: ImportCsvPanelProps) {
  const hasFile = !!file;
  const hasPreview = previewColumns && previewColumns.length > 0 && previewRows && previewRows.length > 0;

  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <CardContent className="p-6 space-y-6">
        {/* Header/Instruction */}
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-su-brand/5 text-su-brand border border-su-brand/10">
            <FileSpreadsheet className="h-6 w-6" />
          </div>
          <div className="flex flex-col">
            <h3 className="text-lg font-bold">Importar Datos</h3>
            <p className="text-sm text-muted-foreground">
              Carga tu archivo CSV para previsualizar y validar los datos antes de importar.
            </p>
          </div>
        </div>

        {/* Upload Area or File Preview */}
        {!hasFile ? (
          <UploadZone
            accept=".csv"
            maxSizeMB={maxSizeMB}
            onChange={onFileChange}
            disabled={disabled}
            description={`Solo archivos .csv (Máx. ${maxSizeMB}MB)`}
            className="border-dashed"
          />
        ) : (
          <div className="space-y-4">
            <FilePreview
              file={file}
              variant="row"
              removable={status === "idle" || status === "error"}
              onRemove={() => onFileChange?.([])}
              disabled={disabled || status === "uploading" || status === "validating"}
            />

            {(status !== "idle" || progress > 0) && (
              <UploadProgress
                value={progress}
                status={status}
                label={status === "uploading" ? "Cargando archivo..." : status === "validating" ? "Validando datos..." : "Procesado"}
                error={error}
                className="bg-muted/30 p-4 rounded-xl border border-border/50"
              />
            )}
          </div>
        )}

        {/* Preview Table */}
        {hasFile && status !== "uploading" && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold flex items-center gap-2">
                Previsualización de Datos
                <span className="text-[10px] font-normal px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase">
                  Primeras {previewRows?.length} filas
                </span>
              </h4>
            </div>

            {hasPreview ? (
              <div className="rounded-xl border border-border/50 overflow-hidden bg-muted/5">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      {previewColumns.map((col) => (
                        <TableHead key={col.key} className="h-10 text-[10px] font-bold uppercase tracking-wider">
                          {col.label}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, idx) => (
                      <TableRow key={idx} className="hover:bg-muted/20">
                        {previewColumns.map((col) => (
                          <TableCell key={col.key} className="py-2 text-xs truncate max-w-[200px]">
                            {String(row[col.key] ?? "")}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            ) : status === "success" ? (
              <div className="p-12 border-2 border-dashed rounded-xl flex flex-col items-center text-center gap-3">
                <Info className="h-8 w-8 text-muted-foreground" />
                <div className="space-y-1">
                  <p className="text-sm font-medium">No hay vista previa disponible</p>
                  <p className="text-xs text-muted-foreground">Los datos han sido procesados correctamente.</p>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Sin previsualización"
                description="Selecciona un archivo válido para ver una muestra de los datos."
                icon={Upload}
                className="py-12 border-2"
              />
            )}
          </div>
        )}

        {/* Footer Actions */}
        {actions && (
          <div className="px-6 py-4 bg-muted/20 border-t border-border/50 flex items-center justify-end gap-3">
            {actions}
          </div>
        )}
      </CardContent>
    </Card>
  );
}