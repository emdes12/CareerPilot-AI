import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtDateTime, useApi } from '../lib/api';

const tone = (s: string) => (s === 'succeeded' ? 'green' : s === 'failed' ? 'red' : s === 'partial' ? 'amber' : s === 'running' ? 'blue' : 'gray');

export function Runs() {
  const runs = useApi<any[]>('/runs', { refetchInterval: 5000 });
  const agents = useApi<any>('/agents');
  const [open, setOpen] = useState<number | null>(null);
  const run = useApi<any>(open ? `/runs/${open}` : null, { refetchInterval: 4000 });
  if (runs.isLoading) return <Loading />;
  if (runs.error) return <ErrorBox error={runs.error} />;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Agent runs</h1>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Recent workflow runs">
          {!runs.data!.length ? <Empty>No runs yet.</Empty> : <ul className="divide-y divide-slate-100 text-sm">{runs.data!.map((r) => (
            <li key={r.id} className={`cursor-pointer py-1.5 ${open === r.id ? 'bg-slate-50' : ''}`} onClick={() => setOpen(r.id)}>
              #{r.id} <Badge tone={tone(r.status)}>{r.status}</Badge> <span className="font-medium">{r.workflow}</span> {r.job_title && <span className="text-slate-600">· {r.job_title} @ {r.company_name}</span>}
              <div className="text-xs text-slate-500">{r.trigger} · {fmtDateTime(r.created_at)}</div>
            </li>
          ))}</ul>}
        </Card>
        <Card title={open ? `Run #${open}` : 'Run detail'}>
          {!open ? <Empty>Select a run.</Empty> : !run.data ? <Loading /> : (
            <div className="space-y-2 text-sm">
              {run.data.subject_type === 'job' && <Link className="link" to={`/jobs/${run.data.subject_id}`}>Open job →</Link>}
              {run.data.tasks.map((t: any) => (
                <details key={t.id} className="rounded border border-slate-200 p-2">
                  <summary className="cursor-pointer"><Badge tone={tone(t.status)}>{t.status}</Badge> <span className="font-medium">{t.step}</span> <span className="text-xs text-slate-500">{t.agent} · {t.engine ?? ''} · {t.duration_ms ?? 0}ms · attempts {t.attempts}</span></summary>
                  {t.error && <p className="mt-1 text-xs text-red-700">{t.error}</p>}
                  <ul className="mt-1 text-xs text-slate-600">{(t.log ?? []).map((l: any, i: number) => <li key={i}>{l.msg}</li>)}</ul>
                </details>
              ))}
            </div>
          )}
        </Card>
      </div>
      {agents.data && (
        <Card title={`Registered agents (${agents.data.agents.length})`}>
          <div className="grid gap-2 md:grid-cols-2">{agents.data.agents.map((a: any) => (
            <div key={a.name} className="rounded border border-slate-200 p-2 text-sm">
              <div className="font-medium">{a.name} <span className="text-xs text-slate-500">v{a.version}</span> {a.usesAi ? <Badge tone="blue">AI: {a.modelClass}</Badge> : <Badge>deterministic</Badge>}</div>
              <p className="text-xs text-slate-600">{a.description}</p>
              <p className="mt-1 text-xs text-slate-500">Tools: {a.tools.join(', ') || 'none'}{a.dependsOn.length ? ` · depends on ${a.dependsOn.join(', ')}` : ''}</p>
            </div>
          ))}</div>
        </Card>
      )}
    </div>
  );
}
