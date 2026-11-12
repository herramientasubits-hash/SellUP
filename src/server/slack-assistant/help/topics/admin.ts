// Guía de uso — Uso de IA, presupuesto y créditos, usuarios, calculadora y el propio asistente.
// Escrito desde el código (investigación 11-11); cada «etiqueta» está vigilada por la prueba.
import type { HelpTopic } from '../types';

export const ADMIN_TOPICS: readonly HelpTopic[] = [
  {
    key: 'uso-de-ia',
    titulo: 'Uso de IA y costos',
    palabrasClave: ['uso de ia', 'costos', 'consumo', 'cuanto gastamos', 'creditos usados', 'mapa de uso', 'gasto'],
    roles: ['admin', 'commercial_manager', 'commercial_lead'],
    ruta: '/ai-usage',
    contenido: [
      '*Dónde:* «Uso de IA y costos». Pestañas: Resumen, Por agente, Por país, Proveedores, Equipo, Por rol y grupo, Por búsqueda, Detalle y «Mapa de uso» (quién usa qué, cuándo y con qué resultado).',
      '*Filtros:* periodo arriba y «Filtros» (proveedor, agente, rol, grupo, persona, país, industria…).',
      '*Quién ve qué:* administradores todo; managers y líderes su equipo en cascada por el organigrama, en dólares. Vendedores y Growth no tienen este módulo.',
      'También puedes preguntármelo aquí: “¿cuánto hemos gastado este mes?”.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Uso de IA y costos', archivo: 'src/config/navigation.ts' },
      { texto: 'Mapa de uso', archivo: 'src/app/(sellup)/ai-usage/page.tsx' },
      { texto: 'Filtros', archivo: 'src/app/(sellup)/ai-usage/filters-client.tsx' },
    ],
  },
  {
    key: 'presupuesto-y-reglas',
    titulo: 'Presupuesto, reglas y recargas de créditos (administradores)',
    palabrasClave: ['presupuesto', 'reglas de presupuesto', 'cuota', 'limite', 'tope', 'recargar creditos', 'agregar creditos', 'reserva', 'bloquear'],
    roles: ['admin'],
    ruta: '/settings/providers',
    contenido: [
      '*Dónde:* menú de la marca “SellUp” (arriba del menú lateral) → «Proveedores y consumo». En la fila de un proveedor, «Presupuesto y reglas».',
      '*Cuota mensual:* «Editar cuota» (créditos y/o USD del mes).',
      '*Reglas:* «Crear regla» → proveedor, a quién aplica (global, rol, grupo o persona), periodo, límite en créditos o USD y «Al superar el límite»: alertar, bloquear o requerir aprobación (con quién aprueba).',
      '*Recarga del mes:* en una regla con límite de créditos, “+” → «Agregar créditos» (sólo este periodo; lo que sobra pasa a la reserva).',
      'Te aviso por Slack cuando un proveedor pasa del 80 % o del 100 % del mes, o se queda sin créditos.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Proveedores y consumo', archivo: 'src/app/(sellup)/settings/providers/page.tsx' },
      { texto: 'Presupuesto y reglas', archivo: 'src/app/(sellup)/settings/budget-credits/budget-providers-table.tsx' },
      { texto: 'Editar cuota', archivo: 'src/app/(sellup)/settings/budget-credits/budget-providers-table.tsx' },
      { texto: 'Crear regla', archivo: 'src/app/(sellup)/settings/budget-credits/rules/budget-rule-drawers.tsx' },
      { texto: 'Al superar el límite', archivo: 'src/app/(sellup)/settings/budget-credits/rules/budget-rule-drawers.tsx' },
      { texto: 'Agregar créditos', archivo: 'src/app/(sellup)/settings/budget-credits/rules/top-up-rule-drawer.tsx' },
    ],
  },
  {
    key: 'solicitudes-de-creditos',
    titulo: 'Pedir y aprobar más créditos',
    palabrasClave: ['pedir creditos', 'solicitud de creditos', 'aprobar creditos', 'me quede sin creditos', 'limite de creditos', 'aprobadores'],
    roles: 'todos',
    ruta: '/credit-approvals',
    contenido: [
      '*Cómo se pide:* no hay botón; cuando una búsqueda choca con una regla “requiere aprobación”, SellUp abre la solicitud solo y te dice a quién se la pidió.',
      '*Cómo se aprueba:* quien aprueba la recibe en la campanita y por Slack, con botones para dar los créditos o rechazar ahí mismo. En SellUp está en «Solicitudes de créditos» (desde el aviso, «Ver solicitud»).',
      'Los créditos aprobados son sólo para esa persona y ese periodo. Nadie aprueba su propia solicitud; si dos deciden a la vez, vale la primera.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Solicitudes de créditos', archivo: 'src/app/(sellup)/credit-approvals/page.tsx' },
      { texto: 'Ver solicitud', archivo: 'src/modules/budgets/approval-requests.server.ts' },
    ],
  },
  {
    key: 'usuarios-y-acceso',
    titulo: 'Usuarios: agregar, activar, desactivar, roles y grupos (administradores)',
    palabrasClave: ['usuarios', 'agregar usuario', 'invitar', 'activar acceso', 'desactivar', 'inactivos', 'roles', 'grupos', 'organigrama', 'jefe'],
    roles: ['admin'],
    ruta: '/settings/users',
    contenido: [
      '*Dónde:* menú de la marca “SellUp” → «Usuarios y acceso».',
      '*Agregar:* «Agregar usuario» → correo @ubits.co, nombre, rol, líder y grupo → «Preautorizar». Le llega la invitación por Slack y su acceso se activa al primer ingreso con Google.',
      '*Activar o desactivar:* pestaña «Inactivos» → «Activar acceso» (le aviso por Slack que ya puede entrar); a un activo, «Desactivar acceso». También en grupo, seleccionando varios.',
      '*Otros:* cambiar rol, jefe directo o grupo desde el menú de cada persona; grupos y organigrama en sus pestañas.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Usuarios y acceso', archivo: 'src/app/(sellup)/settings/users/page.tsx' },
      { texto: 'Agregar usuario', archivo: 'src/app/(sellup)/settings/users/users-screen-actions.tsx' },
      { texto: 'Preautorizar', archivo: 'src/app/(sellup)/settings/users/add-user-drawer.tsx' },
      { texto: 'Inactivos', archivo: 'src/app/(sellup)/settings/users/users-groups-tabs.tsx' },
      { texto: 'Activar acceso', archivo: 'src/app/(sellup)/settings/users/user-actions.tsx' },
      { texto: 'Desactivar acceso', archivo: 'src/app/(sellup)/settings/users/user-actions.tsx' },
    ],
  },
  {
    key: 'calculadora-roi',
    titulo: 'Calculadora de ROI',
    palabrasClave: ['roi', 'calculadora', 'retorno', 'propuesta de valor', 'pdf', 'presentacion'],
    roles: 'todos',
    ruta: '/roi-calculator',
    contenido: [
      '*Dónde:* «Calculadora de ROI» en el menú lateral. Proyecta el valor para un prospecto sobre lo que invierte.',
      '*Pasos:* llena los datos del prospecto (mínimo población con acceso e inversión anual) o «Cargar ejemplo» → revisa el reporte → descarga el PDF («Descargar PDF»), la presentación (PPTX) o mira el guion de conversación.',
      'Todo queda en tu navegador. Sólo un administrador cambia los parámetros del modelo.',
    ].join('\n'),
    etiquetas: [
      { texto: 'Calculadora de ROI', archivo: 'src/config/navigation.ts' },
      { texto: 'Cargar ejemplo', archivo: 'src/app/(sellup)/roi-calculator/roi-calculator-client.tsx' },
      { texto: 'Descargar PDF', archivo: 'src/components/roi-calculator/panel-exports.tsx' },
    ],
  },
  {
    key: 'asistente-slack',
    titulo: 'Qué puedo hacer por Slack (este asistente)',
    palabrasClave: ['que puedes hacer', 'ayuda', 'asistente', 'bot', 'slack', 'comandos', 'como te uso', 'recordatorio'],
    roles: 'todos',
    ruta: null,
    contenido: [
      '*Consultar* (con los permisos de tu rol): tu resumen, empresas y su ficha completa (por nombre, NIT, dominio o ID), contactos, prospectos por revisar o descartados, búsquedas, uso de IA y, si eres administrador, usuarios, catálogos y presupuesto.',
      '*Acciones con botón de confirmar:* aprobar, descartar (con motivo) o asignar prospectos y empresas; mandarle a alguien de tu equipo un recordatorio de lo que tiene por revisar.',
      '*Avisos que te llegan por aquí:* cuando te asignan empresas, cuando termina una búsqueda tuya, solicitudes y respuestas de créditos y, a administradores, alertas de consumo.',
      '*Cómo:* escríbeme por mensaje directo o menciónanos en un canal. Recuerdo la conversación de las últimas horas.',
    ].join('\n'),
    etiquetas: [],
  },
];
