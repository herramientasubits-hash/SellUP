/**
 * Agente 3 · Primera llamada — biblioteca de mensajes de UBITS (v1, puro).
 *
 * Lo ÚNICO que el agente puede afirmar sobre UBITS. El modelo no inventa
 * productos, cifras ni respuestas a objeciones: las toma de aquí.
 *
 * Estado: BORRADOR v1, armado por el agente con lo que el repo ya documenta
 * (palancas de la calculadora de ROI, docs de estrategia 03/05/16). Falta la
 * aprobación de la dueña; mientras tanto no lleva cifras propias de UBITS:
 * la única cifra es un referente de industria con su fuente.
 *
 * Para cambiarla: editar este archivo en un PR (queda revisado y versionado).
 */

export const UBITS_LIBRARY_VERSION = 'ubits-library-v1-draft';

export interface UbitsProduct {
  key: string;
  name: string;
  /** Qué es, en una frase que se puede decir en voz alta. */
  pitch: string;
  /** Señales de la empresa que lo hacen pertinente. */
  fitsWhen: readonly string[];
}

export const UBITS_PRODUCTS: readonly UbitsProduct[] = [
  {
    key: 'learning',
    name: 'UBITS Learning',
    pitch:
      'Plataforma de formación corporativa con catálogo de cursos para líderes y por rol, rutas de aprendizaje y medición de avance.',
    fitsWhen: [
      'crecimiento o expansión que obliga a formar a mucha gente nueva',
      'equipos distribuidos en varias sedes o países',
      'transformación digital o cambio de procesos',
      'interés público en desarrollo, cultura o formación',
    ],
  },
  {
    key: 'onboarding',
    name: 'Onboarding en plataforma',
    pitch: 'Inducción estructurada dentro de la plataforma para que cada ingreso llegue listo sin depender del equipo de RR. HH.',
    fitsWhen: ['contratación masiva o muchas vacantes abiertas', 'aperturas de tiendas, plantas o sedes', 'alta rotación del sector'],
  },
  {
    key: 'leadership',
    name: 'Formación de líderes',
    pitch: 'Catálogo de liderazgo para que los jefes nuevos y actuales desarrollen las mismas competencias.',
    fitsWhen: ['ascensos o crecimiento de mandos medios', 'cambios de liderazgo', 'fusiones o reorganizaciones'],
  },
  {
    key: 'study_mode',
    name: 'Modo Estudio con IA',
    pitch: 'Asistente de estudio con inteligencia artificial que acompaña a cada persona mientras aprende.',
    fitsWhen: ['interés en IA o en productividad', 'equipos con poco tiempo para formarse'],
  },
  {
    key: 'assessments',
    name: 'Assessments',
    pitch: 'Evaluaciones de competencias para saber dónde está cada equipo antes y después de formarlo.',
    fitsWhen: ['necesidad de medir competencias', 'procesos de promoción o sucesión'],
  },
  {
    key: 'performance',
    name: 'Desempeño',
    pitch: 'Gestión del desempeño para conectar objetivos, evaluaciones y planes de desarrollo.',
    fitsWhen: ['cultura de resultados o metas públicas', 'crecimiento de equipos que necesita seguimiento'],
  },
  {
    key: 'recruiting_ai',
    name: 'Reclutamiento con IA',
    pitch: 'Selección apoyada en inteligencia artificial para filtrar y priorizar candidatos más rápido.',
    fitsWhen: ['muchas vacantes abiertas', 'contratación masiva', 'aperturas de sedes'],
  },
];

export interface UbitsClaim {
  key: string;
  /** La afirmación exacta que se puede usar. */
  text: string;
  /** De dónde sale. Sin fuente no hay afirmación. */
  source: string;
}

/**
 * Afirmaciones con fuente. Las cifras que el guion use tienen que salir de aquí
 * o de un hecho de la ficha; el verificador lo comprueba.
 */
export const UBITS_CLAIMS: readonly UbitsClaim[] = [
  {
    key: 'industry_elearning_minutes',
    text: 'El promedio de la industria es de 21 minutos de e-learning por persona al mes.',
    source: 'ATD State of the Industry 2026',
  },
  {
    key: 'measurable_value',
    text: 'Al cierre del año se puede repetir el cálculo de valor con los datos reales de uso del cliente.',
    source: 'Calculadora de ROI de UBITS (guion de venta)',
  },
];

export interface UbitsObjection {
  key: string;
  objection: string;
  response: string;
}

