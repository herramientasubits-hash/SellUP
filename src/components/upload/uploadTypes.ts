/**
 * Upload & Files Types for SellUp Enterprise System.
 */

export type UploadFileStatus = 'idle' | 'selected' | 'error';

export type FileKind = 'image' | 'pdf' | 'spreadsheet' | 'document' | 'archive' | 'audio' | 'video' | 'other';

export interface UploadFileItem {
  id: string;
  file: File;
  name: string;
  size: number;
  type: string;
  extension: string;
  status: UploadFileStatus;
  error?: string;
}

export interface FileValidationRules {
  /** Allowed file extensions (e.g. ['.jpg', '.pdf']) or MIME types */
  accept?: string;
  /** Maximum file size in Megabytes */
  maxSizeMB?: number;
  /** Maximum number of files allowed */
  maxFiles?: number;
  /** Whether multiple files are allowed */
  multiple?: boolean;
}

export interface FileValidationResult {
  isValid: boolean;
  error?: string;
}

export type UploadProgressStatus = 'idle' | 'validating' | 'uploading' | 'success' | 'error';

export interface CsvPreviewColumn {
  key: string;
  label: string;
}

export type CsvPreviewRow = Record<string, string | number | boolean | null>;