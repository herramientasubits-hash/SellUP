/**
 * Date utilities using native Date and Intl.DateTimeFormat.
 * No external date libraries (date-fns, dayjs, moment).
 */

const DEFAULT_LOCALE = 'es-CO';
const DEFAULT_DATE_FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
};

/**
 * Check if a value is a valid Date instance.
 */
export function isValidDate(value: unknown): value is Date {
  return value instanceof Date && !isNaN(value.getTime());
}

/**
 * Format a single date to string.
 * Default format: "DD/MM/YYYY" for es-CO
 * @param date - The date to format, or undefined/null for empty string
 * @param locale - Locale code (default: 'es-CO')
 * @returns Formatted date string, or empty string if date is falsy
 */
export function formatDate(
  date?: Date | null,
  locale: string = DEFAULT_LOCALE
): string {
  if (!date || !isValidDate(date)) {
    return '';
  }

  try {
    const formatter = new Intl.DateTimeFormat(locale, DEFAULT_DATE_FORMAT);
    return formatter.format(date);
  } catch {
    // Fallback if locale is invalid
    const formatter = new Intl.DateTimeFormat(DEFAULT_LOCALE, DEFAULT_DATE_FORMAT);
    return formatter.format(date);
  }
}

/**
 * Format a date range to string.
 * Default format: "DD/MM/YYYY - DD/MM/YYYY"
 * @param from - Start date
 * @param to - End date
 * @param locale - Locale code (default: 'es-CO')
 * @returns Formatted range string, or empty string if both dates are falsy
 */
export function formatDateRange(
  from?: Date | null,
  to?: Date | null,
  locale: string = DEFAULT_LOCALE
): string {
  const fromStr = formatDate(from, locale);
  const toStr = formatDate(to, locale);

  if (!fromStr && !toStr) {
    return '';
  }

  if (!toStr) {
    return fromStr;
  }

  if (!fromStr) {
    return toStr;
  }

  return `${fromStr} - ${toStr}`;
}

/**
 * Check if a date is within a range.
 * @param date - Date to check
 * @param min - Minimum date (inclusive)
 * @param max - Maximum date (inclusive)
 * @returns true if date is within range, false otherwise
 */
export function isDateInRange(
  date: Date,
  min?: Date,
  max?: Date
): boolean {
  if (!isValidDate(date)) {
    return false;
  }

  if (min && isValidDate(min) && date < min) {
    return false;
  }

  if (max && isValidDate(max) && date > max) {
    return false;
  }

  return true;
}

/**
 * Compare two dates (ignoring time).
 * @returns -1 if a < b, 0 if a === b, 1 if a > b
 */
export function compareDates(a: Date, b: Date): -1 | 0 | 1 {
  const aTime = new Date(a.getFullYear(), a.getMonth(), a.getDate()).getTime();
  const bTime = new Date(b.getFullYear(), b.getMonth(), b.getDate()).getTime();

  if (aTime < bTime) return -1;
  if (aTime > bTime) return 1;
  return 0;
}

/**
 * Create a date at the start of a day (00:00:00).
 */
export function startOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  return result;
}

/**
 * Create a date at the end of a day (23:59:59).
 */
export function endOfDay(date: Date): Date {
  const result = new Date(date);
  result.setHours(23, 59, 59, 999);
  return result;
}

/**
 * Format month and year.
 * Example: "May 2026"
 */
export function formatMonthYear(
  year: number,
  month: number, // 0-indexed
  locale: string = DEFAULT_LOCALE
): string {
  const date = new Date(year, month, 1);
  return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(date);
}

/**
 * Format quarter and year.
 * Example: "Q2 2026"
 */
export function formatQuarter(
  year: number,
  quarter: 1 | 2 | 3 | 4
): string {
  // Simple format, can be localized if needed
  return `Q${quarter} ${year}`;
}

/**
 * Get quarter from date.
 * @returns 1, 2, 3, or 4
 */
export function getQuarterFromDate(date: Date): 1 | 2 | 3 | 4 {
  const month = date.getMonth();
  return (Math.floor(month / 3) + 1) as 1 | 2 | 3 | 4;
}