export const UBITS_OBJECTIONS: readonly UbitsObjection[] = [
  {
    key: 'send_info',
    objection: 'Mándame información.',
    response:
      'Con gusto. Para no mandarle algo genérico, ¿me cuenta en un minuto cuál es hoy el reto principal con la formación de su equipo? Así le envío solo lo que le sirve y, si tiene sentido, lo vemos 20 minutos.',
  },
  {
    key: 'have_provider',
    objection: 'Ya tenemos proveedor.',
    response:
      'Tiene sentido, la mayoría de empresas de su tamaño ya tiene algo. No busco reemplazarlo hoy: ¿qué es lo que más le gustaría mejorar de lo que tienen? Si hay algo ahí, le muestro cómo lo resolvemos y usted compara.',
  },
  {
    key: 'not_priority',
    objection: 'No es prioridad ahora.',
    response:
      'Entiendo. ¿Qué tendría que pasar para que lo fuera? Si me dice cuándo planean el presupuesto de formación, le escribo en ese momento con algo concreto.',
  },
  {
    key: 'no_budget',
    objection: 'No tenemos presupuesto.',
    response:
      'Lo entiendo. Justamente por eso vale la pena ver con números cuánto valor recibiría frente a lo que invertiría; si no da, no le hago perder tiempo. ¿Lo revisamos 20 minutos?',
  },
  {
    key: 'internal_platform',
    objection: 'Tenemos una plataforma propia.',
    response:
      'Muy bien. ¿Qué tal les va con el contenido y con que la gente lo use? Muchas empresas con plataforma propia nos usan para el catálogo y la medición, sin cambiar lo que ya tienen.',
  },
  {
    key: 'wrong_person',
    objection: 'No soy la persona indicada.',
    response:
      'Gracias por decírmelo. ¿Quién lleva hoy la formación o el desarrollo del equipo? Me ayuda mucho saber a quién dirigirme.',
  },
  {
    key: 'call_later',
    objection: 'Llámame más adelante.',
    response: 'Claro. ¿Le parece si lo agendamos ya, para no interrumpirlo de nuevo? ¿Qué día de la próxima semana le queda mejor?',
  },
];

/** Cómo se adapta el enfoque según el cargo del decisor. */
export const ROLE_GUIDANCE: readonly { match: RegExp; focus: string }[] = [
  {
    match: /\b(ceo|gerente general|director general|presidente|country manager|managing director|dueñ[oa]|fundador)/i,
    focus: 'Habla de crecimiento, productividad y de que la gente nueva rinda rápido. Sé breve y ejecutivo.',
  },
  {
    match: /\b(chro|vp|vicepresident|director[a]? de (talento|recursos humanos|rr\.? ?hh|gente|personas|people|capital humano))/i,
    focus: 'Habla de estrategia de talento: retención, cultura, líderes y cómo medir el impacto de la formación.',
  },
  {
    match: /\b(formaci[oó]n|capacitaci[oó]n|aprendizaje|learning|l&d|desarrollo|entrenamiento|universidad corporativa|academia)/i,
    focus: 'Habla de lo operativo: catálogo, adopción, onboarding y cómo medir avance sin trabajo manual.',
  },
  {
    match: /\b(selecci[oó]n|reclutamiento|talent acquisition|atracci[oó]n|recruit)/i,
    focus: 'Habla de vacantes, tiempo de contratación y de que cada ingreso llegue listo.',
  },
  {
    match: /\b(recursos humanos|rr\.? ?hh|talento|gente|personas|people|capital humano|bienestar|cultura)/i,
    focus: 'Habla de los retos de talento de la empresa: crecimiento, rotación, formación y cultura.',
  },
];

export const DEFAULT_ROLE_FOCUS =
  'No conocemos bien su cargo: abre con la señal de la empresa y pregunta quién lleva la formación del equipo.';

export function roleFocusFor(title: string | null | undefined): string {
  if (!title) return DEFAULT_ROLE_FOCUS;
  return ROLE_GUIDANCE.find((rule) => rule.match.test(title))?.focus ?? DEFAULT_ROLE_FOCUS;
}

/** Tratamiento por país. «usted» por defecto en B2B; tuteo donde es lo habitual. */
const TU_COUNTRIES = new Set(['MX', 'CL', 'ES']);

export function addressFormFor(countryCode: string | null | undefined): 'tú' | 'usted' {
  return countryCode && TU_COUNTRIES.has(countryCode.toUpperCase()) ? 'tú' : 'usted';
}

/** Frases que el guion no puede usar (bajan el éxito o prometen de más). */
export const BANNED_PHRASES: readonly string[] = [
  'te agarro en mal momento',
  'lo agarro en mal momento',
  'mal momento',
  'tiene un minuto',
  'tienes un minuto',
  'le garantizo',
  'te garantizo',
  'garantizado',
  '100%',
  'líder del mercado',
  'número uno',
  'el mejor del mercado',
];

/** Texto de la biblioteca para las instrucciones del modelo (va en caché). */
export function renderLibraryForPrompt(): string {
  const products = UBITS_PRODUCTS.map(
    (p) => `- ${p.key} | ${p.name}: ${p.pitch} Encaja cuando: ${p.fitsWhen.join('; ')}.`,
  ).join('\n');
  const claims = UBITS_CLAIMS.map((c) => `- ${c.key}: «${c.text}» (fuente: ${c.source})`).join('\n');
  const objections = UBITS_OBJECTIONS.map((o) => `- ${o.key} | «${o.objection}» → ${o.response}`).join('\n');
  return [
    `# Productos de UBITS (${UBITS_LIBRARY_VERSION})`,
    products,
    '',
    '# Afirmaciones permitidas sobre UBITS (las ÚNICAS cifras de UBITS que puedes usar)',
    claims,
    '',
    '# Objeciones y respuestas aprobadas (adáptalas al contexto, no inventes otras promesas)',
    objections,
  ].join('\n');
}
