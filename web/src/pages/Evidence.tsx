import { Upload } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, Empty, ErrorBox, EvidenceStatus, Loading } from '../components/ui';
import { post, put, useAction, useApi } from '../lib/api';

export function Evidence() {
  const ev = useApi<any>('/evidence');
  const inv = [['/evidence']];
  const confirmC = useAction((id: number) => post(`/evidence/${id}/confirm`), inv, { success: 'Confirmed — documents can now use this' });
  const rejectC = useAction((id: number) => post(`/evidence/${id}/reject`), inv, { success: 'Removed — it won’t appear in documents' });
  const resolve = useAction(({ group, keepId }: { group: string; keepId: number }) => post(`/evidence/conflicts/${group}/resolve`, { keepId }), inv, { success: 'Conflict resolved — your choice is used everywhere' });
  const edit = useAction(({ id, value }: { id: number; value: string }) => put(`/evidence/${id}`, { value }), inv, { success: 'Change saved' });
  const add = useAction((b: any) => post('/evidence', b), inv, { success: 'Added to your evidence' });
  const upload = useAction((b: any) => post('/evidence/cv-upload', b), inv, { pending: 'Reading your CV…', success: 'CV read — new items are listed below for you to confirm', error: 'Could not read that CV' });
  const [filter, setFilter] = useState('');
  const [draft, setDraft] = useState({ entity_type: 'experience', entity_key: '', field: 'responsibility', value: '' });
  if (ev.isLoading) return <Loading />;
  if (ev.error) return <ErrorBox error={ev.error} />;
  const claims: any[] = ev.data.claims;
  const groups = [...new Set(claims.map((c) => `${c.entity_type}:${c.entity_key}`))];

  const onFile = async (f: File) => {
    const b64 = await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(f); });
    upload.mutate({ filename: f.name, contentBase64: b64 });
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My professional evidence</h1>
      <p className="text-sm text-slate-600">{ev.data.rule} Every CV line and cover-letter claim links back to one of these records. Nothing here is changed without you.</p>
      <div className="flex flex-wrap gap-2">{Object.entries(ev.data.counts).map(([k, v]) => <span key={k} className="flex items-center gap-1"><EvidenceStatus s={k} /><span className="text-sm">{String(v)}</span></span>)}</div>
      <ErrorBox error={confirmC.error || resolve.error || edit.error || add.error || upload.error} />

      {ev.data.conflicts.length > 0 && (
        <Card title={`Conflicts to resolve (${ev.data.conflicts.length})`}>
          <p className="mb-2 text-xs text-slate-500">Until you choose, documents use the most conservative public version and can’t be sent automatically.</p>
          <div className="space-y-3">
            {ev.data.conflicts.map((g: any) => (
              <div key={g.group} className="rounded border border-red-200 bg-red-50/40 p-3">
                <div className="mb-1 text-sm font-medium">{g.claims[0].entity_key} — {g.claims.map((c: any) => c.field).filter((x: string, i: number, a: string[]) => a.indexOf(x) === i).join(' / ')}</div>
                {g.claims.map((c: any) => (
                  <div key={c.id} className="flex flex-wrap items-center gap-2 py-1 text-sm">
                    <button className="btn py-0.5 text-xs" disabled={resolve.isPending} onClick={() => resolve.mutate({ group: g.group, keepId: c.id })}>This is correct</button>
                    <span className="font-medium">{c.field}:</span> “{c.value}” <Badge>{c.source_type}</Badge> {c.note && <span className="text-xs text-slate-500">{c.note}</span>}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Card>
      )}

      {ev.data.issues.filter((i: any) => i.kind !== 'conflict').length > 0 && (
        <Card title="Missing or unconfirmed">
          <ul className="space-y-1 text-sm">{ev.data.issues.filter((i: any) => i.kind !== 'conflict').map((i: any, n: number) => (
            <li key={n} className="flex flex-wrap items-center gap-2"><Badge tone={i.kind === 'missing' ? 'gray' : 'amber'}>{i.kind}</Badge>{i.message}{i.kind === 'unconfirmed' && <button className="btn py-0.5 text-xs" onClick={() => i.claimIds.forEach((id: number) => confirmC.mutate(id))}>Confirm</button>}</li>
          ))}</ul>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Upload a CV">
          <p className="mb-2 text-xs text-slate-500">PDF or DOCX. New details become “indicated” for you to confirm; disagreements with existing evidence are flagged as conflicts. Technologies found are shown for review only.</p>
          <label className="btn cursor-pointer"><Upload size={14} /> Choose file<input type="file" accept=".pdf,.docx" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} /></label>
          {upload.isPending && <p className="mt-2 text-sm text-slate-500">Reading…</p>}
          {upload.data && <div className="mt-2 text-sm"><div>{upload.data.employers.length} employers recognised.</div><ul className="text-xs">{upload.data.employers.map((e: any) => <li key={e.company}>{e.company}: {e.result}</li>)}</ul><div className="text-xs text-slate-500">{upload.data.note}</div></div>}
        </Card>
        <Card title="Add evidence you can confirm">
          <div className="grid grid-cols-3 gap-2">
            <select className="input" value={draft.entity_type} onChange={(e) => setDraft({ ...draft, entity_type: e.target.value })}>{['experience', 'project', 'education', 'profile'].map((x) => <option key={x}>{x}</option>)}</select>
            <input className="input col-span-2" placeholder="Company / project name" value={draft.entity_key} onChange={(e) => setDraft({ ...draft, entity_key: e.target.value })} />
            <select className="input" value={draft.field} onChange={(e) => setDraft({ ...draft, field: e.target.value })}>{['responsibility', 'achievement', 'technology', 'title', 'dates', 'contribution', 'fact'].map((x) => <option key={x}>{x}</option>)}</select>
            <input className="input col-span-2" placeholder={draft.field === 'dates' ? 'YYYY-MM|YYYY-MM or YYYY-MM|present' : 'Exactly what you did'} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
          </div>
          <button className="btn btn-primary mt-2" disabled={!draft.entity_key || !draft.value} onClick={() => { add.mutate(draft); setDraft({ ...draft, value: '' }); }}>Add as user-confirmed</button>
        </Card>
      </div>

      <Card title="Sources reviewed">
        <ul className="space-y-1 text-sm">{ev.data.sources.map((s: any) => <li key={s.id}><Badge tone={s.status === 'reviewed' ? 'green' : s.status === 'partial' ? 'amber' : 'gray'}>{s.status}</Badge> <span className="font-medium">{s.title}</span> {s.url && <a className="link text-xs" href={s.url.startsWith('http') ? s.url : undefined} target="_blank" rel="noreferrer">{s.url}</a>}<div className="text-xs text-slate-500">{s.detail}</div></li>)}</ul>
      </Card>

      <Card title="All evidence" actions={<input className="input w-56" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />}>
        {!groups.length ? <Empty>No evidence yet.</Empty> : groups.filter((g) => g.toLowerCase().includes(filter.toLowerCase())).map((g) => (
          <div key={g} className="mb-4">
            <h3 className="mb-1 text-sm font-semibold">{g.split(':').slice(1).join(':')} <span className="text-xs font-normal text-slate-500">{g.split(':')[0]}</span></h3>
            <ul className="divide-y divide-slate-100">
              {claims.filter((c) => `${c.entity_type}:${c.entity_key}` === g).map((c) => (
                <li key={c.id} className="flex flex-wrap items-start gap-2 py-1.5 text-sm">
                  <EvidenceStatus s={c.status} />
                  <span className="w-24 shrink-0 text-xs text-slate-500">{c.field}</span>
                  <span className="min-w-0 flex-1">{c.value || <em className="text-slate-400">{c.note}</em>}</span>
                  <span className="text-xs text-slate-500">{c.source_url ? <a className="link" href={c.source_url.startsWith('http') ? c.source_url : undefined} target="_blank" rel="noreferrer">{c.source_type}</a> : c.source_type}</span>
                  {c.status !== 'conflicting' && c.value && (
                    <span className="flex gap-1">
                      {c.status === 'indicated' && <button className="btn py-0 text-xs" onClick={() => confirmC.mutate(c.id)}>Confirm</button>}
                      <button className="btn py-0 text-xs" onClick={() => { const v = window.prompt('Correct this evidence', c.value); if (v && v !== c.value) edit.mutate({ id: c.id, value: v }); }}>Edit</button>
                      <button className="btn py-0 text-xs" onClick={() => window.confirm('Remove this claim from your evidence? It will no longer be used in documents.') && rejectC.mutate(c.id)}>Remove</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
}
