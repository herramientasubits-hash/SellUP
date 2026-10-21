/**
 * Agente 3 · Primera llamada — biblioteca de mensajes de UBITS (v1, puro).
 *
 * Lo ÚNICO que el agente puede afirmar sobre UBITS. El modelo no inventa
 * productos, cifras ni respuestas a objeciones: las toma de aquí.
 *
 * Estado: BORRADOR v3. Los productos, los temas del catálogo y la tabla de señales salen de
 * la documentación de producto de UBITS en Confluence (18-10-2026; inventario en
 * docs/UBITS_PORTAFOLIO_PARA_AGENTE3.md). Falta la aprobación de la dueña. Sin nombres de
 * cursos: el catálogo vigente no está en Confluence y un nombre viejo sería un curso inventado.
 *
 * Para cambiarla: editar este archivo en un PR (queda revisado y versionado).
 */

export const UBITS_LIBRARY_VERSION = 'ubits-library-v3-draft';

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
  /** Lo que no se puede prometer de este producto (plan, créditos, disponibilidad). */
  caution?: string;
}

/**
 * Los módulos tal como aparecen en el menú de la plataforma (16-10-2026):
 * Selección, Aprendizaje, Desempeño y cultura y Herramientas, más lo que la documentación de
 * producto describe dentro de cada familia (Confluence, 18-10-2026). «Créditos» (cobro de
 * Selección) no es algo que se ofrezca en una llamada y queda fuera. Lo que está «en
 * desarrollo» (Agente de Idiomas, Hunter, bolsa de candidatos, SAP SuccessFactors) tampoco.
 */
