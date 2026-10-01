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
 *   9. peso-a-mano     — `font-black` / `font-extrabold`.
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
};

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
    } else if (/\.(tsx|css)$/.test(name)) out.push(full);
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
  ? changedFiles().filter((f) => /^src\/.*\.(tsx|css)$/.test(f)).map((f) => join(ROOT, f))
  : walk(join(ROOT, "src"));

for (const full of targets) {
  const file = rel(full);
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
  });
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
