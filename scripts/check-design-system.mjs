#!/usr/bin/env node
/**
 * Reglas del sistema de diseño (tema Azul de Thema), aplicadas al código.
 *
 *   node scripts/check-design-system.mjs            # todo src/
 *   node scripts/check-design-system.mjs --changed  # solo lo cambiado respecto a main
 *   node scripts/check-design-system.mjs --summary  # conteo por regla, sin el detalle
 *
 * Portado de `scripts/check-design-system.mjs` del repo Thema y adaptado a SellUp
 * (Next.js, Tailwind v4, Base UI). Falla (salida 1) si en la UI aparece:
 *
 *   1. libreria-ajena  — otra librería de interfaz o iconos (MUI, Chakra, Ant, Heroicons…),
 *                        o un primitivo headless importado fuera de `src/components/ui`;
 *   2. color-a-mano    — un color literal (hex / rgb / hsl / oklch) fuera de los tokens;
 *   3. paleta-cruda    — la paleta cruda de Tailwind (`bg-blue-500`, `text-emerald-600`…);
 *   4. letra-a-mano    — un tamaño de letra fijado (`text-[13px]`);
 *   5. z-a-mano        — un z-index arbitrario (`z-[999]`) en pantallas;
 *   6. sombra-a-mano   — `shadow-xl`, `shadow-2xl` o una sombra arbitraria (`shadow-[…]`);
 *   7. radio-a-mano    — un radio arbitrario (`rounded-[…px]`);
 *   8. overline        — un rótulo en MAYÚSCULAS con tracking (Thema usa caja normal);
 *   9. peso-a-mano     — `font-black` / `font-extrabold`;
 *  10. marca-heredada  — clases `*-su-brand` (el primario es `bg-primary` / `text-primary`);
 *  11. texto-atenuado  — texto atenuado con opacidad (`text-muted-foreground/60`): se elige el nivel;
 *  12. blanco-a-mano   — `text-white` sobre color de marca (usa `text-primary-foreground`);
 *  13. control-a-mano  — un `Button` / `Input` / `SelectTrigger` / `Badge` con radio, alto o
 *                        tipografía sobrescritos por `className` (usa `size` y `variant`);
 *  14. tabla-a-mano    — una tabla HTML escrita a mano (`<table>`, `<thead>`, `<tbody>`, `<tfoot>`,
 *                        `<tr>`, `<th>`, `<td>`) en un `.tsx`: se pinta con `Table`, `TableHeader`,
 *                        `TableBody`, `TableRow`, `TableHead`, `TableCell` de `@/components/ui/table`
 *                        (y `TableShell` de `@/components/data-display` si la lista lleva título).
 *  15. fecha-sin-zona  — una fecha pintada con `toLocaleDateString(` / `toLocaleTimeString(`: usan la
 *                        zona de quien pinta, y servidor (UTC) y navegador escriben días distintos
 *                        (error de hidratación #418). Se formatea con `formatInAppZone`,
 *                        `formatAppDate`, `formatAppDateTime` o `formatAppTime` de `@/lib/format-date`.
 *
 * Una excepción se declara en ALLOW, con su motivo; nunca apagando la regla en el archivo.
 * Guía de traducción: docs/THEMA_AZUL_MIGRATION.md
 */
import { execSync } from "node:child_process";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = process.cwd();
const args = new Set(process.argv.slice(2));
const CHANGED_ONLY = args.has("--changed");
const SUMMARY = args.has("--summary");

