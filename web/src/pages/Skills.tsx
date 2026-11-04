import { Badge, Card, Empty, ErrorBox, Loading } from '../components/ui';
import { useApi } from '../lib/api';

export function Skills() {
  const g = useApi<any>('/skills/gap');
  const prof = useApi<any>('/profile');
  if (g.isLoading) return <Loading />;
  if (g.error) return <ErrorBox error={g.error} />;
  const levels = ['expert', 'advanced', 'intermediate', 'basic', 'learning'];
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Skills & development</h1>
      <p className="text-sm text-slate-600">Based on {g.data.analysedJobs} relevant vacancies you were matched against.</p>
      <Card title="What to learn next">
        {!g.data.recommendations.length ? <Empty>Not enough data yet.</Empty> : (
          <ol className="space-y-3">{g.data.recommendations.map((r: any, i: number) => (
            <li key={r.skill} className="text-sm"><span className="font-semibold">{i + 1}. {r.label}</span> <span className="text-slate-500">— appears in {r.demand} jobs{r.unlocks ? `; would lift ${r.unlocks} job(s) to ≥70%` : ''}</span>
              {r.why && <div className="text-slate-700">{r.why}</div>}{r.advice && <div className="text-slate-700">{r.advice}</div>}</li>
          ))}</ol>
        )}
      </Card>
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="In demand — you have">{g.data.have.slice(0, 20).map((x: any) => <div key={x.skill} className="text-sm">{x.label} <span className="text-xs text-slate-500">{x.demand}</span></div>)}</Card>
        <Card title="In demand — improve">{g.data.improve.slice(0, 20).map((x: any) => <div key={x.skill} className="text-sm">{x.label} <span className="text-xs text-slate-500">{x.demand}</span></div>)}</Card>
        <Card title="In demand — missing">{g.data.missing.slice(0, 20).map((x: any) => <div key={x.skill} className="text-sm">{x.label} <span className="text-xs text-slate-500">{x.demand}</span></div>)}</Card>
      </div>
      {prof.data && (
        <Card title="Your skills by proficiency">
          {levels.map((l) => {
            const s = prof.data.skills.filter((x: any) => x.proficiency === l);
            return s.length ? <div key={l} className="mb-2"><div className="label">{l}</div><div className="flex flex-wrap gap-1">{s.map((x: any) => <Badge key={x.name} tone={x.professional ? 'green' : 'gray'} title={x.evidence ?? ''}>{x.label}</Badge>)}</div></div> : null;
          })}
          <p className="text-xs text-slate-500">Green = used professionally.</p>
        </Card>
      )}
    </div>
  );
}
