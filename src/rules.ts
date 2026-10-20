/**
 * REGLAS DE DETECCIÓN
 * 
 * Este archivo es el "cerebro" de la aplicacion. 
 * En lugar de tener la lógica de validación dispersa en el código, aquí tengo un catálogo
 * de consultas SQL. Cada regla es un SELECT que devuelve las filas sospechosas.
 * Si el SELECT devuelve 0 filas, significa que no hay fraude para esa regla.
 * 
 * Para añadir una regla nueva, hay que añadir un objeto al array RULES 
 * al final del archivo. No hay que tocar nada más del backend.
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low';

// Definicion de como debe estructurarse una regla
export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  recommendation: string;
  sql: string; // Aquí va la consulta cruda a MySQL.
}

// -------------------------------------------------------------------------
// PARÁMETROS AJUSTABLES
// Esto es mejor aqui, pues puesto en otro archivo tocaría hardcodearlo. 
// -------------------------------------------------------------------------
const WORK_START = 7; // La jornada empieza a las 7 AM.
const WORK_END = 19; // La jornada termina a las 7 PM (19hs).
const SALARY_SPIKE = 1.3; // Si el sueldo sube más de un 30% (1.3), es sospechoso.
const MASS_DOWNLOADS_PER_HOUR = 15; // Descargar 15 o más archivos en una hora es "masivo".
const ALLOWED_DEPARTMENTS = ["'RRHH'", "'Nómina'"].join(', '); // Los únicos que pueden ver expedientes.
const MIN_PAYMENTS_FOR_GHOST = 2; // Para considerar a alguien "fantasma", debe tener al menos 2 pagos.

// -------------------------------------------------------------------------
// HELPERS PARA LAS CONSULTAS
// -------------------------------------------------------------------------

// Esta función agarra el nombre 
// de la columna y le saca el alias.
const alias = (c: string) => c.split('.').pop()!;

// Formatea la fecha para que el frontend reciba '2026-05-01'
const D = (c: string, as = alias(c)) => `DATE_FORMAT(${c}, '%Y-%m-%d') AS ${as}`;

// Igual que el anterior, pero con hora: '2026-05-01 10:30:00'.
const T = (c: string, as = alias(c)) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s') AS ${as}`;

// Chequeo fines de semana con DAYOFWEEK DE MYSQL 
const OFF_HOURS = (col: string) => `(HOUR(${col}) < ${WORK_START} OR HOUR(${col}) >= ${WORK_END} OR DAYOFWEEK(${col}) IN (1, 7))`;


// -------------------------------------------------------------------------
// EL CATÁLOGO DE REGLAS 
// -------------------------------------------------------------------------
export const RULES: Rule[] = [
  {
    // REGLA 1: Le seguimos pagando a alguien que ya renunció/fue despedido.
    id: 'paid-after-termination',
    title: 'Pagos posteriores a la baja del empleado',
    severity: 'critical',
    description: 'Empleados con fecha de baja que siguen recibiendo pagos de nómina.',
    recommendation: 'Suspender el pago, recuperar fondos, revisar quién mantuvo activo el registro y la cuenta de destino.',
    // El truco acá es comparar el período del pago con el primer día del mes en que se dio de baja.
    // Si el período es mayor a la baja, ¡alerta!
    sql: `SELECT e.id AS employee_id, e.full_name, ${D('e.termination_date')}, ${D('p.period')}, p.net, p.bank_account, ${T('p.paid_at')}
          FROM payroll_payments p JOIN employees e ON e.id = p.employee_id
          WHERE e.termination_date IS NOT NULL AND p.period > DATE_FORMAT(e.termination_date, '%Y-%m-01')
          ORDER BY e.id, p.paid_at`,
  },
  {
    // REGLA 2: Alguien cambió la cuenta de destino del pago.
    id: 'payment-other-account',
    title: 'Pago a una cuenta distinta de la registrada',
    severity: 'critical',
    description: 'La cuenta bancaria del pago no coincide con la del maestro de empleados.',
    recommendation: 'Detener la transferencia, verificar con el empleado y revisar el cambio de cuenta en la auditoría.',
    // Un simple JOIN y comparar si las cuentas son distintas. Súper efectivo.
    sql: `SELECT e.id AS employee_id, e.full_name, ${D('p.period')}, p.net, e.bank_account AS registered_account, p.bank_account AS paid_account
          FROM payroll_payments p JOIN employees e ON e.id = p.employee_id
          WHERE p.bank_account <> e.bank_account ORDER BY p.paid_at`,
  },
  {
    // REGLA 3: Autoaprobación o falta de aprobación.
    id: 'unapproved-changes',
    title: 'Cambios sin aprobación o autoaprobados',
    severity: 'critical',
    description: 'Modificaciones sin aprobador, o donde quien aprueba es quien hizo el cambio (violación de segregación de funciones).',
    recommendation: 'Revertir los cambios, exigir doble control y revisar los privilegios del usuario.',
    // Aquí busco en el log de auditoría. Si el campo approved_by está vacío (NULL) o 
    // el que aprobó (approved_by) es el mismo que hizo el cambio (actor), saltó la liebre.
    sql: `SELECT id, ${T('ts')}, actor, action, record_id AS employee_id, field, old_value, new_value, approved_by
          FROM audit_log WHERE approved_by IS NULL OR approved_by = actor ORDER BY audit_log.ts`,
  },
  {
    // REGLA 4: Empleados fantasma compartiendo cuenta bancaria.
    id: 'shared-bank-account',
    title: 'Empleados que comparten cuenta bancaria',
    severity: 'high',
    description: 'Varias fichas de empleado con la misma cuenta de destino: patrón típico de empleado fantasma.',
    recommendation: 'Verificar la identidad de cada empleado y su existencia real; revisar quién creó las fichas.',
    // Uso una subconsulta: busco cuentas que estén repetidas más de una vez, y luego
    // listo todos los empleados asociados a esas cuentas duplicadas.
    sql: `SELECT e.bank_account, e.id AS employee_id, e.full_name, e.department, ${D('e.hire_date')}, e.created_by
          FROM employees e
          WHERE e.bank_account IN (SELECT bank_account FROM employees GROUP BY bank_account HAVING COUNT(*) > 1)
          ORDER BY e.bank_account, e.id`,
  },
  {
    // REGLA 5: Empleado que cobra pero nunca marcó tarjeta.
    id: 'ghost-no-activity',
    title: 'Empleados con pagos pero sin ninguna presencia laboral',
    severity: 'high',
    description: 'Reciben nómina y nunca han marcado asistencia ni iniciado sesión.',
    recommendation: 'Confirmar con el jefe directo y con RR. HH. que la persona existe y trabaja; revisar quién la dio de alta.',
    // La clave acá es el NOT EXISTS. Si no existe NINGÚN registro en attendance para ese empleado,
    // lo consideramos fantasma. También verifico si no tiene dirección (no_address) como pista extra.
    sql: `SELECT e.id AS employee_id, e.full_name, e.created_by, IF(e.address IS NULL, 'sí', 'no') AS no_address,
                 COUNT(p.id) AS payments, SUM(p.net) AS total_paid
          FROM employees e JOIN payroll_payments p ON p.employee_id = e.id
          WHERE NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id)
          GROUP BY e.id, e.full_name, e.created_by, e.address
          HAVING COUNT(p.id) >= ${MIN_PAYMENTS_FOR_GHOST} ORDER BY e.id`,
  },
  {
    // REGLA 6: Pagos duplicados en el mismo mes.
    id: 'duplicate-payment',
    title: 'Pagos duplicados en el mismo período',
    severity: 'high',
    description: 'Más de un pago al mismo empleado para el mismo mes.',
    recommendation: 'Recuperar el pago duplicado y revisar el proceso de conciliación.',
    // Agrupo por empleado y período. Si el COUNT es mayor a 1, es que le pagaron dos veces.
    sql: `SELECT employee_id, ${D('period')}, COUNT(*) AS payments, SUM(net) AS total_net
          FROM payroll_payments GROUP BY employee_id, period HAVING COUNT(*) > 1`,
  },
  {
    // REGLA 7: Aumentos de sueldo raros.
    id: 'salary-spike',
    title: 'Aumentos salariales atípicos',
    severity: 'high',
    description: `Incrementos de salario superiores al ${Math.round((SALARY_SPIKE - 1) * 100)} %.`,
    recommendation: 'Validar la justificación y la aprobación documentada del aumento.',
    // Esta fue un poco complicada. En el log de auditoría, los valores viejo y nuevo 
    // se guardan como texto. Así que uso CAST(... AS DECIMAL) para convertirlos a número,
    // calculo la división y luego busco los que superen el SALARY_SPIKE.
    sql: `SELECT id, ${T('ts')}, actor, record_id AS employee_id, old_value, new_value, ROUND(ratio, 2) AS ratio, approved_by
          FROM (SELECT *, CASE WHEN field = 'salary'
                              THEN CAST(new_value AS DECIMAL(14,2)) / NULLIF(CAST(old_value AS DECIMAL(14,2)), 0) END AS ratio
                FROM audit_log) a
          WHERE ratio > ${SALARY_SPIKE} ORDER BY a.ts`,
  },
  {
    // REGLA 8: Externos viendo expedientes.
    id: 'unauthorized-file-access',
    title: 'Acceso a expedientes desde áreas no autorizadas',
    severity: 'high',
    description: `Usuarios fuera de ${ALLOWED_DEPARTMENTS.replace(/'/g, '')} consultando expedientes de empleados.`,
    recommendation: 'Confirmar la justificación laboral; restringir permisos por rol.',
    // Aquí uso la constante ALLOWED_DEPARTMENTS que definí arriba. Cualquier acceso que NO venga de RRHH o Nómina, salta.
    sql: `SELECT ${T('ts')}, user_name, user_department, employee_id, doc_type, action, ip
          FROM file_access WHERE user_department NOT IN (${ALLOWED_DEPARTMENTS}) ORDER BY file_access.ts`,
  },
  {
    // REGLA 9: Robo de información masivo.
    id: 'mass-download',
    title: 'Descargas masivas de documentos',
    severity: 'high',
    description: `Un usuario descargó ${MASS_DOWNLOADS_PER_HOUR} o más documentos en una hora.`,
    recommendation: 'Revisar el destino de los archivos (IP, dispositivo), aplicar DLP y verificar con el usuario.',
    // Para agrupar por hora exacta, uso DATE_FORMAT(ts, '%Y-%m-%d %H:00'). Así, 
    // si alguien descargó 20 archivos a las 3:15 PM, todos caen en el grupo de las 3:00 PM.
    sql: `SELECT user_name, DATE_FORMAT(ts, '%Y-%m-%d %H:00') AS hour_start, COUNT(*) AS downloads,
                 COUNT(DISTINCT employee_id) AS employees, MIN(ip) AS ip
          FROM file_access WHERE action = 'download'
          GROUP BY user_name, DATE_FORMAT(ts, '%Y-%m-%d %H:00') HAVING COUNT(*) >= ${MASS_DOWNLOADS_PER_HOUR}`,
  },
  {
    // REGLA 10: Hackeos 
    id: 'off-hours-changes',
    title: 'Cambios de datos fuera de horario laboral',
    severity: 'medium',
    description: `Modificaciones fuera de ${WORK_START}:00–${WORK_END}:00 o en fin de semana.`,
    recommendation: 'Confirmar la necesidad del cambio nocturno o de fin de semana con el actor.',
    // Uso mi querida función OFF_HOURS para reutilizar la lógica.
    sql: `SELECT id, ${T('ts')}, actor, action, record_id AS employee_id, field, old_value, new_value, approved_by
          FROM audit_log WHERE ${OFF_HOURS('ts')} ORDER BY audit_log.ts`,
  },
  {
    // REGLA 11: Espionaje nocturno.
    id: 'off-hours-access',
    title: 'Accesos a expedientes fuera de horario',
    severity: 'medium',
    description: 'Usuarios con 3 o más accesos a expedientes fuera de la jornada laboral.',
    recommendation: 'Correlacionar con horarios del empleado y con accesos remotos (VPN).',
    // Similar a la anterior, pero agrupando por usuario y buscando que tenga 3 o más accesos.
    // También aprovecho para traer la primera y última hora en que lo hizo.
    sql: `SELECT user_name, user_department, COUNT(*) AS accesses,
                 DATE_FORMAT(MIN(ts), '%Y-%m-%d %H:%i:%s') AS first_ts, DATE_FORMAT(MAX(ts), '%Y-%m-%d %H:%i:%s') AS last_ts
          FROM file_access WHERE ${OFF_HOURS('ts')}
          GROUP BY user_name, user_department HAVING COUNT(*) >= 3 ORDER BY accesses DESC`,
  },
];