export const UBITS_PRODUCTS: readonly UbitsProduct[] = [
  {
    key: 'seleccion_ai_insights',
    family: 'seleccion',
    name: 'AI Insights',
    pitch: 'Evaluación de las hojas de vida con inteligencia artificial para priorizar a los candidatos con datos.',
    fitsWhen: ['muchas vacantes abiertas', 'contratación masiva', 'interés en IA aplicada a RR. HH.'],
  },
  {
    key: 'seleccion_roleplay',
    family: 'seleccion',
    name: 'Agente Roleplay',
    pitch: 'Una llamada simulada con IA que pone al candidato en una situación del cargo (manejo de objeciones, persuasión, escucha) y le da una calificación comparable entre candidatos.',
    fitsWhen: ['contratación de vendedores o de atención al cliente', 'muchas vacantes del mismo perfil', 'selección que hoy depende de la entrevista'],
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
    pitch: 'La universidad corporativa con la marca de la empresa: sus cursos propios con video, PDF, SCORM, evaluaciones y certificados.',
    fitsWhen: [
      'academia o universidad corporativa propia',
      'conocimiento técnico propio que hay que enseñar',
      'procesos o productos que cambian seguido',
      'usa Moodle u otro LMS',
      'inducción u obligatorios normativos propios',
    ],
  },
  {
    key: 'aprendizaje_contenidos',
    family: 'aprendizaje',
    name: 'Contenidos UBITS',
    pitch: 'Un catálogo de contenidos listos (cursos, charlas, podcasts, resúmenes de libros y casos) organizado por competencias, con aliados como TED, WOBI, AWS y Microsoft.',
    fitsWhen: [
      'no tienen contenido propio o es poco',
      'necesitan formar en habilidades blandas, liderazgo, tecnología o negocios',
      'programas de formación que hoy compran curso por curso',
    ],
    caution: 'Harvard y Stanford son del plan Executive: no los prometas sin saber el plan. No nombres cursos puntuales.',
  },
  {
    key: 'aprendizaje_cumplimiento',
    family: 'aprendizaje',
    name: 'Formación en cumplimiento',
    pitch: 'Contenidos de compliance y gestión del riesgo: riesgo operativo y reputacional, LAFT, auditoría interna, protección de datos, gobierno corporativo y HSEQ.',
    fitsWhen: [
      'sector regulado (banca, seguros, financiero, minería, energía, salud)',
      'formación obligatoria por norma',
      'sanciones, auditorías o cambios regulatorios',
    ],
  },
  {
    key: 'aprendizaje_ingles',
    family: 'aprendizaje',
    name: 'Academia de inglés',
    pitch: 'Inglés por niveles, de A1 a C2, para que cada persona avance desde su nivel.',
    fitsWhen: ['operación con otros países o casa matriz extranjera', 'vacantes que piden inglés', 'clientes o proveedores internacionales'],
    caution: 'Es del plan Executive: confirma el plan antes de prometerla.',
  },
  {
    key: 'aprendizaje_sence',
    family: 'aprendizaje',
    name: 'Cursos Sence (Chile)',
    pitch: 'Cursos con código Sence para empresas en Chile, con el ingreso del participante con su Clave Única y el reporte de avance y nota que pide Sence.',
    fitsWhen: ['empresa en Chile', 'usa o quiere usar la franquicia tributaria de capacitación'],
    caution: 'Sólo para Chile. La oferta de cursos Sence es corta: no prometas un curso puntual, ofrece revisarlo en la reunión.',
  },
  {
    key: 'aprendizaje_app',
    family: 'aprendizaje',
    name: 'App y Modo Estudio AI',
    pitch: 'La formación en el celular, con un tutor por chat que en 2 a 5 minutos resuelve dudas y recomienda contenidos del plan de cada persona.',
    fitsWhen: ['mucha población operativa o de primera línea', 'personal en terreno, tiendas o plantas', 'poco tiempo para estudiar'],
  },
  {
    key: 'aprendizaje_ai_studio',
    family: 'aprendizaje',
    name: 'AI Studio',
    pitch: 'Agentes de IA que convierten los manuales, PDFs y documentos de la empresa en cursos con evaluación, imágenes, narración y video.',
    fitsWhen: ['muchos manuales o procedimientos', 'equipo de formación pequeño', 'contenido técnico propio que cambia seguido'],
    caution: 'Funciona con créditos: no lo ofrezcas como ilimitado ni sin costo.',
  },
  {
    key: 'aprendizaje_colecciones',
    family: 'aprendizaje',
    name: 'Colecciones',
    pitch: 'Los manuales y procedimientos de la empresa convertidos en una fuente que el colaborador consulta por chat en medio de la operación.',
    fitsWhen: ['operación con muchos procedimientos', 'personal operativo que no puede parar para hacer un curso', 'aperturas de sedes que deben operar igual'],
    caution: 'Funciona con créditos.',
  },
  {
    key: 'aprendizaje_planes',
    family: 'aprendizaje',
    name: 'Planes de Formación',
    pitch: 'Planes de formación por contenidos o por competencias, para una persona, un equipo o toda la empresa, con el avance de cada uno.',
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
    pitch: 'Pruebas de diagnóstico con enfoque psicométrico que muestran las brechas de cada persona antes de formarla y su avance después.',
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
    pitch: 'Evaluaciones 360 de jefes, pares, clientes internos y reportes, con fortalezas, brechas y el plan de desarrollo que sale de los resultados.',
    fitsWhen: ['líderes nuevos o ascensos', 'cambios de liderazgo', 'cultura de retroalimentación'],
  },
  {
    key: 'desempeno_objetivos',
    family: 'desempeno_cultura',
    name: 'Objetivos',
    pitch: 'Objetivos por persona y por equipo, con mínimos y máximos, evidencias y el avance en tiempo real.',
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
    pitch: 'Encuestas de clima y cultura, eNPS y encuestas libres, con anonimato para que la gente responda con confianza.',
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
  {
    key: 'herramientas_portal',
    family: 'herramientas',
    name: 'Portal del empleado',
    pitch: 'La ficha de cada colaborador, el organigrama y el directorio de la empresa en un solo lugar.',
    fitsWhen: ['crecimiento rápido de la planta', 'reorganizaciones, fusiones o adquisiciones', 'información de la gente repartida en archivos'],
  },
  {
    key: 'herramientas_integraciones',
    family: 'herramientas',
    name: 'Integraciones con nómina y ATS',
    pitch: 'Los usuarios sincronizados con el sistema de nómina o de selección (por ejemplo BUK o Novasoft), para que ingresos y retiros se reflejen solos.',
    fitsWhen: ['mucha rotación o muchos ingresos', 'usan BUK, Novasoft u otro sistema de nómina', 'altas y bajas a mano'],
    caution: 'SAP SuccessFactors todavía no: no lo prometas.',
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

export interface UbitsCatalogTopic {
  competence: string;
  skills: readonly string[];
}

/**
 * Las competencias del catálogo de UBITS y sus habilidades (API de Learn documentada en
 * Confluence, sin las entradas de prueba). Permiten decir «hay contenidos de X» sin
 * nombrar cursos: los nombres de cursos no se usan hasta tener el catálogo vigente.
 */
export const UBITS_CATALOG_TOPICS: readonly UbitsCatalogTopic[] = [
  { competence: 'Accountability', skills: ['autogestión', 'integridad', 'proactividad', 'orientación a resultados'] },
  { competence: 'Administración de negocios', skills: ['análisis económico', 'control de gestión', 'estrategia', 'sostenibilidad y RSE', 'gestión legal'] },
  { competence: 'Agilidad', skills: ['metodologías ágiles'] },
  { competence: 'Comunicación', skills: ['comunicación efectiva', 'gestión de stakeholders', 'hablar en público', 'marca personal', 'redacción y ortografía'] },
  { competence: 'Data skills', skills: ['análisis y visualización de datos', 'analítica de personas', 'big data', 'nube', 'inteligencia de negocios', 'estadística'] },
  { competence: 'Desarrollo de software', skills: ['DevOps', 'herramientas no code', 'software testing', 'pensamiento computacional'] },
  { competence: 'Desarrollo web y mobile', skills: ['backend', 'frontend', 'APIs', 'React Native'] },
  { competence: 'Digital skills', skills: ['transformación digital', 'contenido digital', 'diseño gráfico digital', 'tendencias digitales'] },
  { competence: 'Emprendimiento', skills: ['intraemprendimiento', 'modelos de negocio', 'propuesta de valor'] },
  { competence: 'Experiencia del cliente', skills: ['servicio al cliente', 'diseño de CX', 'CRM', 'manejo de objeciones'] },
  { competence: 'Gestión de procesos y operaciones', skills: ['automatización de procesos', 'cadena de suministro', 'retail', 'hospitality', 'servicios financieros', 'sistemas de gestión'] },
  { competence: 'Gestión de proyectos', skills: ['planeación y control de proyectos'] },
  { competence: 'Gestión de recursos tecnológicos', skills: ['ciberseguridad', 'arquitectura e infraestructura TI', 'derecho digital', 'gestión documental'] },
  { competence: 'Gestión del cambio', skills: ['adaptabilidad', 'aprendizaje continuo', 'mejora continua', 'pensamiento sistémico'] },
  { competence: 'Gestión del riesgo', skills: ['continuidad del negocio', 'riesgo financiero y LAFT', 'riesgo operativo', 'seguridad de la información'] },
  { competence: 'Gestión financiera', skills: ['estados financieros', 'control financiero', 'contabilidad', 'planeación financiera'] },
  { competence: 'Herramientas tecnológicas', skills: ['Microsoft', 'Google', 'Amazon', 'herramientas colaborativas', 'bases de datos', 'Linux'] },
  { competence: 'Inglés', skills: ['grammar', 'listening', 'reading', 'speaking', 'writing'] },
  { competence: 'Innovación', skills: ['creatividad', 'ideación', 'pensamiento disruptivo y exponencial'] },
  { competence: 'Inteligencia artificial', skills: ['IA aplicada', 'machine learning'] },
  { competence: 'Inteligencia emocional', skills: ['empatía', 'resiliencia', 'autorregulación', 'automotivación'] },
  { competence: 'Lenguajes de programación', skills: ['Python', 'Java', 'JavaScript', 'SQL', 'C#', 'R'] },
  { competence: 'Liderazgo', skills: ['coaching de equipos', 'pensamiento estratégico', 'empoderamiento', 'motivación', 'asertividad', 'autoconocimiento'] },
  { competence: 'Marketing y marketing digital', skills: ['branding', 'social media', 'storytelling', 'growth', 'inbound', 'Google Ads y Analytics'] },
  { competence: 'Negociación', skills: ['generación de acuerdos', 'persuasión'] },
  { competence: 'People management', skills: ['adquisición y desarrollo del talento', 'cultura organizacional', 'diversidad, equidad e inclusión', 'experiencia del empleado', 'gestión del desempeño', 'relaciones laborales', 'seguridad y salud en el trabajo'] },
  { competence: 'Product design', skills: ['design thinking', 'UX y UI', 'prototipado', 'UX research'] },
  { competence: 'Productividad', skills: ['gestión del tiempo', 'organización', 'planificación'] },
  { competence: 'Resolución de problemas', skills: ['pensamiento crítico', 'toma de decisiones', 'análisis de escenarios'] },
  { competence: 'Trabajo en equipo', skills: ['gestión del conflicto', 'trabajo colaborativo', 'relacionamiento'] },
  { competence: 'Ventas', skills: ['venta consultiva', 'prospección', 'cierre', 'gestión del equipo comercial'] },
  { competence: 'Wellness', skills: ['salud mental y emocional', 'balance de vida', 'salud financiera', 'salud física'] },
  { competence: 'e-Commerce', skills: ['estrategia digital', 'plataformas de e-commerce', 'funnel de conversión'] },
  { competence: 'Cumplimiento (compliance)', skills: ['cumplimiento financiero', 'gobierno corporativo', 'HSEQ y riesgos laborales', 'legislación laboral', 'cumplimiento en datos y TI'] },
];

export interface UbitsSignalPlay {
  key: string;
  /** Lo que se ve en la empresa. */
  signal: string;
  /** Productos que conectan, en orden. */
  productKeys: readonly string[];
  /** Por qué conecta, en una frase para el guion. */
  angle: string;
}

/** De la señal de la empresa al producto (inventario del portafolio, 18-10-2026). */
export const UBITS_SIGNAL_PLAYS: readonly UbitsSignalPlay[] = [
  {
    key: 'hiring_wave',
    signal: 'Contrata mucho o tiene muchas vacantes abiertas',
    productKeys: ['seleccion_ai_insights', 'seleccion_roleplay', 'aprendizaje_lms_creator', 'aprendizaje_planes'],
    angle: 'Elegir mejor y más rápido, y que cada ingreso llegue listo con una inducción igual para todos.',
  },
  {
    key: 'expansion',
    signal: 'Abre sedes, tiendas o plantas, o llega a otro país',
    productKeys: ['aprendizaje_planes', 'aprendizaje_app', 'aprendizaje_colecciones', 'herramientas_avisos'],
    angle: 'Que la sede nueva opere igual que las demás desde el primer día, con la gente formada desde el celular.',
  },
  {
    key: 'frontline',
    signal: 'Mucha población operativa, en terreno o de primera línea',
    productKeys: ['aprendizaje_app', 'aprendizaje_colecciones', 'aprendizaje_contenidos'],
    angle: 'Llegar a quien no se sienta frente a un computador, con formatos cortos y respuestas en medio de la operación.',
  },
  {
    key: 'regulated',
    signal: 'Sector regulado o formación obligatoria por norma',
    productKeys: ['aprendizaje_cumplimiento', 'aprendizaje_certificados', 'aprendizaje_reportes'],
    angle: 'Cumplir la formación obligatoria y poder demostrarlo con certificados y reportes.',
  },
  {
    key: 'chile',
    signal: 'Empresa en Chile',
    productKeys: ['aprendizaje_sence'],
    angle: 'Usar la franquicia Sence en la formación (confirmar en la reunión qué cursos aplican).',
  },
  {
    key: 'digital_transformation',
    signal: 'Transformación digital, IA, datos o un sistema nuevo',
    productKeys: ['aprendizaje_contenidos', 'aprendizaje_diagnostico', 'aprendizaje_planes'],
    angle: 'Que la gente tenga las habilidades digitales y de datos que el cambio exige, empezando por saber dónde está cada uno.',
  },
  {
    key: 'change',
    signal: 'Fusión, adquisición, reestructuración o cambio de líderes',
    productKeys: ['herramientas_portal', 'herramientas_avisos', 'desempeno_encuestas', 'aprendizaje_contenidos'],
    angle: 'Acompañar el cambio: una sola estructura, comunicar a todos y escuchar cómo lo está viviendo la gente.',
  },
  {
    key: 'new_hr_leader',
    signal: 'Llegó hace poco un líder de RR. HH. o de talento',
    productKeys: ['desempeno_encuestas', 'desempeno_360', 'aprendizaje_diagnostico', 'aprendizaje_planes'],
    angle: 'Un diagnóstico de clima y competencias para construir su plan con datos desde el inicio.',
  },
  {
    key: 'new_leaders',
    signal: 'Promociones, líderes nuevos o un programa de liderazgo',
    productKeys: ['desempeno_360', 'desempeno_pdi', 'desempeno_matriz', 'aprendizaje_contenidos'],
    angle: 'Medir a los líderes, darles un plan de desarrollo y decidir la sucesión con datos.',
  },
  {
    key: 'sales_service',
    signal: 'Equipo comercial, retail o de atención al cliente grande',
    productKeys: ['aprendizaje_contenidos', 'seleccion_roleplay', 'aprendizaje_app'],
    angle: 'Formar en venta consultiva, servicio y negociación, y seleccionar con una simulación del cargo.',
  },
  {
    key: 'english',
    signal: 'Casa matriz extranjera, operación con otros países o vacantes que piden inglés',
    productKeys: ['aprendizaje_ingles'],
    angle: 'Que cada persona avance en inglés desde su nivel.',
  },
  {
    key: 'own_lms',
    signal: 'Usa Moodle u otro LMS, o tiene universidad corporativa',
    productKeys: ['aprendizaje_lms_creator', 'aprendizaje_contenidos', 'aprendizaje_metricas'],
    angle: 'Su universidad corporativa con su marca, con contenido listo encima y la medición sin trabajo manual.',
  },
  {
    key: 'manuals',
    signal: 'Mucho conocimiento en manuales y procedimientos',
    productKeys: ['aprendizaje_ai_studio', 'aprendizaje_colecciones'],
    angle: 'Convertir los manuales en cursos y en respuestas que la gente consulta por chat.',
  },
  {
    key: 'wellbeing_turnover',
    signal: 'Rotación alta, premios de clima o noticias de bienestar',
    productKeys: ['desempeno_encuestas', 'aprendizaje_contenidos', 'desempeno_pdi'],
    angle: 'Escuchar a la gente con eNPS y clima, y retenerla con desarrollo y bienestar.',
  },
];

function renderCatalogTopics(): string {
  return UBITS_CATALOG_TOPICS.map((t) => `- ${t.competence}: ${t.skills.join(', ')}`).join('\n');
}

/** Tabla de señales para las instrucciones (investigación y redacción). */
export function renderSignalPlaysForPrompt(): string {
  return UBITS_SIGNAL_PLAYS.map((p) => `- ${p.signal} → ${p.productKeys.join(', ')}. ${p.angle}`).join('\n');
}

export interface UbitsClaim {
  key: string;
  /** La afirmación exacta que se puede usar. */
  text: string;
  /** De dónde sale. Sin fuente no hay afirmación. */
  source: string;
  /**
   * La cifra y de qué habla (palabras sin tildes): si el texto usa la cifra, la misma frase
   * tiene que nombrar el tema (Binga!, Prod 21-10: «El 88 % dice que la formación rápida…»).
   */
  anchor?: { pattern: RegExp; topic: readonly string[] };
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
  {
    key: 'ubits_content_catalog',
    text: 'El catálogo de UBITS reúne más de 30 competencias y 150 habilidades en cinco academias: tecnología, negocios, habilidades blandas, inglés y compliance.',
    source: 'Oferta de valor de UBITS (documentación de producto, 2026)',
  },
  // Datos de la industria para el enfoque «Con un dato» (Manual del primer contacto, 17-10-2026).
  {
    key: 'linkedin_wlr_2025_skills',
    text: 'El 49 % de los líderes de talento dice que a su alta dirección le preocupa que la gente no tenga las habilidades para ejecutar la estrategia.',
    source: 'LinkedIn Workplace Learning Report 2025',
    anchor: { pattern: /\b49(\s?%| por ciento)/, topic: ['habilidad', 'estrategia'] },
  },
  {
    key: 'linkedin_wlr_2025_retention',
    text: 'El 88 % de las organizaciones está preocupado por retener talento, y la formación es su principal estrategia para lograrlo.',
    source: 'LinkedIn Workplace Learning Report 2025',
    anchor: { pattern: /\b88(\s?%| por ciento)/, topic: ['reten', 'retien', 'quedarse', 'se quede', 'rotacion'] },
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
      // Antes: «Muchas empresas con plataforma propia nos usan…»: afirmaba clientes que la
      // biblioteca no respalda y el verificador lo marcaba en cada preparación (Prod 19-10).
      'Muy bien. ¿Qué tal les va con el contenido y con que la gente lo use? UBITS se puede sumar con el catálogo y la medición, sin cambiar lo que ya tienen.',
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
  // Estudio de estilo del primer contacto (19-10-2026): suenan a plantilla, a folleto o a IA.
  'me encantaría',
  'sinergia',
  'solución integral',
  'soluciones integrales',
  'al siguiente nivel',
  'no dude en',
  'espero que se encuentre bien',
  'espero que esté bien',
  'llamada rápida',
  'reunión rápida',
  'sabía usted que',
  'hace sentido',
  'hacer sentido',
  'apalancar',
];

/** Texto de la biblioteca para las instrucciones del modelo (va en caché). */
export function renderLibraryForPrompt(): string {
  const products = UBITS_PRODUCTS.map(
    (p) =>
      `- ${p.key} | ${UBITS_PRODUCT_FAMILY_LABELS[p.family]} › ${p.name}: ${p.pitch} Encaja cuando: ${p.fitsWhen.join('; ')}.${p.caution ? ` Cuidado: ${p.caution}` : ''}`,
  ).join('\n');
  const claims = UBITS_CLAIMS.map((c) => `- ${c.key}: «${c.text}» (fuente: ${c.source})`).join('\n');
  const offers = UBITS_OFFERS.map((o) => `- ${o.key}: ${o.text}`).join('\n');
  const objections = UBITS_OBJECTIONS.map((o) => `- ${o.key} | «${o.objection}» → ${o.response}`).join('\n');
  return [
    `# Productos de UBITS (${UBITS_LIBRARY_VERSION})`,
    products,
    '',
    '# De la señal de la empresa al producto (elige por los hechos, no por la lista)',
    renderSignalPlaysForPrompt(),
    '',
    '# Temas del catálogo de UBITS (competencias: habilidades)',
    'Puedes decir que UBITS tiene contenidos de estas competencias y habilidades. NO inventes ni nombres cursos: di el tema («contenidos de venta consultiva»), nunca un título.',
    renderCatalogTopics(),
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
