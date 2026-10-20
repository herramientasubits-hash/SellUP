/**
 * Agente 3 (Rumbo) · cómo suena natural el primer contacto en cada país (puro).
 *
 * Dueña 19-10: «los mensajes deben sentirse naturales y, según cada país, ser más
 * directos o más amables». Sale de las investigaciones del 19-10-2026 por país (guías
 * de etiqueta de negocios, Hofstede y Erin Meyer, prensa local) y del estudio de estilo
 * de primer contacto (Gong, Lavender, HubSpot España). Lo que NO cambia por país: el
 * primer contacto va con «usted» (Manual del primer contacto, 17-10).
 *
 * El texto en español: en Brasil y Estados Unidos lo correcto sería portugués e inglés,
 * y eso depende de que el vendedor hable el idioma (pendiente de la dueña).
 */

export interface CountryStyle {
  /** Qué tan directo (1 = muy indirecto, 5 = al grano). */
  directness: 1 | 2 | 3 | 4 | 5;
  /** Cuánta cortesía antes del motivo (1 = casi nada, 5 = mucha). */
  warmth: 1 | 2 | 3 | 4 | 5;
  /** Títulos y trato al nombrar a la persona. */
  titles: string;
  /** Cómo saludar al llamar. */
  callGreeting: string;
  /** Cómo pedir los 30 segundos de permiso. */
  permissionAsk: string;
  /** Saludo y despedida del correo. */
  emailGreeting: string;
  emailSignoff: string;
  /** Palabras que suenan naturales aquí. */
  naturalWords: readonly string[];
  /** Palabras de OTROS países que aquí suenan extranjeras (el verificador las marca). */
  foreignWords: readonly string[];
  /** Lo que más importa del tono en este país. */
  note: string;
}

/** Lo que suena a otro país en casi toda Latinoamérica (España, jerga, muletillas). */
const LATAM_FOREIGN = ['vosotros', 'ordenador', 'guay', 'chévere', 'bacán', 'güey', 'chido', 'che', 'chamo', 'pana', 'vaina', 'mae', 'cachai', 'al tiro', 'pura vida'];
/** Lo que suena a México o Centroamérica fuera de ahí. */
const MEXICANISMS = ['platicar', 'platicarle', 'platiquemos', 'platicamos', 'padrísimo', 'órale', 'ahorita'];

const NEUTRAL_LATAM: CountryStyle = {
  directness: 2,
  warmth: 4,
  titles: 'Nombre y apellido; un título (Lic., Ing.) sólo si figura en su cargo.',
  callGreeting: '«Buenos días, ¿hablo con [nombre]? Le habla [vendedor], de UBITS.»',
  permissionAsk: '«¿Me permite 30 segundos para contarle por qué lo llamo, y usted decide si seguimos?»',
  emailGreeting: '«Buenos días, [nombre]:» (con dos puntos)',
  emailSignoff: '«Saludos cordiales,»',
  naturalWords: ['conversar', 'coordinar', 'con gusto'],
  foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS],
  note: 'Cortesía breve antes del motivo; nada de presionar por una fecha.',
};

