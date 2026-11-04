import { CheckCircle2, Info, Loader2, X, XCircle } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

/** Small app-wide notification system: every button reports what happened. */
export type ToastKind = 'success' | 'error' | 'info' | 'loading';
export interface Toast { id: number; kind: ToastKind; title: string; body?: string; link?: { to: string; label: string }; sticky?: boolean }

let seq = 0;
let items: Toast[] = [];
const subs = new Set<(t: Toast[]) => void>();
const emit = () => subs.forEach((f) => f([...items]));

export function toast(t: Omit<Toast, 'id'> & { id?: number }): number {
  const id = t.id ?? ++seq;
  const next = { ...t, id } as Toast;
  items = items.some((x) => x.id === id) ? items.map((x) => (x.id === id ? next : x)) : [...items, next].slice(-5);
  emit();
  if (!next.sticky && next.kind !== 'loading') setTimeout(() => dismiss(id), next.kind === 'error' ? 10000 : 6000);
  return id;
}
export const dismiss = (id: number) => { items = items.filter((x) => x.id !== id); emit(); };

const ICON = { success: CheckCircle2, error: XCircle, info: Info, loading: Loader2 };
const TONE = { success: 'border-emerald-300 bg-emerald-50 text-emerald-900', error: 'border-red-300 bg-red-50 text-red-900', info: 'border-blue-300 bg-blue-50 text-blue-900', loading: 'border-slate-300 bg-white text-slate-800' };

export function Toaster() {
  const [list, setList] = useState<Toast[]>([]);
  useEffect(() => { subs.add(setList); return () => { subs.delete(setList); }; }, []);
  return (
    <div className="pointer-events-none fixed bottom-24 right-4 z-50 flex w-[22rem] max-w-[calc(100vw-2rem)] flex-col gap-2" role="status" aria-live="polite">
      {list.map((t) => {
        const Icon = ICON[t.kind];
        return (
          <div key={t.id} className={`pointer-events-auto flex gap-2 rounded-lg border p-3 text-sm shadow-lg ${TONE[t.kind]}`}>
            <Icon size={18} className={`mt-0.5 shrink-0 ${t.kind === 'loading' ? 'animate-spin' : ''}`} />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">{t.title}</div>
              {t.body && <div className="mt-0.5 whitespace-pre-line text-xs opacity-90">{t.body}</div>}
              {t.link && <Link className="mt-1 inline-block text-xs font-medium underline" to={t.link.to} onClick={() => dismiss(t.id)}>{t.link.label}</Link>}
            </div>
            <button className="shrink-0 opacity-60 hover:opacity-100" onClick={() => dismiss(t.id)} aria-label="Dismiss"><X size={14} /></button>
          </div>
        );
      })}
    </div>
  );
}
