"use client";

import {
  FileText,
  FileImage,
  FileArchive,
  FileAudio,
  FileVideo,
  FileSpreadsheet,
  File,
  X,
  AlertCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { UploadFileItem } from "./uploadTypes";
import { formatFileSize, getFileKind } from "./uploadUtils";

export type FilePreviewVariant = "card" | "row" | "compact";

export interface FilePreviewProps {
  /** File object or item metadata */
  file: File | UploadFileItem;
  /** Visual variant */
  variant?: FilePreviewVariant;
  /** Whether the file can be removed */
  removable?: boolean;
  /** Callback when remove button is clicked */
  onRemove?: () => void;
  /** Whether the preview is disabled */
  disabled?: boolean;
  /** Error message to show */
  error?: string;
  /** Additional CSS classes */
  className?: string;
}

const KIND_ICONS = {
  image: FileImage,
  pdf: FileText,
  spreadsheet: FileSpreadsheet,
  document: FileText,
  archive: FileArchive,
  audio: FileAudio,
  video: FileVideo,
  other: File,
} as const;

/**
 * FilePreview - SellUp component for visualizing file metadata.
 * Supports different layouts (card, row, compact).
 */
export function FilePreview({
  file,
  variant = "card",
  removable = false,
  onRemove,
  disabled = false,
  error,
  className,
}: FilePreviewProps) {
  const name = file.name;
  const size = file.size;
  const kind = getFileKind(file);
  const Icon = KIND_ICONS[kind] || File;

  const hasError = !!error;

  if (variant === "compact") {
    return (
      <div className={cn(
        "flex items-center gap-2 px-3 py-1.5 rounded-full border bg-secondary/30 border-border/50 text-xs font-medium max-w-fit",
        hasError && "border-destructive/50 bg-destructive/5",
        disabled && "opacity-50",
        className
      )}>
        <Icon className={cn("h-3.5 w-3.5 shrink-0", hasError ? "text-destructive" : "text-muted-foreground")} />
        <span className="truncate max-w-[120px]">{name}</span>
        {removable && !disabled && (
          <button
            type="button"
            onClick={onRemove}
            className="hover:text-destructive transition-colors ml-1 p-0.5"
            aria-label={`Remove ${name}`}
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>
    );
  }

  if (variant === "row") {
    return (
      <div className={cn(
        "flex items-center gap-3 p-3 rounded-lg border bg-card/50 border-border/50 transition-colors",
        hasError && "border-destructive/50 bg-destructive/5",
        disabled && "opacity-50",
        className
      )}>
        <div className={cn(
          "p-2 rounded-md bg-background border border-border/50",
          hasError && "text-destructive"
        )}>
          <Icon className="h-5 w-5" />
        </div>

        <div className="flex-1 min-w-0 flex flex-col">
          <span className="text-sm font-medium truncate">{name}</span>
          <span className="text-[10px] text-muted-foreground uppercase tracking-tight">
            {formatFileSize(size)} • {kind}
          </span>
          {hasError && (
            <span className="text-[10px] text-destructive font-medium mt-0.5 flex items-center gap-1">
              <AlertCircle className="h-2.5 w-2.5" />
              {error}
            </span>
          )}
        </div>

        {removable && !disabled && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${name}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
    );
  }

  // Default: Card variant
  return (
    <div className={cn(
      "flex flex-col p-4 rounded-xl border bg-card border-border/50 shadow-sm transition-all",
      hasError && "border-destructive/50 ring-1 ring-destructive/20",
      !disabled && !hasError && "hover:border-su-brand/30",
      disabled && "opacity-50 grayscale-[0.5]",
      className
    )}>
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className={cn(
          "p-3 rounded-xl bg-muted/50 border border-border/50",
          hasError ? "text-destructive bg-destructive/10" : "text-su-brand"
        )}>
          <Icon className="h-6 w-6" />
        </div>
        {removable && !disabled && (
          <button
            type="button"
            onClick={onRemove}
            className="p-1.5 hover:bg-muted rounded-full transition-colors text-muted-foreground hover:text-destructive"
            aria-label={`Remove ${name}`}
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-col min-w-0">
        <span className="text-sm font-bold truncate" title={name}>{name}</span>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
            {formatFileSize(size)}
          </span>
          <span className="text-[10px] font-bold text-su-brand/70 uppercase px-1.5 py-0.5 rounded-md bg-su-brand/5 border border-su-brand/10">
            {kind}
          </span>
        </div>

        {hasError && (
          <div className="mt-3 flex items-start gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/20">
            <AlertCircle className="h-3 w-3 text-destructive shrink-0 mt-0.5" />
            <span className="text-[10px] text-destructive font-medium leading-tight">
              {error}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}