const STYLES: Readonly<Record<string, CountryStyle>> = {
  CO: {
    directness: 2,
    warmth: 4,
    titles: 'Por teléfono, «doctor/doctora» es trato de respeto con directivos; nunca «licenciado» (suena mexicano).',
    callGreeting: '«Buenos días, ¿hablo con [nombre]? Le habla [vendedor], de UBITS. ¿Cómo está?»',
    permissionAsk: '«¿Me regala 30 segundos para contarle por qué la llamo, y usted me dice si seguimos?»',
    emailGreeting: '«Buenos días, [nombre]:» o «Cordial saludo, [nombre]:»',
    emailSignoff: '«Quedo atento a sus comentarios.» / «Saludos cordiales,»',
    naturalWords: ['con mucho gusto', 'le cuento', 'quedo atento', 'conversar', 'agendar'],
    foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS],
    note: 'Indirecto y cálido: el usted también es cariñoso. Un saludo y un «¿cómo está?» antes del motivo; un «déjeme revisarlo» suele ser un no amable.',
  },
  MX: {
    directness: 2,
    warmth: 4,
    titles: 'Lic., Ing., Mtro./Mtra. son muy usados en RR. HH.: úsalos sólo si están en su cargo; si no, «Buen día, [nombre]:».',
    callGreeting: '«Buen día, ¿hablo con [nombre]? Le habla [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite 30 segundos para platicarle por qué la llamo, y usted decide si seguimos?»',
    emailGreeting: '«Buen día, [nombre]:»',
    emailSignoff: '«Quedo a sus órdenes.» / «Saludos cordiales,»',
    naturalWords: ['platicar', 'buen día', 'a sus órdenes', 'le comento', 'con gusto'],
    foreignWords: [...LATAM_FOREIGN, 'me regala', 'qué pena con usted', 'sumercé', 'coger'],
    note: 'Jerárquico y cortés: proponer, nunca presionar («¿le parecería si…?»). Lo directo del Cono Sur suena irrespetuoso.',
  },
  CL: {
    directness: 3,
    warmth: 3,
    titles: '«Sr./Sra.» en el correo; nunca «licenciado».',
    callGreeting: '«Hola, ¿hablo con [nombre]? ¿Cómo está? Le habla [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite 30 segundos para contarle por qué la llamo?»',
    emailGreeting: '«Buenos días, [nombre]:»',
    emailSignoff: '«Saludos cordiales,»',
    naturalWords: ['conversar', 'coordinar', '¿le acomoda?'],
    foreignWords: [...LATAM_FOREIGN.filter((w) => w !== 'cachai' && w !== 'al tiro' && w !== 'bacán'), ...MEXICANISMS, 'regálame'],
    note: 'Pragmático y sobrio: nada de exageraciones ni promesas grandes; fórmulas suavizadas («¿le acomoda el jueves?»).',
  },
  AR: {
    directness: 4,
    warmth: 3,
    titles: 'Casi no se usan: nombre de pila.',
    callGreeting: '«Hola, ¿hablo con [nombre]? Le habla [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite 30 segundos para contarle por qué la llamo?»',
    emailGreeting: '«Hola, [nombre]:»',
    emailSignoff: '«Saludos,»',
    naturalWords: ['charlar', '¿le parece?', 'conversar'],
    foreignWords: [...LATAM_FOREIGN.filter((w) => w !== 'che'), ...MEXICANISMS, 'coger', 'agendar una cita'],
    note: 'Más directo y conversacional, con datos concretos. El «tú» suena extranjero: usted (y vos sólo si el otro lo usa). Sonar a guion leído cae mal.',
  },
  UY: {
    directness: 3,
    warmth: 3,
    titles: '«Sr./Sra.»; pocos títulos.',
    callGreeting: '«Buenos días, ¿hablo con [nombre]? Le habla [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite 30 segundos para contarle por qué la llamo?»',
    emailGreeting: '«Buenos días, [nombre]:»',
    emailSignoff: '«Saludos,»',
    naturalWords: ['charlar', 'coordinar'],
    foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS],
    note: 'Sobrio y reservado, más formal que Argentina. Nada de venta agresiva ni de «transformar»: pasos chicos y de bajo riesgo.',
  },
  PY: {
    directness: 2,
    warmth: 4,
    titles: 'Lic., Ing., Dr. se usan mucho: sólo si están en su cargo.',
    callGreeting: '«Buen día, ¿cómo le va? ¿Hablo con [nombre]? Le saluda [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite 30 segundos para contarle por qué lo llamo?»',
    emailGreeting: '«Buenos días, [nombre]:»',
    emailSignoff: '«Saludos cordiales,»',
    naturalWords: ['conversar', 'coordinar'],
    foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS],
    note: 'Cálido, jerárquico y de relación personal: cortesía primero y sin presión.',
  },
  PE: {
    directness: 2,
    warmth: 4,
    titles: 'Dr., Ing., Lic. hasta que lo inviten a usar el nombre: sólo si están en su cargo.',
    callGreeting: '«Buenos días, ¿con [nombre]? Le saluda [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite contarle brevemente sobre UBITS?» (en Perú sólo se pide permiso antes de ofrecer)',
    emailGreeting: '«Buenos días, [nombre]:»',
    emailSignoff: '«Saludos cordiales,» / «Atentamente,»',
    naturalWords: ['conversar', 'coordinar'],
    foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS],
    note: 'Formal y cuidando la armonía: nada de confrontar ni insistir.',
  },
  EC: {
    directness: 2,
    warmth: 4,
    titles: 'Muy jerárquico: Ing., Dr., Econ. si están en su cargo.',
    callGreeting: '«Buenos días, ¿con [nombre]? Le saluda [vendedor], de UBITS.»',
    permissionAsk: '«¿Me permite 30 segundos para contarle por qué lo llamo?»',
    emailGreeting: '«Buenos días, [nombre]:»',
    emailSignoff: '«Saludos cordiales,»',
    naturalWords: ['conversar', 'coordinar'],
    foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS],
    note: 'Cortesía primero (más formal en Quito, más cálido en Guayaquil) y sin saltarse la jerarquía.',
  },
  BO: { ...NEUTRAL_LATAM, directness: 2, warmth: 4, titles: 'Lic., Ing. si están en su cargo.', note: 'Formal y con títulos; cortesía antes del motivo.' },
  VE: {
    ...NEUTRAL_LATAM,
    directness: 3,
    warmth: 5,
    callGreeting: '«Buenos días, ¿cómo está? ¿Hablo con [nombre]? Le habla [vendedor], de UBITS.»',
    note: 'Cálido: la frialdad cae mal. Usted al empezar.',
  },
  GT: {
    ...NEUTRAL_LATAM,
    directness: 1,
    warmth: 4,
    titles: 'Muy formal: Lic./Licda., Ing., Dr. si están en su cargo.',
    emailSignoff: '«Atentamente,» / «Saludos cordiales,»',
    naturalWords: ['con mucho gusto', 'conversar', 'platicar'],
    foreignWords: LATAM_FOREIGN,
    note: 'El más jerárquico de la región: deferencia al cargo, comunicación indirecta y nunca ir directo al «no».',
  },
  HN: { ...NEUTRAL_LATAM, naturalWords: ['conversar', 'platicar'], foreignWords: LATAM_FOREIGN, note: 'Cortés y sin tutear; cortesía antes del motivo.' },
  SV: { ...NEUTRAL_LATAM, naturalWords: ['conversar', 'platicar'], foreignWords: LATAM_FOREIGN, note: 'Prefiere lo concreto y de bajo riesgo: nada de promesas grandes.' },
  NI: { ...NEUTRAL_LATAM, naturalWords: ['conversar', 'platicar'], foreignWords: LATAM_FOREIGN, note: 'Cortés y sin tutear.' },
  CR: {
    ...NEUTRAL_LATAM,
    titles: 'Títulos al inicio y pronto el nombre.',
    naturalWords: ['con mucho gusto', 'conversar'],
    foreignWords: [...LATAM_FOREIGN.filter((w) => w !== 'mae' && w !== 'pura vida'), ...MEXICANISMS, 'mae', 'pura vida', 'tuanis'],
    note: 'Ustedeo incluso entre amigos (el tuteo suena extranjero); cero confrontación.',
  },
  PA: { ...NEUTRAL_LATAM, foreignWords: [...LATAM_FOREIGN, ...MEXICANISMS, 'xopa', 'ofi'], note: 'Jerárquico: no saltarse el cargo; algo de inglés de negocios, mejor evitarlo.' },
  DO: {
    ...NEUTRAL_LATAM,
    directness: 3,
    warmth: 5,
    callGreeting: '«Buenos días, ¿cómo está? ¿Hablo con [nombre]? Le habla [vendedor], de UBITS.»',
    note: 'Cálido. «Ahorita» significa «más tarde»: nunca para comprometer tiempos.',
  },
  ES: {
    directness: 4,
    warmth: 2,
    titles: 'Sin títulos (nada de Lic. ni Ing.): nombre de pila.',
    callGreeting: '«Hola, ¿hablo con [nombre]? Soy [vendedor], de UBITS.»',
    permissionAsk: '«¿Me deja 30 segundos para contarle por qué le llamo?»',
    emailGreeting: '«Hola, [nombre]:» o «Buenos días, [nombre]:»',
    emailSignoff: '«Un saludo,»',
    naturalWords: ['¿le encaja?', 'concertar', 'móvil', 'charlar'],
    foreignWords: ['agendar', 'ahorita', 'platicar', 'celular', 'computador', 'quedo atento', 'quedo atenta', 'chévere', 'a la orden', 'licenciado'],
    note: 'Directo y conciso: la floritura latinoamericana sobra. Ir al grano sin halagos.',
  },
  BR: {
    ...NEUTRAL_LATAM,
    warmth: 5,
    note: 'Muy relacional: un saludo cálido antes del motivo. Lo ideal sería escribir en portugués de Brasil (pendiente: depende de que el vendedor lo hable).',
  },
  US: {
    ...NEUTRAL_LATAM,
    directness: 5,
    warmth: 2,
    titles: 'Nombre de pila, sin títulos.',
    note: 'Muy directo: el valor en la primera línea y un solo pedido. Lo ideal sería escribir en inglés salvo roles regionales de Latinoamérica (pendiente de la dueña).',
  },
};

