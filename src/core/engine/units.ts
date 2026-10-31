// Unidades SI, prefijos y formato numérico en español (coma decimal).

export const E_SI = 1.602176634e-19; // C, valor exacto SI
export const E_MATERIAL = 1.6022e-19; // C, valor del material del curso
export const E_DOCENTE = 1.6e-19; // C, redondeo usado en clase

export type EChoice = 'si' | 'material' | 'docente';
export const E_VALUES: Record<EChoice, { value: number; label: string }> = {
  si: { value: E_SI, label: '1,602176634 × 10⁻¹⁹ C (exacto SI)' },
  material: { value: E_MATERIAL, label: '1,6022 × 10⁻¹⁹ C (material del curso)' },
  docente: { value: E_DOCENTE, label: '1,6 × 10⁻¹⁹ C (redondeo de clase)' },
};

export const PREFIXES: { sym: string; exp: number; name: string }[] = [
  { sym: 'T', exp: 12, name: 'tera' },
  { sym: 'G', exp: 9, name: 'giga' },
  { sym: 'M', exp: 6, name: 'mega' },
  { sym: 'k', exp: 3, name: 'kilo' },
  { sym: '', exp: 0, name: '' },
  { sym: 'm', exp: -3, name: 'mili' },
  { sym: 'µ', exp: -6, name: 'micro' },
  { sym: 'n', exp: -9, name: 'nano' },
  { sym: 'p', exp: -12, name: 'pico' },
];

const PREFIX_MAP: Record<string, number> = {
  T: 1e12, G: 1e9, M: 1e6, k: 1e3, K: 1e3, '': 1, m: 1e-3, u: 1e-6, µ: 1e-6, μ: 1e-6, n: 1e-9, p: 1e-12,
};

export const UNIT_SYMBOLS = ['Ω', 'ohm', 'ohms', 'ohmios', 'S', 'A', 'V', 'W', 'J', 'C', 'H', 'F', 's', 'Hz', 'Wh'];

export interface ParseResult {
  ok: boolean;
  value?: number;
  error?: string;
}

/**
 * Interpreta valores escritos libremente: "4,7k", "220 µF", "2 mA", "1e-3", "-5", "10 kΩ", "3.3M".
 * `unit` (opcional) es la unidad esperada; si el texto trae otra unidad incompatible se reporta.
 */
export function parseSI(text: string, unit?: string): ParseResult {
  if (text == null) return { ok: false, error: 'Campo vacío' };
  let s = String(text).trim();
  if (s === '') return { ok: false, error: 'Campo vacío: escriba un número (por ejemplo 4,7k).' };
  s = s.replace(/\s+/g, '');
  // punto de miles al estilo boliviano: 1.500 · 47.000 · 1.250.000,5
  if (/^[-+]?[1-9]\d{0,2}(\.\d{3})+(,\d+)?([a-zA-Zµμ].*)?$/.test(s)) s = s.replace(/\./g, '');
  // coma decimal -> punto (si no hay punto ya)
  if (/^[-+]?\d+,\d+/.test(s) && !/\./.test(s)) s = s.replace(',', '.');
  // "4k7" estilo serigrafía
  const rk = /^([-+]?\d+)([kKMGmunpµμ])(\d+)$/.exec(s);
  if (rk) s = `${rk[1]}.${rk[3]}${rk[2]}`;
  const m = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)(.*)$/.exec(s);
  if (!m) return { ok: false, error: `«${text}» no es un número válido. Ejemplos: 4,7k · 220µ · 2m · 1e-3` };
  let num = parseFloat(m[1]);
  let rest = m[2];
  if (rest === '') return { ok: true, value: num };
  // separar prefijo + unidad
  let unitPart = rest;
  let mult = 1;
  // casos especiales: "m" sola = mili; "M" = mega; "meg"
  if (/^meg/i.test(rest)) {
    mult = 1e6;
    unitPart = rest.slice(3);
  } else {
    const p = rest[0];
    const after = rest.slice(1);
    if (p in PREFIX_MAP && p !== '') {
      // ¿es prefijo o la unidad misma? Ej: "m" (mili) vs nada; "S" siemens; "F" farad.
      if (after === '' || isUnit(after)) {
        mult = PREFIX_MAP[p];
        unitPart = after;
      } else if (isUnit(rest)) {
        unitPart = rest;
      } else {
        return { ok: false, error: `Unidad mal escrita en «${text}». Use prefijos p, n, µ (o u), m, k, M, G seguidos de la unidad.` };
      }
    } else if (!isUnit(rest)) {
      return { ok: false, error: `Unidad mal escrita en «${text}». Use prefijos p, n, µ (o u), m, k, M, G seguidos de la unidad.` };
    }
  }
  if (unitPart && unit && normUnit(unitPart) !== normUnit(unit)) {
    return { ok: false, error: `La unidad «${unitPart}» no corresponde: aquí se espera [${unit}].` };
  }
  num *= mult;
  if (!isFinite(num)) return { ok: false, error: 'Número fuera de rango.' };
  return { ok: true, value: num };
}

