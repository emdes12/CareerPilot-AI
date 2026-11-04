import { RefreshCw } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, Eligibility, Empty, ErrorBox, Loading, Score, Stat } from '../components/ui';
import { ageLabel, fmtDate, fmtDateTime, post, useAction, useApi } from '../lib/api';

export function Dashboard() {
  const d = useApi<any>('/dashboard', { refetchInterval: 20000 });
  const auto = useApi<any>('/automation/dashboard');
  const run = useAction(() => post('/search/run'), [['/dashboard']], { success: (r: any) => r?.queued === false ? { title: 'A job search is already running', body: 'New results will appear on the Jobs page when it finishes.' } : { title: 'Job search started', body: 'Searching every enabled job board in the background. New matches appear on the Jobs page in a few minutes.' }, error: 'Could not start the job search' });
  if (d.isLoading) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} />;
  const c = d.data.counts;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">Dashboard</h1>
        <button className="btn btn-primary" disabled={run.isPending || d.data.running} onClick={() => run.mutate(undefined)}>
          <RefreshCw size={14} className={d.data.running ? 'animate-spin' : ''} /> {d.data.running ? 'Searching…' : 'Search all sources now'}
        </button>
      </div>
      <ErrorBox error={run.error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
        <Stat label="New today" value={c.new_today} />
        <Stat label="Jobs stored" value={c.total} />
        <Stat label="≥ 90%" value={c.excellent} />
        <Stat label="≥ 80%" value={c.above80} />
        <Stat label="≥ 70%" value={c.matching} />
        <Stat label="Nigeria OK" value={c.nigeria_ok} hint="eligible or likely" />
        <Stat label="Expired" value={c.expired} />
      </div>
      {auto.data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <Stat label="Submitted" value={auto.data.counts?.submitted ?? 0} hint="confirmed by Resend" />
          <Stat label="Awaiting you" value={auto.data.counts?.manual ?? 0} hint="handoff packages" />
          <Stat label="Pending approval" value={auto.data.pendingApprovals?.length ?? 0} />
          <Stat label="Blocked" value={auto.data.counts?.blocked ?? 0} />
          <Stat label="Failed" value={auto.data.counts?.failed ?? 0} />
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Top matches" className="lg:col-span-2" actions={<Link className="link text-sm" to="/jobs?recommended=1">All recommended →</Link>}>
          {!d.data.top.length ? <Empty>No analysed jobs yet. Run a search.</Empty> : (
            <ul className="divide-y divide-slate-100">
              {d.data.top.map((j: any) => (
                <li key={j.id} className="flex flex-wrap items-center gap-2 py-2">
                  <Score value={j.total_score} />
                  <Link to={`/jobs/${j.id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">{j.title} <span className="font-normal text-slate-500">· {j.company_name}</span></Link>
                  <Eligibility status={j.eligibility} />
                  {j.salary && <Badge>{j.salary}</Badge>}
                  <span className="text-xs text-slate-500">{ageLabel(j.posted_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Learn next (from real vacancies)">
          {!d.data.gap.length ? <Empty>Not enough data yet.</Empty> : (
            <ol className="space-y-2 text-sm">{d.data.gap.map((g: any) => <li key={g.skill}><span className="font-medium">{g.label}</span> <span className="text-slate-500">— in {g.demand} relevant jobs{g.unlocks ? `, would lift ${g.unlocks} to ≥70%` : ''}</span></li>)}</ol>
          )}
          <Link to="/skills" className="link mt-3 inline-block text-sm">Skills & development →</Link>
        </Card>
        <Card title="Pending your approval">
          {!auto.data?.pendingApprovals?.length ? <Empty>Nothing waiting.</Empty> : auto.data.pendingApprovals.map((p: any) => (
            <div key={p.job_id} className="flex items-center gap-2 py-1 text-sm"><Score value={p.total_score} /><Link className="link" to={`/jobs/${p.job_id}/workspace`}>{p.title} · {p.company_name}</Link></div>
          ))}
        </Card>
        <Card title="Follow-ups due">
          {!d.data.followups.length ? <Empty>None.</Empty> : d.data.followups.map((f: any) => <div key={f.job_id} className="py-1 text-sm"><Link className="link" to={`/jobs/${f.job_id}/workspace`}>{f.title} · {f.company_name}</Link> <span className="text-slate-500">{fmtDate(f.follow_up_at)}</span></div>)}
        </Card>
        <Card title="Recent searches">
          {d.data.runs.map((r: any) => (
            <div key={r.id} className="py-1 text-sm">
              <div>{fmtDateTime(r.started_at)} · <Badge tone={r.status === 'succeeded' ? 'green' : r.status === 'running' ? 'blue' : 'amber'}>{r.status}</Badge></div>
              <div className="text-xs text-slate-500">{r.fetched} fetched · {r.relevant} relevant · {r.inserted} new · {r.duplicates} duplicates · {(r.sources ?? []).filter((s: any) => !s.ok).length} source errors</div>
            </div>
          ))}
        </Card>
      </div>
    </div>
  );
}