const FOREIGN_UI = [
  /from\s+["'](@mui\/|@chakra-ui\/|antd|@ant-design\/|@mantine\/|@headlessui\/|react-bootstrap|@nextui|@heroui|primereact|@fluentui|semantic-ui-react)/,
  /from\s+["'](react-icons|@heroicons\/|@tabler\/icons|@fortawesome\/|phosphor-react|@phosphor-icons\/|iconoir-react|@iconify\/)/,
];
/** Los iconos salen de `@/icons` (Hugeicons, la familia de Thema); solo ese módulo importa la librería. */
const ICON_LIB = /from\s+["'](lucide-react|@hugeicons\/)/;
/** Los primitivos headless solo se envuelven una vez, en `src/components/ui`. */
const HEADLESS = /from\s+["'](@radix-ui\/react-|@base-ui\/react|radix-ui["'])/;

// `var(--x)` dentro de la función es una referencia a un token, no un color a mano.
const RAW_COLOR =
  /(#[0-9a-fA-F]{3,8}\b|\brgba?\((?!\s*(var\(|from\b))|\bhsla?\((?!\s*(var\(|from\b))|\boklch\((?!\s*(var\(|from\b)))/;
const RAW_PALETTE =
  /(?<![\w-])(?:bg|text|border|ring|fill|stroke|from|to|via|divide|outline|shadow|decoration|caret|accent|placeholder)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(?:50|100|200|300|400|500|600|700|800|900|950)\b/;
const RAW_FONT_SIZE = /(?<![\w-])text-\[\d+(?:\.\d+)?(?:px|rem|em)\]/;
const RAW_Z = /(?<![\w-])z-\[\d+\]/;
const RAW_SHADOW = /(?<![\w-])shadow-(?:xl|2xl|\[)/;
const RAW_RADIUS = /(?<![\w-])rounded(?:-[trblse]{1,2})?-\[\d/;
const OVERLINE = /(?<![\w-])uppercase(?![\w-])[^"'`]*tracking-(?:wide|wider|widest|\[)|tracking-(?:wide|wider|widest|\[)[^"'`]*(?<![\w-])uppercase(?![\w-])/;
const RAW_WEIGHT = /(?<![\w-])font-(?:black|extrabold)(?![\w-])/;
const LEGACY_BRAND = /(?<![\w-])(?:bg|text|border|ring|from|to|via|fill|stroke)-su-brand(?!-foreground)/;
const FADED_TEXT = /(?<![\w-])text-(?:foreground|muted-foreground)\/\[?\d/;
const RAW_WHITE = /(?<![\w-])text-white(?![\w/-])/;
/** Etiqueta de apertura de un control del sistema, con sus atributos (admite varias líneas). */
const CONTROL_TAG = /<(Button|Input|SelectTrigger|Textarea|Badge)\b((?:[^<>{}]|\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\})*?)\/?>/g;
const CONTROL_RADIUS = /(?<![\w:\[-])!?rounded-(?:full|xl|lg|2xl|3xl|none)(?![\w-])/;
const CONTROL_HEIGHT = /(?<![\w:\[-])!?h-(?:5|6|7|8|9|10|11|12|14)(?![\w./-])/;
const BADGE_TYPE = /(?<![\w:\[-])(?:text-(?:xs|sm)|font-(?:medium|semibold|bold)|rounded-(?:full|sm|lg))(?![\w/-])/;
/** Etiqueta de tabla HTML nativa (apertura o cierre), en JSX. */
const RAW_TABLE = /<\/?(?:table|thead|tbody|tfoot|tr|th|td)(?=[\s>\/])/;
/** Fecha u hora formateada con la zona de quien la pinta (servidor ≠ navegador). */
const RAW_DATE = /\.toLocale(?:Date|Time)String\(/;

/**
 * Dónde sí puede vivir cada excepción, y por qué.
 *
 * - `globals.css`: es la fuente de los tokens; ahí el color literal es el dato.
 * - `login-brand-panel.tsx`: panel de marca del login, único contexto editorial
 *   (AGENTS.md › Prohibited Patterns › Allowed exception).
 * - `components/charts`: los gráficos pintan con colores ya resueltos.
 * - `components/ui`: los primitivos fijan su propia escala pequeña (11–13px) y
 *   sus capas, igual que en Thema; es el único sitio que importa el headless.
 * - `ai-orb.tsx` / `agent-chat-orb.tsx` / `import-loading-overlay.tsx`: la
 *   identidad de IA es un degradado decorativo propio; no es color de interfaz.
 * - `google-sign-in-button.tsx`: dibuja el logotipo de Google; una marca de
 *   terceros no puede repintarse con los tokens del tema.
 * - tests: fijan cadenas a propósito.
 */
const TESTS = /(__tests__\/|\.test\.(ts|tsx|mts)$)/;
const EDITORIAL = [/^src\/modules\/auth\/components\/login-brand-panel\.tsx$/];
const AI_IDENTITY = [
  /^src\/components\/prospect-batches\/chat-wizard\/ai-orb\.tsx$/,
  /^src\/components\/agent-chat\/agent-chat-orb\.tsx$/,
  /^src\/modules\/auth\/components\/google-sign-in-button\.tsx$/,
  /^src\/components\/prospect-batches\/import-loading-overlay\.tsx$/,
];
const ALLOW = {
  headless: [/^src\/components\/ui\//, TESTS],
  color: [/\.css$/, /^src\/components\/charts\//, TESTS, ...EDITORIAL, ...AI_IDENTITY],
  palette: [TESTS, ...EDITORIAL],
  fontSize: [/^src\/components\/ui\//, TESTS, ...EDITORIAL],
  z: [/^src\/components\//, TESTS],
  shadow: [TESTS, ...EDITORIAL, ...AI_IDENTITY],
  radius: [/^src\/components\/ui\//, TESTS, ...EDITORIAL],
  overline: [TESTS, ...EDITORIAL],
  weight: [TESTS, ...EDITORIAL],
  // `wizard-admin-tavily-trial-toggle`: una prueba de runtime fija la cadena `su-brand`.
  legacyBrand: [/^src\/components\/ui\//, TESTS, ...EDITORIAL, /wizard-admin-tavily-trial-toggle\.tsx$/],
  faded: [/^src\/components\/ui\//, TESTS, ...EDITORIAL],
  // Sobre el degradado de IA y los velos de carga a pantalla completa el texto es blanco por identidad.
  white: [/^src\/components\/ui\//, TESTS, ...EDITORIAL, ...AI_IDENTITY, /chat-wizard\/wizard-(execution-panels|lusha-final-search)\.tsx$/],
  // `candidate-search-more-phones-cta`: una prueba estática fija `className="h-7 gap-1.5 text-xs"`.
  control: [/^src\/components\/ui\//, TESTS, ...EDITORIAL, /candidate-search-more-phones-cta\.tsx$/],
  // `ui/table.tsx` ES la pieza que pinta la tabla; `ui/calendar.tsx` rellena la rejilla de
  // react-day-picker (que ya es un `<table>`); `data-table/` monta la tabla operable de TanStack
  // (la cabecera reordenable necesita su propio `<th>` con ref y estilos de arrastre).
  table: [/^src\/components\/ui\/(table|calendar)\.tsx$/, /^src\/components\/data-table\//, TESTS],
  // `lib/format-date.ts` ES la pieza que fija la zona. `ui/calendar.tsx` y `components/date/` son el
  // selector de fechas: trabajan a propósito con el día local de quien elige. `app/api/` y los
  // `actions.ts` de `modules/` corren solo en servidor y escriben nombres de lote que se guardan,
  // no texto que se hidrata. `prospect-date-utils.ts` y `provider-contract-plan-card.tsx` ya pasan
  // un `timeZone` explícito (Bogotá; y UTC para un día de calendario sin hora).
  date: [
    /^src\/lib\/format-date\.ts$/,
    /^src\/components\/ui\/calendar\.tsx$/,
    /^src\/components\/date\//,
    /^src\/app\/api\//,
    /^src\/modules\/.*\/actions\.ts$/,
    /^src\/modules\/prospect-batches\/prospect-date-utils\.ts$/,
    /^src\/app\/\(sellup\)\/settings\/providers\/provider-contract-plan-card\.tsx$/,
    TESTS,
  ],
};

/**
 * El badge «Nuevo» comparte una cadena exacta entre Agente 1 y Agente 2A, fijada
 * por `contact-candidate-new-badge-static.test.ts`. Es la única tipografía propia
 * que se admite en un `Badge`.
 */
const PINNED_NEW_BADGE = "border-0 bg-success/10 text-success text-xs font-semibold px-1.5 py-0.5 shrink-0";

const findings = [];
const add = (file, line, rule, message) => findings.push({ file, line, rule, message });
const allowed = (file, list) => list.some((re) => re.test(file));

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(full, out);
    } else if (/\.(tsx|ts|css)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

function git(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
}

function changedFiles() {
  const base = git("git rev-parse --verify origin/main") ? "origin/main" : git("git rev-parse --verify main") ? "main" : "";
  const diff = base ? git(`git diff --name-only ${base}...HEAD`) : "";
  const working = git("git status --porcelain").split("\n").filter(Boolean).map((l) => l.slice(3).trim());
  return [...new Set([...diff.split("\n"), ...working].filter(Boolean))];
}

const rel = (f) => relative(ROOT, f).split(sep).join("/");
const targets = CHANGED_ONLY
  ? changedFiles().filter((f) => /^src\/.*\.(tsx|ts|css)$/.test(f)).map((f) => join(ROOT, f))
  : walk(join(ROOT, "src"));

for (const full of targets) {
  const file = rel(full);
  // Solo UI: los .ts de servidor, agentes y datos no llevan clases de estilo.
  if (file.endsWith(".ts") && !/^src\/(components|app|modules|config|lib)\//.test(file)) continue;
  let text;
  try {
    text = readFileSync(full, "utf8");
  } catch {
    continue;
  }
  const isCss = file.endsWith(".css");
  text.split("\n").forEach((line, i) => {
    const n = i + 1;
    const isComment = /^\s*(\/\/|\*|\/\*|\{\/\*)/.test(line);
    if (isCss) return;
    if (FOREIGN_UI.some((re) => re.test(line))) add(file, n, "libreria-ajena", "Otra librería de interfaz o iconos. Todo sale de @/components y lucide-react.");
    if (!/^src\/icons\//.test(file) && !TESTS.test(file) && ICON_LIB.test(line)) add(file, n, "libreria-ajena", "Icono importado de la librería. Pídelo a @/icons, que es quien decide el dibujo.");
    if (!allowed(file, ALLOW.headless) && HEADLESS.test(line)) add(file, n, "libreria-ajena", "Primitivo headless importado fuera de src/components/ui. Usa el componente de @/components/ui.");
    if (isComment) return;
    if (!allowed(file, ALLOW.color) && RAW_COLOR.test(line)) add(file, n, "color-a-mano", `Color escrito a mano (${line.match(RAW_COLOR)[0]}). Usa una clase del tema.`);
    if (!allowed(file, ALLOW.palette) && RAW_PALETTE.test(line)) add(file, n, "paleta-cruda", `Paleta cruda de Tailwind (${line.match(RAW_PALETTE)[0]}). Usa el token semántico.`);
    if (!allowed(file, ALLOW.fontSize) && RAW_FONT_SIZE.test(line)) add(file, n, "letra-a-mano", `Tamaño de letra fijado (${line.match(RAW_FONT_SIZE)[0]}). Usa la escala (text-xs, text-sm…).`);
    if (!allowed(file, ALLOW.z) && RAW_Z.test(line)) add(file, n, "z-a-mano", `z-index a mano (${line.match(RAW_Z)[0]}). Usa una capa del tema (z-popover, z-dialog…).`);
    if (!allowed(file, ALLOW.shadow) && RAW_SHADOW.test(line)) add(file, n, "sombra-a-mano", "Sombra fuera del sistema. Usa shadow-card, shadow-drawer o shadow-rail.");
    if (!allowed(file, ALLOW.radius) && RAW_RADIUS.test(line)) add(file, n, "radio-a-mano", "Radio arbitrario. Usa la escala (rounded-md … rounded-2xl).");
    if (!allowed(file, ALLOW.overline) && OVERLINE.test(line)) add(file, n, "overline", "Rótulo en mayúsculas con tracking. Thema usa caja normal: text-xs font-semibold text-muted-foreground.");
    if (!allowed(file, ALLOW.weight) && RAW_WEIGHT.test(line)) add(file, n, "peso-a-mano", "font-black / font-extrabold. El máximo es font-bold; títulos internos, font-semibold.");
    if (!allowed(file, ALLOW.legacyBrand) && LEGACY_BRAND.test(line)) add(file, n, "marca-heredada", `Clase heredada (${line.match(LEGACY_BRAND)[0]}). Usa bg-primary / text-primary / bg-primary/10.`);
    if (!allowed(file, ALLOW.faded) && FADED_TEXT.test(line)) add(file, n, "texto-atenuado", "Texto atenuado con opacidad. Elige el nivel: text-foreground, text-muted-foreground o text-text-muted.");
    if (!allowed(file, ALLOW.white) && RAW_WHITE.test(line) && !/su-ai-/.test(line)) add(file, n, "blanco-a-mano", "text-white a mano. Sobre primario usa text-primary-foreground; para un sólido de estado, la variante del Button.");
    if (!allowed(file, ALLOW.date) && RAW_DATE.test(line)) add(file, n, "fecha-sin-zona", `Fecha sin zona fija (${line.match(RAW_DATE)[0]}…). Usa formatInAppZone / formatAppDate / formatAppDateTime de @/lib/format-date.`);
    if (file.endsWith(".tsx") && !allowed(file, ALLOW.table) && RAW_TABLE.test(line)) add(file, n, "tabla-a-mano", `Tabla escrita a mano (${line.match(RAW_TABLE)[0]}>). Usa Table, TableHeader, TableBody, TableRow, TableHead y TableCell de @/components/ui/table.`);
  });

  // Controles del sistema con su apariencia sobrescrita por className.
  if (!isCss && !allowed(file, ALLOW.control)) {
    for (const match of text.matchAll(CONTROL_TAG)) {
      const [, name, attrs] = match;
      const cls = attrs.match(/className="([^"]*)"/)?.[1] ?? attrs.match(/className=\{`([^`]*)`\}/)?.[1];
      if (!cls || /su-ai-/.test(cls)) continue;
      const n = text.slice(0, match.index).split("\n").length;
      if (name === "Badge") {
        if (cls.includes(PINNED_NEW_BADGE)) continue;
        if (BADGE_TYPE.test(cls)) add(file, n, "control-a-mano", `Badge con tipografía o radio propios (${cls.match(BADGE_TYPE)[0]}). El Badge ya trae su escala; usa una variante.`);
        continue;
      }
      if (name !== "Textarea" && CONTROL_RADIUS.test(cls)) add(file, n, "control-a-mano", `${name} con radio propio (${cls.match(CONTROL_RADIUS)[0]}). El radio lo pone el sistema.`);
      if (name !== "Textarea" && CONTROL_HEIGHT.test(cls) && !/(?<![\w-])w-(?:5|6|7|8|9|10|11|12|14)(?![\w-])/.test(cls)) add(file, n, "control-a-mano", `${name} con alto propio (${cls.match(CONTROL_HEIGHT)[0]}). Usa size="xs" | "sm" (Input: inputSize="sm").`);
    }
  }
}

const byRule = new Map();
for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);

if (!SUMMARY) {
  const byFile = new Map();
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f]);
  for (const [file, list] of [...byFile.entries()].sort()) {
    console.log(`\n${file}`);
    for (const f of list) console.log(`  ✖ L${f.line} [${f.rule}] ${f.message}`);
  }
}
console.log("");
for (const [rule, count] of [...byRule.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(count).padStart(5)}  ${rule}`);
console.log(`\ncheck: ${findings.length} hallazgo(s) en ${new Set(findings.map((f) => f.file)).size} archivo(s) de ${targets.length} revisados${CHANGED_ONLY ? " (cambiados)" : ""}.`);
process.exit(findings.length ? 1 : 0);
