"use client";

import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { UploadProgressStatus } from "./uploadTypes";

export interface UploadProgressProps {
  /** Progress value from 0 to 100 */
  value?: number;
  /** Current operation status */
  status?: UploadProgressStatus;
  /** Main label text */
  label?: string;
  /** Secondary description text */
  description?: string;
  /** Error message to show when status is 'error' */
  error?: string;
  /** Whether to show the percentage value */
  showValue?: boolean;
  /** Additional CSS classes */
  className?: string;
}

/**
 * UploadProgress - SellUp component for visualizing upload and processing state.
 * Fully controlled by props, no internal timers.
 */
export function UploadProgress({
  value = 0,
  status = "idle",
  label,
  description,
  error,
  showValue = true,
  className,
}: UploadProgressProps) {
  const isError = status === "error";
  const isSuccess = status === "success";
  const isProcessing = status === "validating" || status === "uploading";

  return (
    <div
      className={cn("flex flex-col gap-2", className)}
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label || "Upload progress"}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col min-w-0">
          {label && (
            <span className={cn(
              "text-sm font-semibold truncate",
              isError && "text-destructive",
              isSuccess && "text-su-brand"
            )}>
              {label}
            </span>
          )}
          {(description || (isError && error)) && (
            <span className={cn(
              "text-xs text-muted-foreground truncate",
              isError && "text-destructive font-medium"
            )}>
              {isError ? (error || "An error occurred") : description}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {isProcessing && <Loader2 className="h-4 w-4 animate-spin text-su-brand" />}
          {isSuccess && <CheckCircle2 className="h-4 w-4 text-su-brand" />}
          {isError && <AlertCircle className="h-4 w-4 text-destructive" />}
          {showValue && status !== "idle" && (
            <span className="text-sm font-bold tabular-nums">
              {Math.round(value)}%
            </span>
          )}
        </div>
      </div>

      <Progress
        value={value}
        className={cn(
          "h-2",
          isError && "[&>div]:bg-destructive",
          isSuccess && "[&>div]:bg-su-brand"
        )}
      />
    </div>
  );
}