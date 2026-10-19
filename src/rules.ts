/**
 * REGLAS DE DETECCIÓN. Cada regla es una consulta SQL (MySQL) que devuelve las filas de evidencia.
 * Para añadir una regla: agrega un objeto a RULES. No hay nada más que tocar.
 * Si la consulta devuelve 0 filas, la regla se considera "sin hallazgos".
 *
 * Las fechas se devuelven ya formateadas como texto (D / T) para no depender de zonas horarias del cliente.
 */
export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Rule {
  id: string;
  title: string;
  severity: Severity;
  description: string;
  recommendation: string;
  sql: string;
}

// ---- Parámetros ajustables ----
const WORK_START = 7; // hora de inicio de jornada (hora local de la empresa)
const WORK_END = 19; // hora de fin (exclusiva)
const SALARY_SPIKE = 1.3; // aumento > 30 % se considera atípico
const MASS_DOWNLOADS_PER_HOUR = 15;
const ALLOWED_DEPARTMENTS = ["'RRHH'", "'Nómina'"].join(', ');
const MIN_PAYMENTS_FOR_GHOST = 2;

// Formateadores de fecha: D('p.period') → DATE_FORMAT(p.period, '%Y-%m-%d') AS period
const alias = (c: string) => c.split('.').pop()!;
const D = (c: string, as = alias(c)) => `DATE_FORMAT(${c}, '%Y-%m-%d') AS ${as}`;
const T = (c: string, as = alias(c)) => `DATE_FORMAT(${c}, '%Y-%m-%d %H:%i:%s') AS ${as}`;

// DAYOFWEEK: 1 = domingo, 7 = sábado
const OFF_HOURS = (col: string) => `(HOUR(${col}) < ${WORK_START} OR HOUR(${col}) >= ${WORK_END} OR DAYOFWEEK(${col}) IN (1, 7))`;