/** El estilo del país (o el neutro latinoamericano si no hay uno propio). */
export function countryStyleFor(countryCode: string | null | undefined): CountryStyle {
  return (countryCode && STYLES[countryCode.toUpperCase()]) || NEUTRAL_LATAM;
}

const LEVEL_DIRECT: Record<CountryStyle['directness'], string> = {
  1: 'muy indirecto: sugiere, no pide',
  2: 'indirecto y cortés: propone («¿le parecería…?»)',
  3: 'equilibrado: claro pero cordial',
  4: 'directo: al grano, sin rodeos',
  5: 'muy directo: el valor en la primera línea',
};
const LEVEL_WARM: Record<CountryStyle['warmth'], string> = {
  1: 'casi sin cortesía previa',
  2: 'cortesía mínima',
  3: 'una línea de cortesía',
  4: 'saludo y cortesía breve antes del motivo',
  5: 'saludo cálido y cercano antes del motivo',
};

/** El bloque de estilo del país para el redactor. */
export function renderCountryStyle(countryCode: string | null | undefined, countryName: string | null): string {
  const style = countryStyleFor(countryCode);
  return [
    `Estilo para ${countryName ?? 'este país'} (que suene natural aquí):`,
    `- Tono: ${LEVEL_DIRECT[style.directness]}; ${LEVEL_WARM[style.warmth]}. ${style.note}`,
    `- Títulos: ${style.titles}`,
    `- Saludo al llamar: ${style.callGreeting} Permiso: ${style.permissionAsk}`,
    `- Correo: saludo ${style.emailGreeting} («Estimado» o «Estimada» sólo si su cargo dice el género, como «Directora»); despedida ${style.emailSignoff}`,
    `- Suena natural: ${style.naturalWords.join(', ')}.`,
    `- NO uses (suena a otro país): ${style.foreignWords.join(', ')}.`,
  ].join('\n');
}

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Palabras de otro país que aparecen en el texto (palabra entera; «vale la pena» no cuenta). */
export function foreignWordsIn(text: string, countryCode: string | null | undefined): string[] {
  const haystack = normalize(text);
  return countryStyleFor(countryCode).foreignWords.filter((word) => {
    const needle = normalize(word).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^\\p{L}])${needle}(?![\\p{L}])`, 'u').test(haystack);
  });
}
