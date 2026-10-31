import React from 'react';
import { Kind } from '../engine/types';

export const U = 20; // px por unidad de grilla
export const LEN = 80; // largo de un elemento de dos terminales en px

/** Dibujo del símbolo en coordenadas locales: terminal a en (0,0), terminal b en (80,0). */
export function SymbolShape({ kind, color, closed, swMode, strokeWidth = 2, upright = 0 }: { kind: Kind; color: string; closed?: boolean; swMode?: 'open' | 'close'; strokeWidth?: number; upright?: number }) {
  const s = { stroke: color, strokeWidth, fill: 'none', strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'R':
    case 'G': {
      const pts = [20, 0, 23.3, -8, 30, 8, 36.7, -8, 43.3, 8, 50, -8, 56.7, 8, 60, 0];
      let d = 'M0 0 L20 0';
      for (let i = 2; i < pts.length; i += 2) d += ` L${pts[i]} ${pts[i + 1]}`;
      d += ' L80 0';
      return (
        <g>
          <path d={d} {...s} />
          {kind === 'G' && <circle cx={40} cy={0} r={2} fill={color} />}
        </g>
      );
    }
    case 'V':
      return (
        <g>
          <path d="M0 0 L24 0 M56 0 L80 0" {...s} />
          <circle cx={40} cy={0} r={16} {...s} />
        </g>
      );
    case 'I':
      return (
        <g>
          <path d="M0 0 L24 0 M56 0 L80 0" {...s} />
          <circle cx={40} cy={0} r={16} {...s} />
          <path d="M30 0 L50 0 M44 -5 L50 0 L44 5" {...s} />
        </g>
      );
    case 'VCVS':
    case 'CCVS':
      return (
        <g>
          <path d="M0 0 L24 0 M56 0 L80 0" {...s} />
          <path d="M24 0 L40 -16 L56 0 L40 16 Z" {...s} />
        </g>
      );
    case 'VCCS':
    case 'CCCS':
      return (
        <g>
          <path d="M0 0 L24 0 M56 0 L80 0" {...s} />
          <path d="M24 0 L40 -16 L56 0 L40 16 Z" {...s} />
          <path d="M31 0 L49 0 M43 -5 L49 0 L43 5" {...s} />
        </g>
      );
    case 'L':
      return <path d="M0 0 L18 0 A5.5 6 0 0 1 29 0 A5.5 6 0 0 1 40 0 A5.5 6 0 0 1 51 0 A5.5 6 0 0 1 62 0 L80 0" {...s} transform="scale(1,-1)" />;
    case 'C':
      return (
        <g>
          <path d="M0 0 L36 0 M44 0 L80 0" {...s} />
          <path d="M36 -13 L36 13 M44 -13 L44 13" {...s} strokeWidth={strokeWidth + 1} />
        </g>
      );
    case 'SW': {
      // hoja abierta o cerrada según el estado mostrado; flecha curva indica la acción en t0
      const blade = closed ? 'M24 0 L56 0' : 'M24 0 L54 -14';
      const arrow = swMode === 'open' ? 'M50 -2 A16 16 0 0 0 46 -16 M46 -16 L44 -10 M46 -16 L51 -13' : 'M58 -14 A16 16 0 0 1 60 -2 M60 -2 L56 -7 M60 -2 L62 -8';
      return (
        <g>
          <path d="M0 0 L24 0 M56 0 L80 0" {...s} />
          <circle cx={24} cy={0} r={2.5} fill={color} />
          <circle cx={56} cy={0} r={2.5} fill="none" stroke={color} strokeWidth={1.5} />
          <path d={blade} {...s} />
          <path d={arrow} {...s} strokeWidth={1.3} />
        </g>
      );
    }
    case 'AM':
    case 'VM':
      return (
        <g>
          <path d="M0 0 L26 0 M54 0 L80 0" {...s} />
          <circle cx={40} cy={0} r={14} {...s} />
          <text x={40} y={5} textAnchor="middle" fontSize={15} fontWeight={700} fill={color} transform={`rotate(${upright} 40 0)`}>
            {kind === 'AM' ? 'A' : 'V'}
          </text>
        </g>
      );
    case 'GND':
      return (
        <g>
          <path d="M0 0 L0 10 M-12 10 L12 10 M-7 15 L7 15 M-3 20 L3 20" {...s} />
        </g>
      );
  }
  return null;
}

export function PaletteIcon({ kind, color }: { kind: Kind; color: string }) {
  if (kind === 'GND')
    return (
      <svg viewBox="-20 -4 40 30">
        <SymbolShape kind="GND" color={color} />
      </svg>
    );
  return (
    <svg viewBox="-4 -20 88 40">
      <SymbolShape kind={kind} color={color} swMode="close" />
    </svg>
  );
}

export const PALETTE_NAMES: Record<Kind, string> = {
  R: 'Resistencia',
  G: 'Conductancia',
  V: 'Fuente V',
  I: 'Fuente I',
  VCVS: 'VCVS',
  VCCS: 'VCCS',
  CCVS: 'CCVS',
  CCCS: 'CCCS',
  L: 'Inductor',
  C: 'Capacitor',
  SW: 'Interruptor',
  AM: 'Amperímetro',
  VM: 'Voltímetro',
  GND: 'Tierra',
};