function isUnit(u: string): boolean {
  return u === '' || UNIT_SYMBOLS.includes(u) || UNIT_SYMBOLS.map((x) => x.toLowerCase()).includes(u.toLowerCase());
}
function normUnit(u: string): string {
  const l = u.toLowerCase();
  if (['ω', 'ohm', 'ohms', 'ohmios'].includes(l)) return 'Ω';
  return u;
}

/** Formatea con coma decimal y cifras significativas. */
export function fmtNum(x: number, sig = 4): string {
  if (x === 0 || Object.is(x, -0)) return '0';
  if (!isFinite(x)) return x > 0 ? '∞' : x < 0 ? '−∞' : 'indefinido';
  const ax = Math.abs(x);
  let s: string;
  if (ax >= 1e6 || ax < 1e-4) {
    const e = Math.floor(Math.log10(ax));
    const mant = x / 10 ** e;
    s = `${trimZeros(mant.toPrecision(sig))} × 10${sup(e)}`;
  } else {
    s = trimZeros(x.toPrecision(sig));
    if (s.includes('e')) s = String(Number(s));
  }
  return s.replace('.', ',').replace(/^-/, '−');
}

function trimZeros(s: string): string {
  if (!s.includes('.') || s.includes('e')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** Formato de ingeniería con prefijo SI: 4700 Ω -> "4,7 kΩ". */
export function fmtEng(x: number, unit = '', sig = 4): string {
  if (!isFinite(x)) return fmtNum(x) + (unit ? ` ${unit}` : '');
  if (x === 0) return `0${unit ? ' ' + unit : ''}`;
  const ax = Math.abs(x);
  let exp3 = Math.floor(Math.log10(ax) / 3) * 3;
  exp3 = Math.max(-12, Math.min(12, exp3));
  const p = PREFIXES.find((q) => q.exp === exp3)!;
  let mant = x / 10 ** exp3;
  // evitar 1000 k por redondeo
  if (Math.abs(Number(mant.toPrecision(sig))) >= 1000 && exp3 < 12) {
    mant /= 1000;
    return fmtNum(mant, sig) + ' ' + (PREFIXES.find((q) => q.exp === exp3 + 3)!.sym) + unit;
  }
  return `${fmtNum(mant, sig)} ${p.sym}${unit}`.trimEnd();
}

/** Notación científica: mantisa en [1,10). */
export function toScientific(x: number, sig = 4): { mant: number; exp: number; text: string } {
  if (x === 0) return { mant: 0, exp: 0, text: '0' };
  const e = Math.floor(Math.log10(Math.abs(x)));
  const mant = x / 10 ** e;
  return { mant, exp: e, text: `${fmtNum(Number(mant.toPrecision(sig)), sig)} × 10${sup(e)}` };
}
const SUPS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
export function sup(n: number): string {
  return String(n)
    .split('')
    .map((c) => (c === '-' ? '⁻' : SUPS[Number(c)] ?? c))
    .join('');
}
/** Notación de ingeniería: exponente múltiplo de 3. */
export function toEngineering(x: number, sig = 4): { mant: number; exp: number; text: string } {
  if (x === 0) return { mant: 0, exp: 0, text: '0' };
  const e = Math.floor(Math.log10(Math.abs(x)) / 3) * 3;
  const mant = x / 10 ** e;
  return { mant, exp: e, text: `${fmtNum(Number(mant.toPrecision(sig)), sig)} × 10${sup(e)}` };
}

/** Número en LaTeX con coma decimal y notación ×10^{n}. */
export function texNum(x: number, sig = 4): string {
  if (x === 0) return '0';
  if (!isFinite(x)) return x > 0 ? '\\infty' : '-\\infty';
  const ax = Math.abs(x);
  if (ax >= 1e6 || ax < 1e-4) {
    const e = Math.floor(Math.log10(ax));
    const mant = Number((x / 10 ** e).toPrecision(sig));
    return `${trimZeros(String(mant)).replace('.', '{,}')}\\times 10^{${e}}`;
  }
  let s = trimZeros(x.toPrecision(sig));
  if (s.includes('e')) s = String(Number(s));
  return s.replace('.', '{,}');
}

/** Cantidad con unidad entre corchetes en LaTeX: 4,7\ [\Omega]. */
export function texQ(x: number, unit: string, sig = 4): string {
  return `${texNum(x, sig)}\\ [\\mathrm{${unitTex(unit)}}]`;
}
export function unitTex(u: string): string {
  return u.replace('Ω', '\\Omega').replace('µ', '\\mu ');
}

/** Redondeo seguro para mostrar */
export function round(x: number, d = 6): number {
  const f = 10 ** d;
  return Math.round(x * f) / f;
}

export const UNIT_NAMES: Record<string, string> = {
  Ω: 'ohmio', S: 'siemens', A: 'amperio', V: 'voltio', W: 'vatio', J: 'julio', C: 'culombio', H: 'henrio', F: 'faradio', s: 'segundo',
};