export const RULES: Rule[] = [
  {
    id: 'paid-after-termination',
    title: 'Pagos posteriores a la baja del empleado',
    severity: 'critical',
    description: 'Empleados con fecha de baja que siguen recibiendo pagos de nómina.',
    recommendation: 'Suspender el pago, recuperar fondos, revisar quién mantuvo activo el registro y la cuenta de destino.',
    sql: `SELECT e.id AS employee_id, e.full_name, ${D('e.termination_date')}, ${D('p.period')}, p.net, p.bank_account, ${T('p.paid_at')}
          FROM payroll_payments p JOIN employees e ON e.id = p.employee_id
          WHERE e.termination_date IS NOT NULL AND p.period > DATE_FORMAT(e.termination_date, '%Y-%m-01')
          ORDER BY e.id, p.paid_at`,
  },
  {
    id: 'payment-other-account',
    title: 'Pago a una cuenta distinta de la registrada',
    severity: 'critical',
    description: 'La cuenta bancaria del pago no coincide con la del maestro de empleados.',
    recommendation: 'Detener la transferencia, verificar con el empleado y revisar el cambio de cuenta en la auditoría.',
    sql: `SELECT e.id AS employee_id, e.full_name, ${D('p.period')}, p.net, e.bank_account AS registered_account, p.bank_account AS paid_account
          FROM payroll_payments p JOIN employees e ON e.id = p.employee_id
          WHERE p.bank_account <> e.bank_account ORDER BY p.paid_at`,
  },
  {
    id: 'unapproved-changes',
    title: 'Cambios sin aprobación o autoaprobados',
    severity: 'critical',
    description: 'Modificaciones sin aprobador, o donde quien aprueba es quien hizo el cambio (violación de segregación de funciones).',
    recommendation: 'Revertir los cambios, exigir doble control y revisar los privilegios del usuario.',
    sql: `SELECT id, ${T('ts')}, actor, action, record_id AS employee_id, field, old_value, new_value, approved_by
          FROM audit_log WHERE approved_by IS NULL OR approved_by = actor ORDER BY audit_log.ts`,
  },
  {
    id: 'shared-bank-account',
    title: 'Empleados que comparten cuenta bancaria',
    severity: 'high',
    description: 'Varias fichas de empleado con la misma cuenta de destino: patrón típico de empleado fantasma.',
    recommendation: 'Verificar la identidad de cada empleado y su existencia real; revisar quién creó las fichas.',
    sql: `SELECT e.bank_account, e.id AS employee_id, e.full_name, e.department, ${D('e.hire_date')}, e.created_by
          FROM employees e
          WHERE e.bank_account IN (SELECT bank_account FROM employees GROUP BY bank_account HAVING COUNT(*) > 1)
          ORDER BY e.bank_account, e.id`,
  },
  {
    id: 'ghost-no-activity',
    title: 'Empleados con pagos pero sin ninguna presencia laboral',
    severity: 'high',
    description: 'Reciben nómina y nunca han marcado asistencia ni iniciado sesión.',
    recommendation: 'Confirmar con el jefe directo y con RR. HH. que la persona existe y trabaja; revisar quién la dio de alta.',
    sql: `SELECT e.id AS employee_id, e.full_name, e.created_by, IF(e.address IS NULL, 'sí', 'no') AS no_address,
                 COUNT(p.id) AS payments, SUM(p.net) AS total_paid
          FROM employees e JOIN payroll_payments p ON p.employee_id = e.id
          WHERE NOT EXISTS (SELECT 1 FROM attendance a WHERE a.employee_id = e.id)
          GROUP BY e.id, e.full_name, e.created_by, e.address
          HAVING COUNT(p.id) >= ${MIN_PAYMENTS_FOR_GHOST} ORDER BY e.id`,
  },
  {
    id: 'duplicate-payment',
    title: 'Pagos duplicados en el mismo período',
    severity: 'high',
    description: 'Más de un pago al mismo empleado para el mismo mes.',
    recommendation: 'Recuperar el pago duplicado y revisar el proceso de conciliación.',
    sql: `SELECT employee_id, ${D('period')}, COUNT(*) AS payments, SUM(net) AS total_net
          FROM payroll_payments GROUP BY employee_id, period HAVING COUNT(*) > 1`,
  },
  {
    id: 'salary-spike',
    title: 'Aumentos salariales atípicos',
    severity: 'high',
    description: `Incrementos de salario superiores al ${Math.round((SALARY_SPIKE - 1) * 100)} %.`,
    recommendation: 'Validar la justificación y la aprobación documentada del aumento.',
    sql: `SELECT id, ${T('ts')}, actor, record_id AS employee_id, old_value, new_value, ROUND(ratio, 2) AS ratio, approved_by
          FROM (SELECT *, CASE WHEN field = 'salary'
                              THEN CAST(new_value AS DECIMAL(14,2)) / NULLIF(CAST(old_value AS DECIMAL(14,2)), 0) END AS ratio
                FROM audit_log) a
          WHERE ratio > ${SALARY_SPIKE} ORDER BY a.ts`,
  },
  {
    id: 'unauthorized-file-access',
    title: 'Acceso a expedientes desde áreas no autorizadas',
    severity: 'high',
    description: `Usuarios fuera de ${ALLOWED_DEPARTMENTS.replace(/'/g, '')} consultando expedientes de empleados.`,
    recommendation: 'Confirmar la justificación laboral; restringir permisos por rol.',
    sql: `SELECT ${T('ts')}, user_name, user_department, employee_id, doc_type, action, ip
          FROM file_access WHERE user_department NOT IN (${ALLOWED_DEPARTMENTS}) ORDER BY file_access.ts`,
  },
  {
    id: 'mass-download',
    title: 'Descargas masivas de documentos',
    severity: 'high',
    description: `Un usuario descargó ${MASS_DOWNLOADS_PER_HOUR} o más documentos en una hora.`,
    recommendation: 'Revisar el destino de los archivos (IP, dispositivo), aplicar DLP y verificar con el usuario.',
    sql: `SELECT user_name, DATE_FORMAT(ts, '%Y-%m-%d %H:00') AS hour_start, COUNT(*) AS downloads,
                 COUNT(DISTINCT employee_id) AS employees, MIN(ip) AS ip
          FROM file_access WHERE action = 'download'
          GROUP BY user_name, DATE_FORMAT(ts, '%Y-%m-%d %H:00') HAVING COUNT(*) >= ${MASS_DOWNLOADS_PER_HOUR}`,
  },
  {
    id: 'off-hours-changes',
    title: 'Cambios de datos fuera de horario laboral',
    severity: 'medium',
    description: `Modificaciones fuera de ${WORK_START}:00–${WORK_END}:00 o en fin de semana.`,
    recommendation: 'Confirmar la necesidad del cambio nocturno o de fin de semana con el actor.',
    sql: `SELECT id, ${T('ts')}, actor, action, record_id AS employee_id, field, old_value, new_value, approved_by
          FROM audit_log WHERE ${OFF_HOURS('ts')} ORDER BY audit_log.ts`,
  },
  {
    id: 'off-hours-access',
    title: 'Accesos a expedientes fuera de horario',
    severity: 'medium',
    description: 'Usuarios con 3 o más accesos a expedientes fuera de la jornada laboral.',
    recommendation: 'Correlacionar con horarios del empleado y con accesos remotos (VPN).',
    sql: `SELECT user_name, user_department, COUNT(*) AS accesses,
                 DATE_FORMAT(MIN(ts), '%Y-%m-%d %H:%i:%s') AS first_ts, DATE_FORMAT(MAX(ts), '%Y-%m-%d %H:%i:%s') AS last_ts
          FROM file_access WHERE ${OFF_HOURS('ts')}
          GROUP BY user_name, user_department HAVING COUNT(*) >= 3 ORDER BY accesses DESC`,
  },
];
