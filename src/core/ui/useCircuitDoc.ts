import { useCallback, useEffect, useRef, useState } from 'react';
import { Circuit } from '../engine/types';
import { lsGet, lsSet } from './basic';

export function encodeCircuit(c: Circuit): string {
  const json = JSON.stringify(c);
  const b64 = btoa(unescape(encodeURIComponent(json)));
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function decodeCircuit(s: string): Circuit | null {
  try {
    const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(escape(atob(b64)));
    const c = JSON.parse(json);
    if (!c || !Array.isArray(c.elements) || !Array.isArray(c.wires)) return null;
    return c as Circuit;
  } catch {
    return null;
  }
}

export interface CircuitDoc {
  circuit: Circuit;
  /** cambio confirmado (entra al historial) */
  set: (c: Circuit) => void;
  /** cambio provisional (arrastre en curso, no entra al historial) */
  preview: (c: Circuit) => void;
  commit: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  load: (c: Circuit) => void;
  shareUrl: () => string;
  /** se incrementa cada vez que se carga un circuito completo */
  loadCount: number;
}

export function useCircuitDoc(key: string, initial: Circuit): CircuitDoc {
  const [present, setPresent] = useState<Circuit>(() => {
    if (typeof location !== 'undefined') {
      const m = /[#&]c=([^&]+)/.exec(location.hash);
      if (m) {
        const c = decodeCircuit(m[1]);
        if (c) return c;
      }
    }
    return lsGet<Circuit | null>(`circuito-${key}`, null) ?? initial;
  });
  const past = useRef<Circuit[]>([]);
  const future = useRef<Circuit[]>([]);
  const base = useRef<Circuit | null>(null);
  const [, force] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => lsSet(`circuito-${key}`, present), 300);
    return () => clearTimeout(t);
  }, [key, present]);
  const set = useCallback((c: Circuit) => {
    setPresent((p) => {
      past.current.push(base.current ?? p);
      if (past.current.length > 200) past.current.shift();
      base.current = null;
      future.current = [];
      return c;
    });
    force((x) => x + 1);
  }, []);
  const preview = useCallback((c: Circuit) => {
    setPresent((p) => {
      if (!base.current) base.current = p;
      return c;
    });
  }, []);
  const commit = useCallback(() => {
    setPresent((p) => {
      if (base.current) {
        past.current.push(base.current);
        base.current = null;
        future.current = [];
      }
      return p;
    });
    force((x) => x + 1);
  }, []);
  const undo = useCallback(() => {
    setPresent((p) => {
      const prev = past.current.pop();
      if (!prev) return p;
      future.current.push(p);
      return prev;
    });
    force((x) => x + 1);
  }, []);
  const redo = useCallback(() => {
    setPresent((p) => {
      const nx = future.current.pop();
      if (!nx) return p;
      past.current.push(p);
      return nx;
    });
    force((x) => x + 1);
  }, []);
  const [loadCount, setLoadCount] = useState(0);
  const load = useCallback(
    (c: Circuit) => {
      set(JSON.parse(JSON.stringify(c)));
      setLoadCount((n) => n + 1);
    },
    [set],
  );
  // abrir un enlace compartido en la misma pestaña (solo cambia el #)
  useEffect(() => {
    const h = () => {
      const m = /[#&]c=([^&]+)/.exec(location.hash);
      const c = m ? decodeCircuit(m[1]) : null;
      if (c) load(c);
    };
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, [load]);
  const shareUrl = useCallback(() => `${location.origin}${location.pathname}#c=${encodeCircuit(present)}`, [present]);
  return { circuit: present, set, preview, commit, undo, redo, canUndo: past.current.length > 0, canRedo: future.current.length > 0, load, shareUrl, loadCount };
}
