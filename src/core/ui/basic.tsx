import katex from 'katex';
import 'katex/dist/katex.min.css';
import React, { createContext, ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';
import { parseSI, fmtEng } from '../engine/units';

Chart.register(...registerables);

// ---------------- almacenamiento seguro ----------------
export function lsGet<T>(k: string, def: T): T {
  try {
    const v = localStorage.getItem(k);
    return v == null ? def : (JSON.parse(v) as T);
  } catch {
    return def;
  }
}
export function lsSet(k: string, v: unknown) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {
    /* sin almacenamiento */
  }
}
export function useLocal<T>(k: string, def: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useState<T>(() => lsGet(k, def));
  useEffect(() => lsSet(k, v), [k, v]);
  return [v, setV];
}

// ---------------- tema ----------------
export type Theme = 'light' | 'dark';
const ThemeCtx = createContext<{ theme: Theme; setTheme: (t: Theme) => void }>({ theme: 'light', setTheme: () => {} });
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useLocal<Theme>('tema', typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  return <ThemeCtx.Provider value={{ theme, setTheme }}>{children}</ThemeCtx.Provider>;
}
export const useTheme = () => useContext(ThemeCtx);

/** Colores para SVG y gráficas (no dependen de variables CSS, así exportan bien) */
export function usePalette() {
  const { theme } = useTheme();
  return useMemo(
    () =>
      theme === 'dark'
        ? { bg: '#171e27', grid: '#243040', wire: '#d6dde8', el: '#e6ebf2', text: '#e6ebf2', muted: '#9aa6b6', accent: '#5c9dff', node: '#8bb8ff', err: '#ff6b6b', sel: '#f0b04a', abs: '#ff7b8a', ent: '#4fd1c1', flow: '#ffd166', mesh: '#b39ddb', ok: '#4cc27f' }
        : { bg: '#ffffff', grid: '#e6eaf0', wire: '#1d2733', el: '#17202c', text: '#17202c', muted: '#5b6676', accent: '#1f6feb', node: '#0b4fbf', err: '#c62828', sel: '#d97706', abs: '#d1495b', ent: '#1b998b', flow: '#e09f00', mesh: '#7e57c2', ok: '#138a43' },
    [theme],
  );
}

// ---------------- KaTeX ----------------
export function Tex({ tex, block = false, className }: { tex: string; block?: boolean; className?: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(tex, { displayMode: block, throwOnError: false, strict: 'ignore', trust: false });
    } catch {
      return tex;
    }
  }, [tex, block]);
  return block ? <div className={`tex-block ${className ?? ''}`} dangerouslySetInnerHTML={{ __html: html }} /> : <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
/** Texto con fragmentos $...$ en LaTeX */
export function TexText({ text }: { text: string }) {
  const parts = text.split(/(\$[^$]+\$)/g);
  return (
    <>
      {parts.map((p, i) => (p.startsWith('$') && p.endsWith('$') && p.length > 2 ? <Tex key={i} tex={p.slice(1, -1)} /> : <React.Fragment key={i}>{p}</React.Fragment>))}
    </>
  );
}

// ---------------- campos numéricos con prefijo SI ----------------
export function SIField({ value, onChange, unit, label, width = 110, title }: { value: string; onChange: (s: string) => void; unit?: string; label?: ReactNode; width?: number; title?: string }) {
  const r = parseSI(value, unit);
  return (
    <span className="row" style={{ gap: 4 }} title={title}>
      {label && <label>{label}</label>}
      <input value={value} onChange={(e) => onChange(e.target.value)} className={r.ok ? '' : 'bad'} style={{ width }} inputMode="decimal" aria-label={typeof label === 'string' ? label : unit} />
      {unit && <span className="muted small">[{unit}]</span>}
      {!r.ok && <span className="small" style={{ color: 'var(--err)' }}>{r.error}</span>}
    </span>
  );
}
export const siVal = (s: string, unit?: string) => {
  const r = parseSI(s, unit);
  return r.ok ? r.value! : NaN;
};

// ---------------- Drawer (Aprender / Practicar / Plantillas) ----------------
export function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="drawer-back" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button onClick={onClose} aria-label="Cerrar">✕ Cerrar</button>
        </header>
        <div className="content">{children}</div>
      </div>
    </div>
  );
}

