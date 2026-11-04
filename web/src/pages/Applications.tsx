import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading, Score } from '../components/ui';
import { fmtDate, put, useAction, useApi } from '../lib/api';

const STATUSES = ['recommended', 'ready_to_apply', 'applied', 'assessment', 'interview', 'technical_interview', 'final_interview', 'offer', 'rejected', 'withdrawn', 'expired'];

export function Applications() {
  const [all, setAll] = useState(false);
  const key = `/applications${all ? '?all=1' : ''}`;
  const apps = useApi<any[]>(key);
  const upd = useAction(({ jobId, body }: { jobId: number; body: any }) => put(`/applications/${jobId}`, body), [[key]], { success: 'Application updated' });
  if (apps.isLoading) return <Loading />;
  if (apps.error) return <ErrorBox error={apps.error} />;
  const byStatus = STATUSES.map((s) => [s, apps.data!.filter((a) => a.status === s).length] as const).filter(([, n]) => n);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Applications</h1>
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Include discovered-only jobs</label>
      </div>
      <div className="flex flex-wrap gap-2">{byStatus.map(([s, n]) => <Badge key={s}>{s.replace(/_/g, ' ')}: {n}</Badge>)}</div>
      <ErrorBox error={upd.error} />
      <Card>
        {!apps.data!.length ? <Empty>No applications yet. Prepare one from a job page.</Empty> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2 pr-2">Match</th><th className="pr-2">Role</th><th className="pr-2">Status</th><th className="pr-2">Automation</th><th className="pr-2">Documents</th><th className="pr-2">Applied</th><th className="pr-2">Follow up</th><th>Notes</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {apps.data!.map((a) => (
                  <tr key={a.job_id} className="align-top">
                    <td className="py-2 pr-2"><Score value={a.total_score} /></td>
                    <td className="pr-2"><Link className="font-medium hover:underline" to={`/jobs/${a.job_id}/workspace`}>{a.title}</Link><div className="text-xs text-slate-500">{a.company_name}</div></td>
                    <td className="pr-2"><select className="input py-1 text-xs" value={a.status} onChange={(e) => upd.mutate({ jobId: a.job_id, body: { status: e.target.value } })}>{['discovered', ...STATUSES].map((s) => <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>)}</select></td>
                    <td className="pr-2 text-xs">{a.automation_status ?? '—'}{a.approval_status === 'pending' && <div><Badge tone="amber">approval pending</Badge></div>}</td>
                    <td className="pr-2 text-xs">{a.cv_version ? `CV v${a.cv_version}` : '—'}{a.cover_version ? ` · letter v${a.cover_version}` : ''}</td>
                    <td className="pr-2 text-xs">{fmtDate(a.applied_at)}</td>
                    <td className="pr-2 text-xs"><input type="date" className="input py-1 text-xs" value={a.follow_up_at ? a.follow_up_at.slice(0, 10) : ''} onChange={(e) => upd.mutate({ jobId: a.job_id, body: { follow_up_at: e.target.value || null } })} /></td>
                    <td><textarea className="input h-14 text-xs" defaultValue={a.notes ?? ''} onBlur={(e) => e.target.value !== (a.notes ?? '') && upd.mutate({ jobId: a.job_id, body: { notes: e.target.value } })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
