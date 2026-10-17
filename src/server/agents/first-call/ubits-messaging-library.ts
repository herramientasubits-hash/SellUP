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

export const UBITS_LIBRARY_VERSION = 'ubits-library-v2-draft';

/** Familias del menú de la plataforma UBITS (Workspace). */
export type UbitsProductFamily = 'seleccion' | 'aprendizaje' | 'desempeno_cultura' | 'herramientas';

export const UBITS_PRODUCT_FAMILY_LABELS: Readonly<Record<UbitsProductFamily, string>> = {
  seleccion: 'Selección',
  aprendizaje: 'Aprendizaje',
  desempeno_cultura: 'Desempeño y cultura',
  herramientas: 'Herramientas',
};

export interface UbitsProduct {
  key: string;
  /** Familia del menú de UBITS en la que vive. */
  family: UbitsProductFamily;
  name: string;
  /** Qué es, en una frase que se puede decir en voz alta. */
  pitch: string;
  /** Señales de la empresa que lo hacen pertinente. */
  fitsWhen: readonly string[];
}

/**
 * Los módulos tal como aparecen en el menú de la plataforma (16-10-2026):
 * Selección, Aprendizaje, Desempeño y cultura y Herramientas. «Créditos» (cobro de
 * Selección) no es algo que se ofrezca en una llamada y queda fuera.
 * Las frases son un BORRADOR a partir del nombre de cada módulo: la dueña las aprueba.
 */
