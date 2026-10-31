import { describe, expect, it } from 'vitest';
import { compilePieces, evalDeriv, evalPW, integratePW, roots } from '../engine/expr';
import { E_SI, E_DOCENTE } from '../engine/units';

describe('U1: carga, corriente y funciones del tiempo', () => {
  it('cuaderno: I = 2,5 A durante 5 min ⇒ Q = 750 C; Nₑ = 4,68 × 10²¹ (4,69 × 10²¹ con 1,6 × 10⁻¹⁹)', () => {
    const Q = 2.5 * 5 * 60;
    expect(Q).toBe(750);
    expect(Number((Q / E_SI / 1e21).toFixed(2))).toBe(4.68);
    expect(Number((Q / E_DOCENTE / 1e21).toFixed(2))).toBe(4.69);
  });
  it('cuaderno: Q(t) = 6,5t² + 3,5 ⇒ I = 13t; I(3,4 s) = 44,2 A', () => {
    const pw = compilePieces([{ from: 0, to: 8, expr: '6,5t^2 + 3,5' }]);
    expect(pw.ok).toBe(true);
    expect(pw.pieces[0].poly).toEqual([3.5, 0, 6.5]);
    expect(evalDeriv(pw.pieces, 3.4)).toBeCloseTo(44.2, 10);
    expect(pw.pieces[0].dnode.toString().replace(/\s/g, '')).toBe('13*t');
  });
  it('integral y raíces de i(t)', () => {
    const pw = compilePieces([{ from: 0, to: 10, expr: '10 - 2*t' }]);
    const f = (t: number) => evalPW(pw.pieces, t);
    expect(integratePW(f, pw.pieces, 0, 5)).toBeCloseTo(25, 6);
    expect(roots(f, 0, 10)[0]).toBeCloseTo(5, 9);
  });
  it('rechaza expresiones inválidas', () => {
    expect(compilePieces([{ from: 0, to: 1, expr: '3*x' }]).ok).toBe(false);
    expect(compilePieces([{ from: 0, to: 1, expr: '' }]).ok).toBe(false);
    expect(compilePieces([{ from: 0, to: 1, expr: '2*(t' }]).ok).toBe(false);
  });
});
