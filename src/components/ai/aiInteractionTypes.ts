export type ChipVariant = "solid" | "outline" | "ghost";
export type ChipTone = "default" | "muted" | "primary" | "positive" | "negative" | "warning" | "info" | "ai";
export type ChipSize = "sm" | "md";

export type AIButtonVariant = "primary" | "secondary" | "subtle" | "outline";
export type AIButtonSize = "xs" | "sm" | "md" | "lg";

export type AILoaderVariant = "inline" | "block" | "card";
export type AILoaderStatus = "thinking" | "generating" | "analyzing" | "complete" | "error";

export type SaveStatus = "idle" | "saving" | "saved" | "error" | "offline";
export type SaveIndicatorSize = "sm" | "md";

export interface ChipProps {
  label: string;
  selected?: boolean;
  removable?: boolean;
  disabled?: boolean;
  icon?: React.ComponentType<{ className?: string }>;
  count?: number;
  variant?: ChipVariant;
  tone?: ChipTone;
  size?: ChipSize;
  onClick?: () => void;
  onRemove?: () => void;
  className?: string;
}

export interface AIButtonProps {
  label?: string;
  children?: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  variant?: AIButtonVariant;
  size?: AIButtonSize;
  leftIcon?: React.ComponentType<{ className?: string }>;
  rightIcon?: React.ComponentType<{ className?: string }>;
  helperText?: string;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  form?: string;
  className?: string;
}

export interface AILoaderProps {
  variant?: AILoaderVariant;
  label?: string;
  description?: string;
  progress?: number;
  status?: AILoaderStatus;
  className?: string;
}

export interface SaveIndicatorProps {
  status: SaveStatus;
  label?: string;
  timestamp?: string;
  compact?: boolean;
  className?: string;
}