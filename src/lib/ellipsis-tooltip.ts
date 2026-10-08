/**
 * Detección de texto recortado con puntos suspensivos (`truncate`, `line-clamp-N`).
 *
 * Regla de plataforma: todo texto que se corta con «…» muestra su texto completo en un
 * tooltip. Esto lo resuelve un único detector global (`EllipsisTooltip`) en vez de
 * envolver a mano cada celda, para que ningún módulo nuevo se quede sin tooltip.
 *
 * Puro: sin React ni reloj. El lector de estilos se inyecta para poder probarlo sin layout.
 */

/** Atributo para excluir un elemento (y sus hijos) del tooltip automático. */
export const ELLIPSIS_TOOLTIP_OPT_OUT_ATTRIBUTE = 'data-no-ellipsis-tooltip';

const MAX_ANCESTOR_DEPTH = 5;
const MAX_TEXT_LENGTH = 600;
const OVERFLOW_TOLERANCE_PX = 1;
const IGNORED_TAGS: ReadonlySet<string> = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION']);
/** Si el elemento ya cuelga de un tooltip propio, no se duplica. */
const OWN_TOOLTIP_SELECTOR = '[data-slot="tooltip-trigger"], [role="tooltip"], [data-slot="tooltip-content"]';

export type EllipsisStyle = {
  textOverflow: string;
  overflowX: string;
  overflowY: string;
  /** Valor de `-webkit-line-clamp` («none» si no hay). */
  lineClamp: string;
};

export type EllipsisStyleReader = (element: Element) => EllipsisStyle;

/** Lector real: estilos calculados del navegador. */
export function readComputedEllipsisStyle(element: Element): EllipsisStyle {
  const style = getComputedStyle(element);
  return {
    textOverflow: style.textOverflow,
    overflowX: style.overflowX,
    overflowY: style.overflowY,
    lineClamp: style.getPropertyValue('-webkit-line-clamp') || style.getPropertyValue('line-clamp') || 'none',
  };
}

/** ¿Este elemento está cortando su texto ahora mismo con puntos suspensivos? */
export function isEllipsized(element: Element, read: EllipsisStyleReader = readComputedEllipsisStyle): boolean {
  const style = read(element);
  const clamped = style.lineClamp !== '' && style.lineClamp !== 'none';
  if (clamped && style.overflowY !== 'visible') {
    return element.scrollHeight > element.clientHeight + OVERFLOW_TOLERANCE_PX;
  }
  if (style.textOverflow === 'ellipsis' && style.overflowX !== 'visible') {
    return element.scrollWidth > element.clientWidth + OVERFLOW_TOLERANCE_PX;
  }
  return false;
}

/**
 * El elemento recortado más cercano al que se apunta (él mismo o un ancestro cercano),
 * o `null` si no hay texto cortado ahí.
 */
export function findEllipsizedElement(
  start: Element | null,
  read: EllipsisStyleReader = readComputedEllipsisStyle,
): HTMLElement | null {
  if (start === null) return null;
  if (start.closest(`[${ELLIPSIS_TOOLTIP_OPT_OUT_ATTRIBUTE}]`) !== null) return null;
  if (start.closest(OWN_TOOLTIP_SELECTOR) !== null) return null;
  let node: Element | null = start;
  for (let depth = 0; node !== null && depth <= MAX_ANCESTOR_DEPTH; depth++) {
    if (node === node.ownerDocument.body) return null;
    if (!IGNORED_TAGS.has(node.tagName) && isEllipsized(node, read)) return node as HTMLElement;
    node = node.parentElement;
  }
  return null;
}

/** Texto completo del elemento recortado (su `title` si lo trae, si no su contenido). */
export function ellipsisTooltipText(element: Element): string | null {
  const raw = element.getAttribute('title') ?? element.getAttribute('data-ellipsis-title') ?? element.textContent ?? '';
  const text = raw.replace(/\s+/g, ' ').trim();
  if (text === '') return null;
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text;
}
