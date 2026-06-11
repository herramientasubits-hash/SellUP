/**
 * Upload & Files Utilities using native HTML5 File API.
 */

import type { FileValidationRules, FileValidationResult, FileKind, UploadFileItem } from './uploadTypes';

/**
 * Format file size in bytes to human readable string (KB, MB).
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Get file extension from file name.
 */
export function getFileExtension(fileName: string): string {
  return fileName.slice(((fileName.lastIndexOf('.') - 1) >>> 0) + 2).toLowerCase();
}

/**
 * Validate a list of files against rules.
 */
export function validateFiles(
  files: File[],
  rules: FileValidationRules,
  currentCount: number = 0
): FileValidationResult {
  const { accept, maxSizeMB, maxFiles, multiple } = rules;

  // 1. Check quantity
  if (!multiple && files.length > 1) {
    return { isValid: false, error: 'Only one file is allowed.' };
  }

  if (maxFiles && currentCount + files.length > maxFiles) {
    return { isValid: false, error: `Maximum ${maxFiles} files allowed.` };
  }

  // 2. Validate each file
  for (const file of files) {
    // Check size
    if (maxSizeMB && file.size > maxSizeMB * 1024 * 1024) {
      return {
        isValid: false,
        error: `File "${file.name}" exceeds the ${maxSizeMB}MB limit.`,
      };
    }

    // Check type/extension
    if (accept) {
      const extension = `.${getFileExtension(file.name)}`;
      const mimeType = file.type;
      const acceptedTypes = accept.split(',').map((t) => t.trim().toLowerCase());

      const isAccepted = acceptedTypes.some((type) => {
        if (type.startsWith('.')) {
          return extension === type;
        }
        if (type.endsWith('/*')) {
          const baseType = type.split('/')[0];
          return mimeType.startsWith(`${baseType}/`);
        }
        return mimeType === type;
      });

      if (!isAccepted) {
        return {
          isValid: false,
          error: `File type "${extension}" is not allowed.`,
        };
      }
    }
  }

  return { isValid: true };
}

/**
 * Categorize file by its type or extension.
 */
export function getFileKind(file: File | UploadFileItem): FileKind {
  const mimeType = 'file' in file ? file.type : file.type;
  const extension = getFileExtension(file.name);

  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType === 'application/pdf' || extension === 'pdf') return 'pdf';

  if (
    mimeType === 'application/vnd.ms-excel' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    ['csv', 'xls', 'xlsx'].includes(extension)
  ) {
    return 'spreadsheet';
  }

  if (
    mimeType === 'application/msword' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['doc', 'docx', 'txt', 'rtf'].includes(extension)
  ) {
    return 'document';
  }

  if (
    ['zip', 'rar', '7z', 'tar', 'gz'].includes(extension) ||
    mimeType === 'application/zip' ||
    mimeType === 'application/x-rar-compressed'
  ) {
    return 'archive';
  }

  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';

  return 'other';
}