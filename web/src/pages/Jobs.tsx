import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, Eligibility, Empty, ErrorBox, Loading, Score } from '../components/ui';
import { ageLabel, fmtDate, naira, post, useAction, useApi } from '../lib/api';

const FRESH = [['', 'Any (≤ 30 days)'], ['1', 'Last 24 hours'], ['3', 'Last 3 days'], ['7', 'Last 7 days'], ['14', 'Last 14 days'], ['30', 'Last 30 days']];
const SORTS = [['smart', 'Newest eligible + best match'], ['match', 'Best match'], ['newest', 'Newest'], ['salary', 'Highest salary'], ['deadline', 'Deadline']];

export function Jobs() {
  const [sp, setSp] = useSearchParams();
  const [qText, setQText] = useState(sp.get('q') ?? '');
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n); };
  const qs = new URLSearchParams(sp); if (!qs.get('limit')) qs.set('limit', '100');
  const jobs = useApi<any>(`/jobs?${qs.toString()}`);
  const [url, setUrl] = useState(''); const [desc, setDesc] = useState('');
  const imp = useAction((b: any) => post('/jobs/import', b), [[`/jobs?${qs.toString()}`]], { pending: 'Importing and scoring the job…', success: (r: any) => ({ title: r?.duplicateOf ? 'Already in your list' : 'Job imported and scored', body: r?.duplicateOf ? `It matches job #${r.duplicateOf}.` : 'Open it from the list to see the score and prepare an application.' }), error: 'Could not import the job' });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Jobs</h1>
      <Card>
        <div className="grid gap-3 md:grid-cols-6">
          <div className="md:col-span-2"><label className="label">Search</label><input className="input" value={qText} onChange={(e) => setQText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && set('q', qText)} placeholder="Title or company" /></div>
          <div><label className="label">Published</label><select className="input" value={sp.get('postedWithin') ?? ''} onChange={(e) => set('postedWithin', e.target.value)}>{FRESH.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Sort</label><select className="input" value={sp.get('sort') ?? 'smart'} onChange={(e) => set('sort', e.target.value)}>{SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
          <div><label className="label">Min match</label><select className="input" value={sp.get('minScore') ?? ''} onChange={(e) => set('minScore', e.target.value)}>{['', '50', '70', '80', '90'].map((v) => <option key={v} value={v}>{v ? `≥ ${v}%` : 'Any'}</option>)}</select></div>
          <div><label className="label">Nigeria</label><select className="input" value={sp.get('eligibility') ?? ''} onChange={(e) => set('eligibility', e.target.value)}>
            <option value="">Any</option><option value="eligible,likely">Eligible or likely</option><option value="eligible">Eligible only</option><option value="unknown">Unknown</option></select></div>
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!sp.get('recommended')} onChange={(e) => set('recommended', e.target.checked ? '1' : '')} /> Recommended only (≥ 70%, actionable)</label>
          <label className="flex items-center gap-1.5"><input type="checkbox" checked={!!sp.get('includeOld')} onChange={(e) => set('includeOld', e.target.checked ? '1' : '')} /> Include jobs older than 30 days</label>
        </div>
      </Card>
      {jobs.isLoading ? <Loading /> : jobs.error ? <ErrorBox error={jobs.error} /> : (
        <Card title={`${jobs.data.total} jobs`}>
          {!jobs.data.jobs.length ? <Empty>No jobs match these filters.</Empty> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2 pr-2">Match</th><th className="pr-2">Role</th><th className="pr-2">Nigeria</th><th className="pr-2">Salary (≈ NGN/month)</th><th className="pr-2">Published</th><th className="pr-2">Source</th><th>Status</th></tr></thead>
                <tbody className="divide-y divide-slate-100">
                  {jobs.data.jobs.map((j: any) => (
                    <tr key={j.id} className="align-top">
                      <td className="py-2 pr-2"><Score value={j.total_score} /></td>
                      <td className="pr-2"><Link to={`/jobs/${j.id}`} className="font-medium hover:underline">{j.title}</Link><div className="text-xs text-slate-500">{j.company_name} · {j.location_raw ?? 'Remote'}</div></td>
                      <td className="pr-2"><Eligibility status={j.eligibility} /></td>
                      <td className="pr-2 text-xs">{j.salary?.original ? <><div>{j.salary.original}</div><div className="text-slate-500">≈ {naira(j.salary.ngnMonthlyMin)}{j.salary.ngnMonthlyMax && j.salary.ngnMonthlyMax !== j.salary.ngnMonthlyMin ? `–${naira(j.salary.ngnMonthlyMax)}` : ''}</div></> : <span className="text-slate-400">Not disclosed</span>}</td>
                      <td className="pr-2 text-xs">
                        <div>{ageLabel(j.effective_published_at ?? j.posted_at)}</div>
                        <div className="text-slate-500">{j.publication_verified ? 'verified on ATS' : 'date unverified'}</div>
                        {j.is_repost && <Badge tone="amber">re-listed</Badge>}
                        {j.last_verified_open_at && <div className="text-emerald-700">open as of {fmtDate(j.last_verified_open_at)}</div>}
                      </td>
                      <td className="pr-2 text-xs">{j.source}{j.official_url_verified ? <div className="text-emerald-700">official link verified</div> : null}</td>
                      <td className="text-xs">{j.app_status ?? '—'}{j.tier && <div className="text-slate-500">{j.tier}</div>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}
      <Card title="Add a job manually">
        <p className="mb-2 text-xs text-slate-500">Paste a job URL. Greenhouse/Lever/Ashby/Workable links are read through their public APIs. LinkedIn, Indeed, Glassdoor and Wellfound pages are never fetched automatically — paste the description text for those.</p>
        <div className="grid gap-2 md:grid-cols-[1fr_auto]">
          <input className="input" placeholder="https://…" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-primary" disabled={!url || imp.isPending} onClick={() => imp.mutate({ url, description: desc || undefined })}>Import</button>
        </div>
        <textarea className="input mt-2 h-20" placeholder="Optional: paste the job description (required for LinkedIn/Indeed links)" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <ErrorBox error={imp.error} />
        {imp.data && <p className="mt-2 text-sm">Imported. <Link className="link" to={`/jobs/${imp.data.id}`}>Open job →</Link></p>}
      </Card>
    </div>
  );
}