// ---------------- Las tres ventanillas ----------------
export function ThreePanels({ p1, p2, p3, titles = ['Armar el circuito', 'Solución', 'Cómo resolverlo de una mejor manera'] }: { p1: ReactNode; p2: ReactNode; p3: ReactNode; titles?: [string, string, string] | string[] }) {
  const [show, setShow] = useState(0);
  const panels = [p1, p2, p3];
  return (
    <>
      <div className="panel-switch no-print" role="tablist">
        {titles.map((t, i) => (
          <button key={i} className={show === i ? 'active' : ''} onClick={() => setShow(i)} role="tab" aria-selected={show === i}>
            {i + 1}. {t.split(' ')[0] === 'Cómo' ? 'Mejor manera' : t.split(' ')[0]}
          </button>
        ))}
      </div>
      <div className="panels single">
        {panels.map((p, i) => (
          <section key={i} className={`panel ${show === i ? 'show' : ''} ${i === 1 ? 'print-me' : ''}`} data-panel={i + 1}>
            <header>
              <span className="num">{i + 1}</span>
              <h2>Ventanilla {i + 1} — {titles[i]}</h2>
            </header>
            <div className="body">{p}</div>
          </section>
        ))}
      </div>
    </>
  );
}

// ---------------- Shell ----------------
export interface ShellMode {
  id: string;
  title: string;
  render: () => ReactNode;
}
export function Shell({ number, title, modes, learn, practice, templates, footer }: { number: number; title: string; modes: ShellMode[]; learn: ReactNode; practice: ReactNode; templates?: (close: () => void) => ReactNode; footer?: ReactNode }) {
  const { theme, setTheme } = useTheme();
  const [mode, setMode] = useLocal<string>(`modo-${number}`, modes[0].id);
  const [drawer, setDrawer] = useState<null | 'learn' | 'practice' | 'templates'>(null);
  const cur = modes.find((m) => m.id === mode) ?? modes[0];
  useEffect(() => {
    const h = (e: Event) => {
      const id = (e as CustomEvent).detail?.modeId;
      if (id) setMode(id);
      setDrawer(null);
    };
    window.addEventListener('plantilla', h);
    return () => window.removeEventListener('plantilla', h);
  }, [setMode]);
  useEffect(() => {
    document.title = `Simulador ${number} – ${title}`;
  }, [number, title]);
  return (
    <div className="app">
      <div className="topbar no-print">
        <h1>
          Simulador {number} – {title}
          <div className="sub">Circuitos I · Ingeniería Electromecánica · UMSS</div>
        </h1>
        <div className="menu">
          <button onClick={() => setDrawer('learn')}>📘 Aprender</button>
          <button onClick={() => setDrawer('practice')}>✏️ Practicar</button>
          {templates && <button onClick={() => setDrawer('templates')}>🧩 Plantillas</button>}
          <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} aria-label="Cambiar tema" title="Tema claro / oscuro">
            {theme === 'dark' ? '☀️ Claro' : '🌙 Oscuro'}
          </button>
        </div>
      </div>
      {modes.length > 1 && (
        <nav className="modes no-print" aria-label="Herramientas">
          {modes.map((m) => (
            <button key={m.id} className={m.id === cur.id ? 'active' : ''} onClick={() => setMode(m.id)}>
              {m.title}
            </button>
          ))}
        </nav>
      )}
      <React.Fragment key={cur.id}>{cur.render()}</React.Fragment>
      {footer}
      {drawer === 'learn' && (
        <Drawer title="Aprender — teoría desde cero" onClose={() => setDrawer(null)}>
          {learn}
        </Drawer>
      )}
      {drawer === 'practice' && (
        <Drawer title="Practicar — ejercicios con corrección" onClose={() => setDrawer(null)}>
          {practice}
        </Drawer>
      )}
      {drawer === 'templates' && templates && (
        <Drawer title="Plantillas — circuitos clásicos" onClose={() => setDrawer(null)}>
          {templates(() => setDrawer(null))}
        </Drawer>
      )}
    </div>
  );
}

