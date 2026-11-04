import type { ReactNode } from 'react';

export function Card({ title, actions, children, className = '' }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold text-slate-800">{title}</h2><div className="flex flex-wrap gap-2">{actions}</div></div>}
      {children}
    </section>
  );
}

const TONES: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200', amber: 'bg-amber-50 text-amber-800 border-amber-200', red: 'bg-red-50 text-red-800 border-red-200',
  blue: 'bg-blue-50 text-blue-800 border-blue-200', gray: 'bg-slate-100 text-slate-700 border-slate-200', violet: 'bg-violet-50 text-violet-800 border-violet-200',
};
export const Badge = ({ tone = 'gray', children, title }: { tone?: keyof typeof TONES | string; children: ReactNode; title?: string }) =>
  <span title={title} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-xs font-medium ${TONES[tone] ?? TONES.gray}`}>{children}</span>;

export function Score({ value }: { value?: number | null }) {
  if (value == null) return <Badge>—</Badge>;
  const tone = value >= 90 ? 'violet' : value >= 80 ? 'green' : value >= 70 ? 'blue' : value >= 50 ? 'amber' : 'gray';
  return <Badge tone={tone} title="Profile match score — not a hiring probability">{value}%</Badge>;
}

export function Eligibility({ status }: { status?: string | null }) {
  const m: Record<string, [string, string]> = { eligible: ['green', 'Nigeria eligible'], likely: ['blue', 'Likely eligible'], unknown: ['amber', 'Eligibility unknown'], ineligible: ['red', 'Not eligible'] };
  const [tone, label] = m[status ?? 'unknown'] ?? m.unknown;
  return <Badge tone={tone}>{label}</Badge>;
}

export const EvidenceStatus = ({ s }: { s: string }) => {
  const m: Record<string, string> = { verified: 'green', user_confirmed: 'blue', indicated: 'amber', missing: 'gray', conflicting: 'red', rejected: 'gray' };
  return <Badge tone={m[s] ?? 'gray'}>{s.replace('_', '-')}</Badge>;
};

export const Empty = ({ children }: { children: ReactNode }) => <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
export const ErrorBox = ({ error }: { error: unknown }) => error ? <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">{(error as Error).message}</div> : null;
export const Loading = () => <p className="py-6 text-center text-sm text-slate-400">Loading…</p>;

export function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-1.5">
      <input type="checkbox" className="mt-1 h-4 w-4" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
    </label>
  );
}

export const Stat = ({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) => (
  <div className="card"><div className="text-xs uppercase tracking-wide text-slate-500">{label}</div><div className="mt-1 text-2xl font-semibold">{value}</div>{hint && <div className="text-xs text-slate-500">{hint}</div>}</div>
);

export function KV({ rows }: { rows: [string, ReactNode][] }) {
  return <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-4 gap-y-1.5 text-sm">{rows.map(([k, v]) => [<dt key={`${k}-k`} className="text-slate-500">{k}</dt>, <dd key={`${k}-v`} className="min-w-0 break-words">{v}</dd>])}</dl>;
}

export async function copy(text: string) { try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ } }
