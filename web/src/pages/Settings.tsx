import { useEffect, useState } from 'react';
import { Badge, Card, ErrorBox, Loading, Toggle } from '../components/ui';
import { fmtDateTime, post, put, useAction, useApi } from '../lib/api';

export function SettingsPage() {
  const d = useApi<any>('/settings');
  const sources = useApi<any[]>('/sources');
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (d.data) setS(d.data.settings); }, [d.data]);
  const save = useAction((b: any) => put('/settings', b), [['/settings']], { pending: 'Saving search settings…', success: { title: 'Search settings saved', body: 'The next job search (manual or scheduled) will use them.' }, error: 'Search settings were not saved' });
  const fx = useAction(() => post('/settings/fx/refresh'), [['/settings']], { pending: 'Fetching today’s exchange rates…', success: 'Exchange rates updated', error: 'Could not refresh exchange rates' });
  const backup = useAction(() => post('/admin/backup'), [], { pending: 'Backing up the database…', success: (r: any) => r?.error ? { title: 'Backup did not complete', body: r.error } : { title: 'Backup saved', body: r?.file ?? '' }, error: 'Backup failed' });
  if (d.isLoading || !s) return <Loading />;
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  const list = (k: string) => (s[k] ?? []).join(', ');
  const fromList = (v: string) => v.split(',').map((x) => x.trim()).filter(Boolean);
  const body = () => ({
    keywords: s.keywords, levels: s.levels, employment_types: s.employment_types, min_salary_ngn_monthly: Number(s.min_salary_ngn_monthly), target_salary_ngn_monthly: Number(s.target_salary_ngn_monthly),
    enabled_sources: s.enabled_sources, company_boards: s.company_boards, schedule_cron: s.schedule_cron, schedule_enabled: s.schedule_enabled, max_age_days: Number(s.max_age_days),
    scoring_weights: s.scoring_weights, fx_rates: s.fx_rates,
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Search settings</h1>
        <button className="btn btn-primary" onClick={() => save.mutate(body())} disabled={save.isPending}>Save</button>
      </div>
      <ErrorBox error={save.error} />
      {save.isSuccess && <p className="text-sm text-emerald-700">Saved.</p>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="What to look for">
          <div className="space-y-3">
            <div><label className="label">Keywords</label><input className="input" value={list('keywords')} onChange={(e) => set('keywords', fromList(e.target.value))} /></div>
            <div><label className="label">Levels</label><input className="input" value={list('levels')} onChange={(e) => set('levels', fromList(e.target.value))} /></div>
            <div><label className="label">Employment types</label><input className="input" value={list('employment_types')} onChange={(e) => set('employment_types', fromList(e.target.value))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="label">Minimum ₦ / month</label><input type="number" className="input" value={s.min_salary_ngn_monthly} onChange={(e) => set('min_salary_ngn_monthly', e.target.value)} /></div>
              <div><label className="label">Target ₦ / month (not a cap)</label><input type="number" className="input" value={s.target_salary_ngn_monthly} onChange={(e) => set('target_salary_ngn_monthly', e.target.value)} /></div>
              <div><label className="label">Ignore jobs older than (days)</label><input type="number" className="input" value={s.max_age_days} onChange={(e) => set('max_age_days', e.target.value)} /></div>
            </div>
          </div>
        </Card>
        <Card title="Schedule">
          <Toggle checked={s.schedule_enabled} onChange={(v) => set('schedule_enabled', v)} label="Run discovery automatically" />
          <label className="label mt-2">Cron expression</label><input className="input" value={s.schedule_cron} onChange={(e) => set('schedule_cron', e.target.value)} />
          <p className="mt-1 text-xs text-slate-500">“0 7 * * *” = every day at 07:00 server time. Open jobs are also re-checked every 6 hours.</p>
          <div className="mt-4 flex flex-wrap gap-2"><button className="btn" onClick={() => backup.mutate(undefined)}>Back up database now</button></div>
          {backup.data && <p className="mt-2 text-xs">{backup.data.file ?? backup.data.error}</p>}
        </Card>
        <Card title="Scoring weights (total 100)">
          <div className="grid grid-cols-2 gap-3">{Object.entries(s.scoring_weights).map(([k, v]) => <div key={k}><label className="label">{k}</label><input type="number" className="input" value={v as number} onChange={(e) => set('scoring_weights', { ...s.scoring_weights, [k]: Number(e.target.value) })} /></div>)}</div>
          <p className="mt-2 text-xs text-slate-500">Sum: {Object.values(s.scoring_weights).reduce((a: number, b: any) => a + Number(b), 0)}. Nigeria eligibility is a hard gate regardless of weights.</p>
        </Card>
        <Card title="Exchange rates (₦ per unit)" actions={<button className="btn" onClick={() => fx.mutate(undefined)} disabled={fx.isPending}>Refresh now</button>}>
          <p className="mb-2 text-xs text-slate-500">Last updated {fmtDateTime(s.fx_updated_at)}. NGN figures are estimates.</p>
          <div className="grid grid-cols-3 gap-2">{Object.entries(s.fx_rates).map(([k, v]) => <div key={k}><label className="label">{k}</label><input type="number" className="input" value={v as number} onChange={(e) => set('fx_rates', { ...s.fx_rates, [k]: Number(e.target.value) })} /></div>)}</div>
        </Card>
      </div>
      <Card title="Sources">
        <div className="grid gap-2 md:grid-cols-2">{(sources.data ?? []).map((src: any) => (
          <label key={src.id} className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1" disabled={!src.available} checked={s.enabled_sources.includes(src.id)} onChange={(e) => set('enabled_sources', e.target.checked ? [...s.enabled_sources, src.id] : s.enabled_sources.filter((x: string) => x !== src.id))} />
            <span><span className="font-medium">{src.name}</span> {src.available ? <Badge tone="green">{src.kind}</Badge> : <Badge tone="gray">manual import only</Badge>}<span className="block text-xs text-slate-500">{src.available ? src.access : src.unavailableReason}</span></span>
          </label>
        ))}</div>
      </Card>
      <Card title={`Company ATS boards (${s.company_boards.length})`}>
        <div className="space-y-1">{s.company_boards.map((b: any, i: number) => (
          <div key={i} className="flex items-center gap-2 text-sm"><Badge>{b.ats}</Badge><span className="font-medium">{b.company}</span><span className="text-xs text-slate-500">{b.slug}</span>
            <button className="ml-auto text-xs text-red-700 hover:underline" onClick={() => set('company_boards', s.company_boards.filter((_: any, j: number) => j !== i))}>remove</button></div>
        ))}</div>
        <AddBoard onAdd={(b) => set('company_boards', [...s.company_boards, b])} />
      </Card>
      <Card title="AI usage this month">
        <p className="text-sm">{d.data.ai.enabled ? `${d.data.ai.provider} · spent $${Number(d.data.ai.monthSpendUsd).toFixed(4)} of $${d.data.ai.monthlyBudgetUsd} budget` : 'AI is off — deterministic engine only.'}</p>
        <table className="mt-2 w-full text-xs"><thead className="text-left text-slate-500"><tr><th>Task</th><th>Model</th><th>Calls</th><th>Errors</th><th>Tokens in/out</th><th>Cost</th></tr></thead>
          <tbody>{d.data.ai.usage.map((u: any, i: number) => <tr key={i}><td>{u.task}</td><td>{u.model}</td><td>{u.calls}</td><td>{u.errors}</td><td>{u.input_tokens}/{u.output_tokens}</td><td>${u.cost_usd}</td></tr>)}</tbody></table>
      </Card>
    </div>
  );
}

function AddBoard({ onAdd }: { onAdd: (b: { ats: string; slug: string; company: string }) => void }) {
  const [b, setB] = useState({ ats: 'greenhouse', slug: '', company: '' });
  const test = useAction((x: any) => post('/settings/boards/test', x), [], { pending: 'Testing the job board…', success: 'Board test finished — result below', error: 'Board test failed' });
  return (
    <div className="mt-3 grid gap-2 md:grid-cols-[8rem_1fr_1fr_auto_auto]">
      <select className="input" value={b.ats} onChange={(e) => setB({ ...b, ats: e.target.value })}>{['greenhouse', 'lever', 'ashby', 'workable'].map((x) => <option key={x}>{x}</option>)}</select>
      <input className="input" placeholder="Board slug" value={b.slug} onChange={(e) => setB({ ...b, slug: e.target.value })} />
      <input className="input" placeholder="Company name" value={b.company} onChange={(e) => setB({ ...b, company: e.target.value })} />
      <button className="btn" disabled={!b.slug} onClick={() => test.mutate(b)}>Test</button>
      <button className="btn btn-primary" disabled={!b.slug || !b.company} onClick={() => onAdd(b)}>Add</button>
      {test.data && <p className="text-xs md:col-span-5">{JSON.stringify(test.data).slice(0, 200)}</p>}
      <ErrorBox error={test.error} />
    </div>
  );
}
