import { NetElement } from '../types';
import { texNum } from '../units';

const SUB: Record<string, string> = { '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '₅': '5', '₆': '6', '₇': '7', '₈': '8', '₉': '9', 'ₓ': 'x', 'ₐ': 'a', 'ₒ': 'o', 'ₑ': 'e' };
const GREEK: Record<string, string> = { Δ: '\\Delta ', δ: '\\delta ', α: '\\alpha ', β: '\\beta ', μ: '\\mu ', φ: '\\phi ', Ω: '\\Omega ', θ: '\\theta ', ω: '\\omega ' };

/** Convierte un nombre escrito por el usuario (Iₓ, V_Δ, Ia) a LaTeX. */
export function toTexName(s: string): string {
  let out = '';
  let sub = '';
  for (const ch of s) {
    if (SUB[ch]) sub += SUB[ch];
    else out += GREEK[ch] ?? ch;
  }
  out = out.trim();
  if (sub) out = `${out}_{${sub}}`;
  else if (!out.includes('_') && /^[A-Za-z]\w+$/.test(out) && out.length <= 4) out = `${out[0]}_{${out.slice(1)}}`;
  else if (out.includes('_') && !out.includes('{')) out = out.replace(/_(.+)$/, '_{$1}');
  return out;
}

export function labelTex(e: NetElement): string {
  return toTexName(e.label);
}
export function iName(e: NetElement): string {
  if (e.varName && /^[Ii]/.test(e.varName)) return toTexName(e.varName);
  return `I_{${e.label}}`;
}
export function vName(e: NetElement): string {
  if (e.varName && /^[VvE]/.test(e.varName)) return toTexName(e.varName);
  return `V_{${e.label}}`;
}
/** Símbolo de la variable de control de una fuente dependiente */
export function ctrlName(dep: NetElement, ctrl: NetElement | undefined): string {
  if (!ctrl) return '?';
  return dep.kind === 'VCVS' || dep.kind === 'VCCS' ? vName(ctrl) : iName(ctrl);
}
/** Valor de la fuente dependiente en LaTeX: 4V_Δ, 5I_x */
export function depTex(dep: NetElement, ctrl: NetElement | undefined): string {
  const k = dep.value;
  const kt = Math.abs(k - 1) < 1e-12 ? '' : texNum(k, 5);
  return `${kt}${ctrlName(dep, ctrl)}`;
}