// ---------------- Gráfica (Chart.js) ----------------
export interface Series {
  label: string;
  x: number[];
  y: number[];
  color?: string;
  dash?: number[];
  fill?: boolean | 'origin';
  width?: number;
  stepped?: boolean;
}
const NO_VLINES: { x: number; label: string; color?: string }[] = [];
const NO_POINTS: { x: number; y: number; label?: string; color?: string }[] = [];
export function Plot({ series, xLabel, yLabel, height = 260, vlines = NO_VLINES, points = NO_POINTS, onHover }: { series: Series[]; xLabel?: string; yLabel?: string; height?: number; vlines?: { x: number; label: string; color?: string }[]; points?: { x: number; y: number; label?: string; color?: string }[]; onHover?: (x: number | null) => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const chart = useRef<Chart | null>(null);
  const pal = usePalette();
  useEffect(() => {
    if (!ref.current) return;
    const colors = [pal.accent, pal.abs, pal.ent, pal.sel, pal.mesh, pal.muted];
    const vl = {
      id: 'vlines',
      afterDraw(c: Chart) {
        const { ctx, chartArea, scales } = c as any;
        ctx.save();
        for (const v of vlines) {
          const x = scales.x.getPixelForValue(v.x);
          if (x < chartArea.left || x > chartArea.right) continue;
          ctx.strokeStyle = v.color ?? pal.muted;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(x, chartArea.top);
          ctx.lineTo(x, chartArea.bottom);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = v.color ?? pal.muted;
          ctx.font = '11px system-ui';
          ctx.fillText(v.label, x + 3, chartArea.top + 11);
        }
        ctx.restore();
      },
    };
    const datasets: any[] = series.map((s, i) => ({
      label: s.label,
      data: s.x.map((x, k) => ({ x, y: s.y[k] })),
      borderColor: s.color ?? colors[i % colors.length],
      backgroundColor: (s.color ?? colors[i % colors.length]) + '33',
      borderDash: s.dash,
      borderWidth: s.width ?? 2,
      pointRadius: 0,
      fill: s.fill ?? false,
      stepped: s.stepped,
      tension: 0,
    }));
    if (points.length)
      datasets.push({ type: 'scatter', label: 'puntos', data: points.map((p) => ({ x: p.x, y: p.y })), pointRadius: 4, backgroundColor: points.map((p) => p.color ?? pal.sel), borderColor: points.map((p) => p.color ?? pal.sel) });
    chart.current?.destroy();
    chart.current = new Chart(ref.current, {
      type: 'line',
      data: { datasets },
      options: {
        animation: false,
        maintainAspectRatio: false,
        parsing: false,
        interaction: { mode: 'nearest', intersect: false, axis: 'x' },
        plugins: {
          legend: { labels: { color: pal.text, boxWidth: 14, font: { size: 11 }, filter: (it: any) => it.text !== 'puntos' } },
          tooltip: {
            callbacks: {
              title: (items: any[]) => (items[0] ? `${xLabel ?? 'x'} = ${fmtEng(items[0].parsed.x)}` : ''),
              label: (it: any) => `${it.dataset.label}: ${fmtEng(it.parsed.y)}`,
            },
          },
        },
        onHover: (_e: any, _els: any, c: any) => {
          if (!onHover) return;
          const ev = (_e as any).native as MouseEvent;
          if (!ev) return;
          const x = c.scales.x.getValueForPixel(ev.offsetX);
          onHover(x);
        },
        scales: {
          x: { type: 'linear', title: { display: !!xLabel, text: xLabel, color: pal.muted }, ticks: { color: pal.muted, callback: (v: any) => fmtEng(Number(v)) }, grid: { color: pal.grid } },
          y: { title: { display: !!yLabel, text: yLabel, color: pal.muted }, ticks: { color: pal.muted, callback: (v: any) => fmtEng(Number(v)) }, grid: { color: pal.grid } },
        },
      },
      plugins: [vl],
    });
    return () => {
      chart.current?.destroy();
      chart.current = null;
    };
  }, [series, xLabel, yLabel, pal, vlines, points, onHover]);
  return (
    <div className="plot" style={{ height }}>
      <canvas ref={ref} />
    </div>
  );
}

export function Kpi({ items }: { items: { l: ReactNode; v: ReactNode }[] }) {
  return (
    <div className="kpi">
      {items.map((it, i) => (
        <div key={i}>
          <div className="l">{it.l}</div>
          <div className="v">{it.v}</div>
        </div>
      ))}
    </div>
  );
}

/** Término del glosario con tooltip */
export function Term({ t, children }: { t: string; children: ReactNode }) {
  return (
    <span className="tip" title={t}>
      {children}
    </span>
  );
}

export function downloadText(name: string, text: string, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------- plantillas para herramientas sin circuito ----------------
/** Estado persistente que también se puede reemplazar desde «Plantillas». */
export function usePreset<T>(key: string, def: T): [T, (v: T | ((p: T) => T)) => void] {
  const [v, setV] = useLocal<T>(key, def);
  useEffect(() => {
    const h = (e: Event) => {
      const d = (e as CustomEvent).detail;
      if (d?.presetKey === key) {
        pendingPresets.delete(key);
        setV(d.value as T);
      }
    };
    window.addEventListener('plantilla', h);
    const pend = pendingPresets.get(key);
    if (pend !== undefined) {
      pendingPresets.delete(key);
      setV(pend as T);
    }
    return () => window.removeEventListener('plantilla', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return [v, setV];
}
const pendingPresets = new Map<string, unknown>();
export function sendPreset(key: string, value: unknown, modeId?: string) {
  pendingPresets.set(key, value);
  lsSet(key, value);
  window.dispatchEvent(new CustomEvent('plantilla', { detail: { presetKey: key, value, modeId } }));
}
