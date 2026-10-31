import { describe, expect, it } from 'vitest';
import { byLabel, makeNet, solveMNA } from '../engine/mna';
import { cramer, det, gauss } from '../engine/linalg';
import { parseSI, fmtEng } from '../engine/units';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.max(1e-300, Math.abs(b));

describe('unidades SI', () => {
  it('interpreta prefijos escritos libremente', () => {
    expect(parseSI('4,7k').value).toBeCloseTo(4700, 9);
    expect(parseSI('220 µF', 'F').value).toBeCloseTo(220e-6, 15);
    expect(parseSI('2 mA', 'A').value).toBeCloseTo(2e-3, 15);
    expect(parseSI('4k7').value).toBeCloseTo(4700, 9);
    expect(parseSI('10 kΩ', 'Ω').value).toBeCloseTo(1e4, 9);
    expect(parseSI('3.3M').value).toBeCloseTo(3.3e6, 3);
    expect(parseSI('1e-3').value).toBeCloseTo(1e-3, 15);
    expect(parseSI('5u').value).toBeCloseTo(5e-6, 15);
  });
  it('rechaza unidades mal escritas y campos vacíos', () => {
    expect(parseSI('').ok).toBe(false);
    expect(parseSI('abc').ok).toBe(false);
    expect(parseSI('4,7x').ok).toBe(false);
    expect(parseSI('5 V', 'A').ok).toBe(false);
  });
  it('formatea en ingeniería', () => {
    expect(fmtEng(4700, 'Ω')).toBe('4,7 kΩ');
    expect(fmtEng(0.002, 'A')).toBe('2 mA');
  });
});

describe('álgebra lineal', () => {
  it('Gauss, Cramer y determinante coinciden', () => {
    const A = [
      [2, 1, -1],
      [-3, -1, 2],
      [-2, 1, 2],
    ];
    const b = [8, -11, -3];
    const g = gauss(A, b);
    expect(g.x![0]).toBeCloseTo(2, 12);
    expect(g.x![1]).toBeCloseTo(3, 12);
    expect(g.x![2]).toBeCloseTo(-1, 12);
    const c = cramer(A, b);
    expect(c.x![1]).toBeCloseTo(3, 12);
    expect(det(A)).toBeCloseTo(-1, 12);
  });
  it('detecta sistemas singulares', () => {
    expect(gauss([[1, 2], [2, 4]], [1, 2]).singular).toBe(true);
  });
});

describe('MNA — casos analíticos', () => {
  it('divisor de voltaje', () => {
    const n = makeNet(3, [
      { label: 'E', kind: 'V', value: 15, n1: 1, n2: 0 },
      { label: 'R1', kind: 'R', value: 1000, n1: 1, n2: 2 },
      { label: 'R2', kind: 'R', value: 166.6666666666667, n1: 2, n2: 0 },
    ]);
    const r = solveMNA(n);
    expect(rel(r.V[2], (166.6666666666667 / 1166.666666666667) * 15)).toBeLessThan(1e-9);
  });
  it('divisor de corriente (material U3, ejemplo 1)', () => {
    const n = makeNet(2, [
      { label: 'Is', kind: 'I', value: 2, n1: 0, n2: 1 },
      { label: 'R1', kind: 'R', value: 100, n1: 1, n2: 0 },
      { label: 'R2', kind: 'R', value: 500, n1: 1, n2: 0 },
      { label: 'R3', kind: 'R', value: 1500, n1: 1, n2: 0 },
    ]);
    const r = solveMNA(n);
    const Req = (100 * 1500) / 1600;
    expect(rel(byLabel(r, 'R2')!.i, (Req / (Req + 500)) * 2)).toBeLessThan(1e-9);
    expect(byLabel(r, 'R2')!.i).toBeCloseTo(0.32, 2);
  });
  it('cuaderno: fuente dependiente 5Iₓ', () => {
    const n = makeNet(3, [
      { label: 'E', kind: 'V', value: 500, n1: 1, n2: 0 },
      { label: 'R5', kind: 'R', value: 5, n1: 1, n2: 2 },
      { label: 'R20', kind: 'R', value: 20, n1: 2, n2: 0 },
      { label: 'F', kind: 'CCCS', value: 5, n1: 0, n2: 2, ctrlRef: 'R5' },
    ]);
    const r = solveMNA(n);
    expect(rel(byLabel(r, 'R5')!.i, 4)).toBeLessThan(1e-9);
    expect(rel(byLabel(r, 'R20')!.i, 24)).toBeLessThan(1e-9);
    expect(rel(-byLabel(r, 'F')!.i, -20) || 0).toBeLessThan(1e-9);
    expect(rel(r.V[2], 480)).toBeLessThan(1e-9);
  });
  it('cuaderno: mallas con 4V_Δ, V_Δ = 30 I₄', () => {
    const n = makeNet(4, [
      { label: 'E', kind: 'V', value: 100, n1: 1, n2: 0 },
      { label: 'R80', kind: 'R', value: 80, n1: 1, n2: 0 },
      { label: 'R10', kind: 'R', value: 10, n1: 1, n2: 2 },
      { label: 'R60', kind: 'R', value: 60, n1: 2, n2: 0 },
      { label: 'D', kind: 'VCVS', value: 4, n1: 2, n2: 3, ctrlRef: 'R30' },
      { label: 'R20', kind: 'R', value: 20, n1: 3, n2: 0 },
      { label: 'R30', kind: 'R', value: 30, n1: 3, n2: 0 },
    ]);
    const r = solveMNA(n);
    const E = byLabel(r, 'E')!;
    expect(rel(-E.i, 3.75)).toBeLessThan(1e-9);
    expect(rel(E.p, -375)).toBeLessThan(1e-9);
    expect(rel(byLabel(r, 'D')!.p, 75)).toBeLessThan(1e-9);
    expect(rel(byLabel(r, 'R30')!.i, 0.5)).toBeLessThan(1e-9);
    const pR = ['R80', 'R10', 'R60', 'R20', 'R30'].reduce((s, l) => s + byLabel(r, l)!.p, 0);
    expect(rel(pR, 300)).toBeLessThan(1e-9);
  });
});