export const UBITS_PRODUCTS: readonly UbitsProduct[] = [
  {
    key: 'seleccion_ai_insights',
    family: 'seleccion',
    name: 'AI Insights',
    pitch: 'Lectura con inteligencia artificial de los procesos de selección para priorizar a los candidatos con datos.',
    fitsWhen: ['muchas vacantes abiertas', 'contratación masiva', 'interés en IA aplicada a RR. HH.'],
  },
  {
    key: 'seleccion_vacantes',
    family: 'seleccion',
    name: 'Vacantes',
    pitch: 'Publicación y gestión de las vacantes en un solo lugar.',
    fitsWhen: ['muchas vacantes abiertas', 'aperturas de sedes, tiendas o plantas', 'alta rotación del sector'],
  },
  {
    key: 'seleccion_candidatos',
    family: 'seleccion',
    name: 'Mis candidatos',
    pitch: 'Seguimiento de los candidatos de cada vacante en un mismo tablero.',
    fitsWhen: ['procesos de selección con muchos candidatos', 'equipos de selección pequeños para el volumen'],
  },
  {
    key: 'aprendizaje_lms_creator',
    family: 'aprendizaje',
    name: 'LMS Creator',
    pitch: 'Para crear los cursos propios de la empresa dentro de la plataforma.',
    fitsWhen: ['academia o universidad corporativa propia', 'conocimiento técnico propio que hay que enseñar', 'procesos o productos que cambian seguido'],
  },
  {
    key: 'aprendizaje_planes',
    family: 'aprendizaje',
    name: 'Planes de Formación',
    pitch: 'Planes de formación por equipo o por rol, con el avance de cada persona.',
    fitsWhen: [
      'crecimiento o expansión que obliga a formar a mucha gente nueva',
      'integraciones, fusiones o adquisiciones',
      'inducción de muchos ingresos',
      'equipos distribuidos en varias sedes o países',
    ],
  },
  {
    key: 'aprendizaje_certificados',
    family: 'aprendizaje',
    name: 'Certificados',
    pitch: 'Certificados de los cursos y planes completados.',
    fitsWhen: ['sectores regulados con formación obligatoria', 'necesidad de demostrar cumplimiento'],
  },
  {
    key: 'aprendizaje_diagnostico',
    family: 'aprendizaje',
    name: 'Diagnóstico',
    pitch: 'Diagnóstico de las necesidades de formación de cada equipo antes de formarlo.',
    fitsWhen: ['no saben por dónde empezar a formar', 'cambios de procesos o transformación digital', 'procesos de promoción o sucesión'],
  },
  {
    key: 'aprendizaje_reportes',
    family: 'aprendizaje',
    name: 'Reportes',
    pitch: 'Reportes del avance de la formación por equipo, sede o persona.',
    fitsWhen: ['muchas sedes o países', 'necesidad de rendir cuentas de la inversión en formación'],
  },
  {
    key: 'aprendizaje_metricas',
    family: 'aprendizaje',
    name: 'Métricas',
    pitch: 'Métricas de uso y de resultados de la formación, sin armar archivos a mano.',
    fitsWhen: ['programas de formación grandes', 'interés en medir el impacto de la formación'],
  },
  {
    key: 'desempeno_360',
    family: 'desempeno_cultura',
    name: 'Evaluaciones 360',
    pitch: 'Evaluaciones 360 de desempeño y competencias.',
    fitsWhen: ['líderes nuevos o ascensos', 'cambios de liderazgo', 'cultura de retroalimentación'],
  },
  {
    key: 'desempeno_objetivos',
    family: 'desempeno_cultura',
    name: 'Objetivos',
    pitch: 'Objetivos por persona y por equipo, con su seguimiento.',
    fitsWhen: ['cultura de resultados o metas públicas', 'crecimiento de equipos que necesita seguimiento'],
  },
  {
    key: 'desempeno_matriz',
    family: 'desempeno_cultura',
    name: 'Matriz de talento',
    pitch: 'Matriz de desempeño y potencial para decidir sucesión y desarrollo.',
    fitsWhen: ['procesos de sucesión', 'crecimiento de mandos medios', 'fusiones o reorganizaciones'],
  },
  {
    key: 'desempeno_pdi',
    family: 'desempeno_cultura',
    name: 'PDI',
    pitch: 'Planes de desarrollo individual conectados con la evaluación de cada persona.',
    fitsWhen: ['retención del talento', 'programas de liderazgo', 'después de una evaluación de desempeño'],
  },
  {
    key: 'desempeno_encuestas',
    family: 'desempeno_cultura',
    name: 'Encuestas',
    pitch: 'Encuestas de clima y cultura para escuchar a los equipos.',
    fitsWhen: ['premios o rankings de clima laboral', 'integraciones o cambios grandes', 'alta rotación'],
  },
  {
    key: 'herramientas_tareas',
    family: 'herramientas',
    name: 'Tareas',
    pitch: 'Tareas asignadas y su seguimiento dentro de la misma plataforma.',
    fitsWhen: ['procesos de RR. HH. con muchos pasos manuales'],
  },
  {
    key: 'herramientas_avisos',
    family: 'herramientas',
    name: 'Avisos internos',
    pitch: 'Avisos internos para comunicar algo a toda la organización o a un equipo.',
    fitsWhen: ['muchas sedes o personal en terreno', 'integraciones o cambios que hay que comunicar'],
  },
];

/** Claves de la v1 (antes del menú): siguen guardadas en preparaciones viejas. */
const LEGACY_PRODUCT_NAMES: Readonly<Record<string, string>> = {
  learning: 'UBITS Learning',
  onboarding: 'Onboarding en plataforma',
  leadership: 'Formación de líderes',
  study_mode: 'Modo Estudio con IA',
  assessments: 'Assessments',
  performance: 'Desempeño',
  recruiting_ai: 'Reclutamiento con IA',
};

/** Nombre legible de un producto, también de los de la v1. `null` si no se conoce. */
export function ubitsProductName(key: string | null | undefined): string | null {
  if (!key) return null;
  return UBITS_PRODUCTS.find((p) => p.key === key)?.name ?? LEGACY_PRODUCT_NAMES[key] ?? null;
}

