import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, ErrorBox, Loading } from '../components/ui';
import { post, put, useAction, useApi } from '../lib/api';

export function Profile() {
  const d = useApi<any>('/profile');
  const [p, setP] = useState<any>(null);
  useEffect(() => { if (d.data) setP(d.data.profile); }, [d.data]);
  const save = useAction((b: any) => put('/profile', b), [['/profile']], { pending: 'Saving profile…', success: { title: 'Profile saved', body: 'New documents will use these details. Press “Re-score all jobs” if you changed skills or targets.' } });
  const reanalyse = useAction(() => post('/profile/reanalyse'), [], { pending: 'Re-scoring every job against your profile…', success: (r: any) => ({ title: 'Jobs re-scored', body: `${r?.reanalysed ?? 0} jobs updated. Scores on the Jobs page are now current.` }), error: 'Re-scoring failed' });
  if (d.isLoading || !p) return <Loading />;
  const f = (k: string, label: string) => <div><label className="label">{label}</label><input className="input" value={p[k] ?? ''} onChange={(e) => setP({ ...p, [k]: e.target.value })} /></div>;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Profile</h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => reanalyse.mutate(undefined)} disabled={reanalyse.isPending}>{reanalyse.isPending ? 'Re-scoring…' : 'Re-score all jobs'}</button>
          <button className="btn btn-primary" onClick={() => save.mutate({ full_name: p.full_name, headline: p.headline, location: p.location, email: p.email, phone: p.phone, links: p.links, summary: p.summary, target_roles: p.target_roles, target_level: p.target_level, availability: p.availability })}>Save</button>
        </div>
      </div>
      <ErrorBox error={save.error} />
      {save.isSuccess && <p className="text-sm text-emerald-700">Saved.</p>}
      <Card title="Contact & targets">
        <div className="grid gap-3 md:grid-cols-2">
          {f('full_name', 'Full name')}{f('headline', 'Headline')}{f('email', 'Email (used in documents)')}{f('phone', 'Phone')}{f('location', 'Location')}{f('availability', 'Notice period / availability')}
          <div><label className="label">Portfolio</label><input className="input" value={p.links?.portfolio ?? ''} onChange={(e) => setP({ ...p, links: { ...p.links, portfolio: e.target.value } })} /></div>
          <div><label className="label">GitHub</label><input className="input" value={p.links?.github ?? ''} onChange={(e) => setP({ ...p, links: { ...p.links, github: e.target.value } })} /></div>
          <div><label className="label">LinkedIn</label><input className="input" value={p.links?.linkedin ?? ''} onChange={(e) => setP({ ...p, links: { ...p.links, linkedin: e.target.value } })} /></div>
          <div><label className="label">Target roles (comma separated)</label><input className="input" value={(p.target_roles ?? []).join(', ')} onChange={(e) => setP({ ...p, target_roles: e.target.value.split(',').map((x) => x.trim()).filter(Boolean) })} /></div>
        </div>
        <div className="mt-3"><label className="label">Summary</label><textarea className="input h-24" value={p.summary ?? ''} onChange={(e) => setP({ ...p, summary: e.target.value })} /></div>
      </Card>
      <Card title={`Experience (${d.data.professionalYears} years professional)`} actions={<Link className="link text-sm" to="/evidence">Edit via evidence →</Link>}>
        <p className="mb-2 text-xs text-slate-500">Shown as documents will present it: titles, dates and bullets come only from verified or user-confirmed evidence.</p>
        <div className="space-y-3">{d.data.experiences.map((e: any) => (
          <div key={e.id}>
            <div className="text-sm font-medium">{e.title} · {e.company} <span className="font-normal text-slate-500">{e.datesText ?? `${e.start_date ?? '?'} – ${e.is_current ? 'present' : e.end_date ?? '?'}`}</span></div>
            <ul className="list-disc pl-5 text-sm text-slate-700">{(e.bullets ?? []).map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
            <div className="mt-1 flex flex-wrap gap-1">{(e.technologies ?? []).map((t: string) => <Badge key={t}>{t}</Badge>)}</div>
          </div>
        ))}</div>
      </Card>
      <Card title="Projects">
        <div className="space-y-3">{d.data.projects.map((pr: any) => <div key={pr.id}><div className="text-sm font-medium">{pr.name} {pr.url && <a className="link text-xs" href={pr.url} target="_blank" rel="noreferrer">{pr.url}</a>}</div><p className="text-sm text-slate-700">{pr.contribution}</p><div className="mt-1 flex flex-wrap gap-1">{(pr.technologies ?? []).map((t: string) => <Badge key={t}>{t}</Badge>)}</div></div>)}</div>
      </Card>
      <Card title="Items to verify">
        <ul className="list-disc space-y-1 pl-5 text-sm">{(p.verification_flags ?? []).map((v: any, i: number) => <li key={i}>{typeof v === 'string' ? v : v.message ?? v.note ?? JSON.stringify(v)}</li>)}</ul>
      </Card>
    </div>
  );
}
