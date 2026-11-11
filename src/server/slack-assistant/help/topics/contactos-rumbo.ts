// Guía de uso — Contactos, teléfonos, Rumbo (primer contacto) y Flujo de prospección.
// Escrito desde el código (investigación 11-11); cada «etiqueta» está vigilada por la prueba.
import type { HelpTopic } from '../types';

const RUMBO = 'src/components/ai/rumbo-labels.ts';
const CONTACTS_SIDEBAR = 'src/components/layout/sidebar-nav.ts';

export const CONTACTOS_RUMBO_TOPICS: readonly HelpTopic[] = [
  {
    key: 'buscar-contactos',
    titulo: 'Buscar contactos (decisores) de una empresa',
    palabrasClave: ['buscar contactos', 'decisores', 'contactos de una empresa', 'enriquecer', 'apollo', 'lusha', 'agente 2', 'personas'],
    roles: 'todos',
    ruta: '/contacts',
    requiere: ['ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING'],
    contenido: [
      '*Dónde:* en la ficha de la empresa «Buscar contactos con Rumbo IA», o en Contactos → «Buscar contactos» (también desde Empresas y el Flujo de prospección).',
      '*Pasos:* escribe nombre, dominio, correo o ID de HubSpot de la empresa → elige la coincidencia (o créala a mano) → «Confirmar empresa» → «Buscar contactos con IA». Corre en segundo plano (Centro de procesos).',
      '*Orden de búsqueda:* primero lo gratis (HubSpot y contactos ya conocidos, si están activos), luego Apollo y, sólo si Apollo no deja candidatos, el sitio de la empresa y Lusha como respaldo.',
      '*Resultado:* los candidatos quedan en Contactos › «Por revisar» (los de HubSpot ya completos se aprueban solos). Nada se crea ni se escribe en HubSpot sin tu aprobación. Te aviso por Slack cuando termina.',
      '*Varias empresas:* desde el panel, «Buscar por lote de HubSpot IDs» (hasta 10 IDs separados por coma).',
    ].join('\n'),
    etiquetas: [
      { texto: 'Buscar contactos con Rumbo IA', archivo: RUMBO },
      { texto: 'Buscar contactos', archivo: 'src/components/contacts/contacts-screen-actions.tsx' },
      { texto: 'Confirmar empresa', archivo: 'src/components/contact-enrichment/contact-enrichment-chat-wizard.tsx' },
      { texto: 'Buscar contactos con IA', archivo: 'src/components/contact-enrichment/contact-enrichment-chat-wizard.tsx' },
      { texto: 'Por revisar', archivo: CONTACTS_SIDEBAR },
      { texto: 'Buscar por lote de HubSpot IDs', archivo: 'src/components/contact-enrichment/contact-enrichment-hubspot-id-batch.tsx' },
    ],
  },
  {
    key: 'contacto-por-linkedin-o-correo',
    titulo: 'Buscar una persona por su LinkedIn o su correo',
    palabrasClave: ['linkedin', 'correo', 'email', 'url de linkedin', 'una persona', 'buscar por correo', 'buscar por linkedin'],
    roles: 'todos',
    ruta: '/contacts',
    requiere: ['CONTACT_ENRICHMENT_LINKEDIN_SEARCH_ENABLED', 'ENABLE_CONTACT_ENRICHMENT_AUTOMATIC_ROUTING'],
    contenido: [
      '*Dónde:* en el panel de búsqueda de contactos, «Buscar contacto por LinkedIn o correo». Pega el enlace de LinkedIn o el correo de la persona.',
      '*Por LinkedIn:* mira primero en SellUp (si ya está, 0 créditos), luego Apollo y, si Apollo no tiene datos, Lusha.',
      '*Por correo:* SellUp → HubSpot (gratis) → Apollo → Lusha.',
      '*Resultado:* queda un candidato en «Por revisar» para que lo apruebes.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Buscar contacto por LinkedIn o correo', archivo: 'src/components/contact-enrichment/contact-enrichment-linkedin-search.tsx' },
      { texto: 'Por revisar', archivo: CONTACTS_SIDEBAR },
    ],
  },
  {
    key: 'revisar-contactos',
    titulo: 'Revisar candidatos de contacto y crear contactos a mano',
    palabrasClave: ['revisar contactos', 'aprobar contacto', 'rechazar contacto', 'crear contacto', 'contacto manual', 'contactos rechazados', 'candidatos'],
    roles: 'todos',
    ruta: '/contacts?tab=candidates',
    contenido: [
      '*Revisar:* Contactos › «Por revisar». En cada candidato: «Aprobar» abre la ficha para confirmar y crea el contacto oficial; «Rechazar» pide un motivo (cargo no relevante, datos insuficientes, no pertenece a la empresa, duplicado…). Los rechazados están en «Contactos rechazados» y se pueden enviar a revisar otra vez.',
      '*Crear a mano:* Contactos → «Crear contacto» → elige la empresa y escribe al menos el nombre (correo, teléfono, celular, LinkedIn, cargo, área, rol…) → «Guardar contacto». Si ya existe, te avisa.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Por revisar', archivo: CONTACTS_SIDEBAR },
      { texto: 'Aprobar', archivo: 'src/components/contact-enrichment/contact-candidates-data-table-client.tsx' },
      { texto: 'Rechazar', archivo: 'src/components/contact-enrichment/contact-candidates-data-table-client.tsx' },
      { texto: 'Contactos rechazados', archivo: CONTACTS_SIDEBAR },
      { texto: 'Crear contacto', archivo: 'src/components/contacts/contacts-screen-actions.tsx' },
      { texto: 'Guardar contacto', archivo: 'src/components/contacts/create-contact-drawer.tsx' },
    ],
  },
  {
    key: 'revelar-telefono',
    titulo: 'Conseguir el teléfono de un contacto',
    palabrasClave: ['telefono', 'celular', 'numero', 'revelar telefono', 'phone', 'whatsapp del contacto'],
    roles: ['admin', 'commercial_manager'],
    ruta: '/contacts?tab=candidates',
    requiere: ['ENABLE_APOLLO_PHONE_REVEAL'],
    contenido: [
      '*Dónde:* en el detalle de un candidato de Contactos › «Por revisar» (o de un contacto ya aprobado): «Revelar teléfono».',
      '*Costo:* Apollo 8 créditos; si está activa la cascada y Apollo no lo tiene, sigue con Lusha (1 de búsqueda + 5 del teléfono). El botón te dice antes el máximo que puede gastar (hasta 14) y respeta las reglas de presupuesto.',
      'Si ya se pagó ese teléfono antes, puede reutilizarlo sin costo (si está activo).',
    ].join('\n'),
    etiquetas: [
      { texto: 'Por revisar', archivo: CONTACTS_SIDEBAR },
      { texto: 'Revelar teléfono', archivo: 'src/components/contact-enrichment/contact-candidates-data-table-client.tsx' },
    ],
  },
  {
    key: 'rumbo',
    titulo: 'Rumbo: preparar el primer contacto con una empresa',
    palabrasClave: ['rumbo', 'primer contacto', 'guion', 'llamada', 'mensaje', 'whatsapp', 'investigacion', 'agente 3', 'preparar contacto', 'como contactar'],
    roles: 'todos',
    ruta: '/accounts',
    requiere: ['ENABLE_AGENT3_FIRST_CALL'],
    contenido: [
      '*Formas de empezar:*',
      '• En la ficha de una empresa (o el menú de su fila en Empresas): «Preparar primer contacto con Rumbo IA».',
      '• Desde un contacto (menú de la fila en Contactos): el mismo botón, con esa persona ya elegida.',
      '• Sin la empresa en SellUp: Empresas → «Buscar con Rumbo IA» → «Preparar el primer contacto» → escribe su nombre, dominio, un correo de la empresa (saca el dominio) o su ID de HubSpot; si no existe, te pide país y sitio web y la crea (y la deja en HubSpot).',
      '• Desde el Flujo de prospección.',
      '*Pasos:* decisores (hasta 5, o “sin decisor”) → canales (llamada, WhatsApp, correo, LinkedIn) → objetivo → cómo abrir (o “Todos”) → productos de UBITS → «Preparar».',
      '*Qué entrega:* una investigación de la empresa con fuentes (vale 30 días y no se paga otra) y, por cada decisor y canal, el guion o mensaje, preguntas, respuestas a objeciones y la mejor hora. Queda en la pestaña «Primer contacto» de la empresa; puedes editarlo, pedir «Otra versión con Rumbo IA», descartarlo o marcar «La usé» con el resultado. En Brasil y EE. UU. también lo escribe en portugués o inglés.',
      '*Costo:* Claude y Tavily (se registra en Uso de IA); revisa el presupuesto de IA antes de empezar.',
    ].join('\n'),
    limites: 'Rumbo no acepta un enlace de LinkedIn para empezar (un enlace se lee como el sitio de la empresa). No funciona con empresas archivadas.',
    etiquetas: [
      { texto: 'Preparar primer contacto con Rumbo IA', archivo: RUMBO },
      { texto: 'Buscar con Rumbo IA', archivo: RUMBO },
      { texto: 'Preparar el primer contacto', archivo: 'src/components/accounts/accounts-agent-chooser.tsx' },
      { texto: 'Preparar', archivo: 'src/components/first-call/first-contact-agent-panel.tsx' },
      { texto: 'Primer contacto', archivo: 'src/app/(sellup)/accounts/[accountId]/page.tsx' },
      { texto: 'Otra versión con Rumbo IA', archivo: RUMBO },
      { texto: 'La usé', archivo: 'src/components/first-call/first-call-pack-card.tsx' },
    ],
  },
  {
    key: 'flujo-de-prospeccion',
    titulo: 'Flujo de prospección (en qué etapa está cada empresa)',
    palabrasClave: ['flujo de prospeccion', 'pipeline', 'etapas', 'tablero', 'kanban', 'recorrido', 'cambiar etapa', 'sin movimiento'],
    roles: 'todos',
    ruta: '/pipeline',
    contenido: [
      '*Dónde:* «Flujo de prospección» en el menú lateral. Dos vistas: «Recorrido» (lista de empresas y sus etapas) y «Tablero» (columnas).',
      '*Etapas:* Prospección → Enriquecimiento de contactos → Primer contacto → (próximamente reunión, cotización, negociación y cierre).',
      '*Qué haces:* ver empresa, preparar el primer contacto con Rumbo, buscar contactos y «Cambiar etapa»: que lo haga la IA, decir que ya lo hiciste por fuera o moverla sin acción (con motivo).',
      '*Alertas:* sin movimiento (7/14/21 días), sin contactos, sin responsable, sin sincronizar con HubSpot, decisor sin teléfono. No gasta créditos.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Flujo de prospección', archivo: 'src/config/navigation.ts' },
      { texto: 'Recorrido', archivo: 'src/app/(sellup)/pipeline/pipeline-copy.ts' },
      { texto: 'Tablero', archivo: 'src/app/(sellup)/pipeline/pipeline-copy.ts' },
      { texto: 'Cambiar etapa', archivo: 'src/app/(sellup)/pipeline/pipeline-board.tsx' },
    ],
  },
];