/** «a,b» (lo que guarda `product_focus`) → nombres legibles, sin claves desconocidas. */
export function ubitsProductNames(stored: string | null | undefined): string[] {
  return (stored ?? '')
    .split(',')
    .map((k) => ubitsProductName(k.trim()))
    .filter((n): n is string => n !== null);
}

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
  // Datos de la industria para el enfoque «Con un dato» (Manual del primer contacto, 17-10-2026).
  {
    key: 'linkedin_wlr_2025_skills',
    text: 'El 49 % de los líderes de talento dice que a su alta dirección le preocupa que la gente no tenga las habilidades para ejecutar la estrategia.',
    source: 'LinkedIn Workplace Learning Report 2025',
  },
  {
    key: 'linkedin_wlr_2025_retention',
    text: 'El 88 % de las organizaciones está preocupado por retener talento, y la formación es su principal estrategia para lograrlo.',
    source: 'LinkedIn Workplace Learning Report 2025',
  },
  {
    key: 'gartner_2026_hr_priorities',
    text: 'Las prioridades de los líderes de RR. HH. para 2026 son la IA en RR. HH., rediseñar el trabajo, llevar a los líderes a través del cambio y la cultura.',
    source: 'Gartner, prioridades de RR. HH. 2026',
  },
];

export interface UbitsOffer {
  key: string;
  /** Lo que se ofrece, en una frase («le comparto…», «le muestro…»). */
  text: string;
}

/**
 * Lo que el vendedor puede ofrecer para que la reunión valga la pena aunque no sigan
 * («se queda con…»). BORRADOR: la dueña confirma que cada oferta existe.
 */
export const UBITS_OFFERS: readonly UbitsOffer[] = [
  {
    key: 'diagnostic',
    text: 'Un diagnóstico rápido de las necesidades de formación de su equipo, con el módulo Diagnóstico de UBITS.',
  },
  {
    key: 'sector_demo',
    text: 'Una demo de 20 minutos con casos de su sector y de su momento (crecimiento, integración, líderes nuevos).',
  },
  {
    key: 'value_estimate',
    text: 'Una estimación del valor que recibiría frente a lo que invertiría, con la calculadora de UBITS.',
  },
];

export interface UbitsObjection {
  key: string;
  objection: string;
  response: string;
}

export const UBITS_OBJECTIONS: readonly UbitsObjection[] = [
  {
    key: 'not_interested',
    objection: 'No me interesa.',
    response:
      'Es justo. ¿Es porque ya tienen resuelta la formación de sus líderes o porque no es prioridad este trimestre? Si es lo segundo, ¿le escribo cuando planeen el presupuesto?',
  },
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

/**
 * Tratamiento en el primer contacto: «usted» en todos los países (Manual del primer
 * contacto). Se pasa a «tú» sólo cuando el comprador lo hace primero, ya en la conversación.
 */
export function addressFormFor(countryCode: string | null | undefined): 'tú' | 'usted' {
  void countryCode;
  return 'usted';
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
  // Manual del primer contacto (17-10-2026): falsa confianza, plantillas traducidas y exageraciones.
  'cómo ha estado',
  'como ha estado',
  'cómo has estado',
  'espero que este correo',
  'espero que se encuentre muy bien',
  'pregunta rápida',
  'revolucionaria',
  'revolucionario',
  'tiene 15 minutos',
  'tienes 15 minutos',
];

/** Texto de la biblioteca para las instrucciones del modelo (va en caché). */
export function renderLibraryForPrompt(): string {
  const products = UBITS_PRODUCTS.map(
    (p) =>
      `- ${p.key} | ${UBITS_PRODUCT_FAMILY_LABELS[p.family]} › ${p.name}: ${p.pitch} Encaja cuando: ${p.fitsWhen.join('; ')}.`,
  ).join('\n');
  const claims = UBITS_CLAIMS.map((c) => `- ${c.key}: «${c.text}» (fuente: ${c.source})`).join('\n');
  const offers = UBITS_OFFERS.map((o) => `- ${o.key}: ${o.text}`).join('\n');
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
    '',
    '# Lo que se puede ofrecer para la reunión (lo ÚNICO que se puede ofrecer)',
    offers,
  ].join('\n');
}
