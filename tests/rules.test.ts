import { beforeAll, describe, expect, test } from 'bun:test';
import { insertRows, normalizeValue, runFindings, tableRows, type Finding } from '../src/analysis';
import { sql } from '../src/db';
import { RULES } from '../src/rules';

// Requiere la BD MySQL levantada con datos de ejemplo: `bun run db:up`
let findings: Finding[] = [];
let dbUp = true;
beforeAll(async () => {
  try {
    findings = await runFindings();
  } catch {
    dbUp = false;
    console.warn('⚠ Base de datos no disponible: pruebas omitidas (ejecute `bun run db:up`).');
  }
});

const rule = (id: string) => findings.find((f) => f.id === id)!;
const ids = (f: Finding, col: string) => f.rows.map((r) => Number(r[col])).sort((a, b) => a - b);

describe('reglas de nómina sobre los datos de ejemplo', () => {
  test('todas las reglas se ejecutan', () => {
    if (!dbUp) return;
    expect(findings.map((f) => f.id).sort()).toEqual(RULES.map((r) => r.id).sort());
  });
  test('pagos tras la baja: empleado 12, may–sep', () => {
    if (!dbUp) return;
    expect(rule('paid-after-termination').count).toBe(5);
    expect(new Set(ids(rule('paid-after-termination'), 'employee_id'))).toEqual(new Set([12]));
  });
  test('empleados fantasma: 41 y 42', () => {
    if (!dbUp) return;
    expect(ids(rule('ghost-no-activity'), 'employee_id')).toEqual([41, 42]);
    expect(ids(rule('shared-bank-account'), 'employee_id')).toEqual([7, 41]);
  });
  test('pago duplicado (5) y pago a otra cuenta (19)', () => {
    if (!dbUp) return;
    expect(ids(rule('duplicate-payment'), 'employee_id')).toEqual([5]);
    expect(ids(rule('payment-other-account'), 'employee_id')).toEqual([19]);
  });
  test('cambios sin aprobación o autoaprobados + aumento atípico', () => {
    if (!dbUp) return;
    expect(rule('unapproved-changes').count).toBe(5);
    expect(rule('salary-spike').count).toBe(1);
    expect(rule('off-hours-changes').count).toBe(4);
  });
  test('accesos a expedientes', () => {
    if (!dbUp) return;
    expect(rule('unauthorized-file-access').count).toBe(12);
    expect(rule('mass-download').rows[0].user_name).toBe('jperez');
    expect(rule('off-hours-access').rows.map((r) => r.user_name).sort()).toEqual(['jperez', 'mlopez']);
  });
  test('los empleados normales no generan falsos positivos', () => {
    if (!dbUp) return;
    const flagged = findings.filter((f) => ['ghost-no-activity', 'shared-bank-account'].includes(f.id)).flatMap((f) => ids(f, 'employee_id'));
    expect(flagged.filter((id) => id !== 7 && id <= 40)).toEqual([]);
  });
});

describe('agregar datos', () => {
  test('normalizeValue: vacío → NULL y datetime-local → DATETIME', () => {
    expect(normalizeValue('')).toBeNull();
    expect(normalizeValue('  ')).toBeNull();
    expect(normalizeValue('2026-05-01T10:30')).toBe('2026-05-01 10:30:00');
    expect(normalizeValue('2026-05-01 10:30:15')).toBe('2026-05-01 10:30:15');
    expect(normalizeValue(5)).toBe(5);
    expect(() => normalizeValue({})).toThrow();
  });
  test('rechaza tablas no permitidas y filas vacías (sin tocar la BD)', async () => {
    await expect(insertRows('mysql.user', [{ a: 1 }])).rejects.toThrow('tabla no permitida');
    await expect(insertRows('employees', [])).rejects.toThrow('no hay filas');
  });
  test('rechaza columnas desconocidas y agrega un empleado', async () => {
    if (!dbUp) return;
    await expect(insertRows('employees', [{ nope: 1 }])).rejects.toThrow('columnas desconocidas');
    const stamp = String(Date.now());
    try {
      const n = await insertRows('employees', [
        { full_name: 'Prueba Temporal', national_id: `T-${stamp}`, department: 'TI', bank_account: `CO-T${stamp}`, address: '', salary: '1000000', hire_date: '2026-01-01', termination_date: '', created_by: 'test' },
      ]);
      expect(n).toBe(1);
      const rows = await tableRows('employees', 5);
      expect(rows.some((r) => r.created_by === 'test' && r.termination_date === null && r.address === null)).toBe(true);
    } finally {
      await sql.unsafe("DELETE FROM employees WHERE created_by = 'test'");
    }
  });
  test('una FK inexistente da un error legible', async () => {
    if (!dbUp) return;
    await expect(insertRows('attendance', [{ employee_id: 999999, ts: '2026-01-01 08:00:00' }])).rejects.toThrow();
  });
});
