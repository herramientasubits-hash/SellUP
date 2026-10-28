/**
 * Regla `voz-rumbo` del sistema de diseño: la IA de SellUp se llama «Rumbo» (o
 * «la IA»). En lo que ve quien prospecta no aparece el modelo que hay detrás
 * (Claude, Anthropic, GPT): el 27-10 la búsqueda decía «Claude está revisando…»
 * aunque #799 ya había fijado una sola voz.
 *
 * Mira las líneas que no son comentario ni `console.*`. Una línea de código con
 * el nombre (un import, un tipo) también cuenta: en estas carpetas el nombre del
 * modelo vive en `claude-*` en minúscula, nunca como texto.
 *
 * Es puro (texto → hallazgos) para que lo use `check-design-system.mjs` y lo
 * prueben sus tests sin tocar el disco.
 */

const AI_NAME = /\b(Claude|Anthropic|GPT)\b/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*|\{\/\*)/;
const CONSOLE_LINE = /\bconsole\.(log|info|warn|error|debug)\(/;

/** Carpetas que ve quien prospecta (Agente 1, el asistente, Growth y el Centro de procesos). */
export const VOICE_SCOPE = [
  /^src\/components\/prospect-batches\//,
  /^src\/modules\/prospect-batches\//,
  /^src\/components\/prospects\//,
  /^src\/components\/growth\//,
  /^src\/app\/\(sellup\)\/(prospect-batches|growth)\//,
];

/**
 * @param {string} text Contenido de un `.ts` / `.tsx`.
 * @returns {{ line: number, rule: string, message: string }[]}
 */
export function findVoiceIssues(text) {
  const issues = [];
  let inBlock = false;
  text.split("\n").forEach((line, i) => {
    // Comentarios de varias líneas (`/* … */`, también el `{/* … */}` de JSX).
    const wasInBlock = inBlock;
    const open = line.lastIndexOf("/*");
    const close = line.lastIndexOf("*/");
    if (open > close) inBlock = true;
    else if (close !== -1) inBlock = false;
    if (wasInBlock || COMMENT_LINE.test(line) || CONSOLE_LINE.test(line)) return;
    const match = line.match(AI_NAME);
    if (!match) return;
    issues.push({
      line: i + 1,
      rule: "voz-rumbo",
      message: `La IA aparece como «${match[1]}». En SellUp se llama «Rumbo» o «la IA».`,
    });
  });
  return issues;
}
