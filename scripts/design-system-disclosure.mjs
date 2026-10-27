/**
 * Regla `desplegable-de-golpe` del sistema de diseño (movimiento de flux-ui).
 *
 * Lo que se abre, se pliega o se despliega anima su altura con `Collapsible`
 * (`@/components/ui/collapsible`) y su flecha gira. Esta detección encuentra lo
 * que vuelve a aparecer de golpe:
 *
 *   · flecha-que-salta    — un ternario que cambia de flecha (`? <ChevronUp/> : <ChevronDown/>`)
 *                           o la flecha que se esconde con `group-aria-expanded…:hidden`;
 *   · desplegable-de-golpe — junto a un `aria-expanded={x}`, el contenido se monta con
 *                           `{x && …}` o se esconde con `hidden={x}`;
 *   · details-a-mano      — un `<details>` (no anima: es `Collapsible`).
 *
 * Es puro (texto → hallazgos) para que lo use `check-design-system.mjs` y lo
 * prueben sus tests sin tocar el disco.
 */

const CHEVRON_SWAP = /\?\s*<(Chevron(?:Up|Down|Right|Left))\b[^>]*\/>\s*:\s*<(Chevron(?:Up|Down|Right|Left))\b/g;
const CHEVRON_HIDE = /group-aria-expanded[^"'`\s]*:hidden/g;
const DETAILS = /<details\b/g;
const ARIA_EXPANDED = /aria-expanded=\{\s*!?\s*([\w.]+)\s*\}/g;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|\{\/\*)/;

const escape = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * @param {string} text Contenido de un `.tsx`.
 * @returns {{ line: number, rule: string, message: string }[]}
 */
export function findDisclosureIssues(text) {
  const lines = text.split("\n");
  const lineOf = (index) => text.slice(0, index).split("\n").length;
  const inComment = (index) => COMMENT_LINE.test(lines[lineOf(index) - 1] ?? "");
  const issues = [];
  const add = (index, rule, message) => {
    if (!inComment(index)) issues.push({ line: lineOf(index), rule, message });
  };

  for (const match of text.matchAll(CHEVRON_SWAP)) {
    add(match.index, "flecha-que-salta", `La flecha cambia de dibujo (${match[1]} ↔ ${match[2]}). Usa una sola que gira: transition-transform duration-200 + rotate-180.`);
  }
  for (const match of text.matchAll(CHEVRON_HIDE)) {
    add(match.index, "flecha-que-salta", "La flecha se esconde y aparece otra. Usa una sola que gira: transition-transform duration-200 + rotate-180.");
  }
  for (const match of text.matchAll(DETAILS)) {
    add(match.index, "details-a-mano", "<details> no anima al abrir ni al cerrar. Usa Collapsible de @/components/ui/collapsible.");
  }

  const ids = new Set();
  for (const match of text.matchAll(ARIA_EXPANDED)) {
    if (match[1] !== "true" && match[1] !== "false") ids.add(match[1]);
  }
  for (const id of ids) {
    const name = escape(id);
    const mount = new RegExp(`\\{\\s*!?\\s*${name}\\s*&&\\s*[(<]`, "g");
    const hidden = new RegExp(`hidden=\\{\\s*!?\\s*${name}\\s*\\}`, "g");
    for (const match of text.matchAll(mount)) {
      add(match.index, "desplegable-de-golpe", `El contenido de «${id}» se monta de golpe ({${id} && …}). Usa Collapsible: anima la altura al abrir y al cerrar.`);
    }
    for (const match of text.matchAll(hidden)) {
      add(match.index, "desplegable-de-golpe", `El contenido de «${id}» se esconde de golpe (hidden={${id}}). Usa Collapsible con keepMounted si debe quedar montado.`);
    }
  }

  return issues.sort((a, b) => a.line - b.line);
}
