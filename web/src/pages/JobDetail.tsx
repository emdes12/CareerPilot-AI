import { Check, Copy, Download, ExternalLink, Mail, Play, RefreshCw, Send } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, copy, Eligibility, Empty, ErrorBox, KV, Loading, Score } from '../components/ui';
import { ageLabel, fmtDate, fmtDateTime, naira, post, useAction, useApi } from '../lib/api';
import { toast } from '../lib/toast';
import { useComposer } from '../components/composer/ComposerContext';

const MATCH_TONE: Record<string, string> = { strong: 'green', partial: 'blue', transferable: 'amber', missing: 'red' };

export function JobDetail({ workspace = false }: { workspace?: boolean }) {
  const { id } = useParams();
  const key = `/jobs/${id}`;
  const d = useApi<any>(key);
  const act = useApi<any>(`/jobs/${id}/activity`, { refetchInterval: 8000 });
  const [runId, setRunId] = useState<number | null>(null);
  const run = useApi<any>(runId ? `/runs/${runId}` : null, { refetchInterval: runId ? 3000 : false });
  const inv = [[key], [`/jobs/${id}/activity`]];
  const pipeline = useAction(() => post(`/jobs/${id}/pipeline`), inv, { success: false, error: 'Could not start preparing the application' });
  const recheck = useAction(() => post(`/jobs/${id}/recheck`), inv, { pending: 'Checking the listing is still open…', success: (r: any) => r?.status === 'active' ? { title: 'Still open', body: 'The listing is live. Date and status updated.' } : r?.status === 'expired' || r?.status === 'closed' ? { title: 'This job has closed', body: 'It has been marked closed and won’t be sent.' } : { title: 'Check finished', body: `Result: ${r?.status ?? 'unknown'} — the site didn’t give a clear answer, so the status was not changed.` }, error: 'Could not check the listing' });
  const approve = useAction(() => post(`/jobs/${id}/approve`), inv, { success: false, error: 'Could not start sending' });
  const reject = useAction(() => post(`/jobs/${id}/reject`), inv, { success: { title: 'Declined', body: 'This application will not be sent.' } });
  const applied = useAction(() => post(`/jobs/${id}/mark-applied`, { note: 'Applied manually via the official link' }), inv, { success: () => ({ title: 'Marked as applied', body: 'Moved to Applications → Applied. Add follow-ups and interview dates there.' }) });
  const [finished, setFinished] = useState<any>(null);
  const composer = useComposer();
  const writeEmail = () => composer.open({ jobId: Number(id), prefill: true });
  useEffect(() => {
    if (runId && run.data && !['pending', 'running'].includes(run.data.status)) {
      const r = run.data; setRunId(null); setFinished(r);
      d.refetch().then((x) => toast(runToast(r, x.data?.documents ?? []))); act.refetch();
    }
  }, [run.data, runId]);

  if (d.isLoading) return <Loading />;
  if (d.error) return <ErrorBox error={d.error} />;
  const { job, analysis: a, research: r, application: app, company, documents } = d.data;
  const doc = (k: string) => documents.find((x: any) => x.kind === k);
  const running = run.data && ['pending', 'running'].includes(run.data.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link to="/jobs" className="text-xs text-slate-500 hover:underline">← Jobs</Link>
          <h1 className="text-xl font-semibold">{job.title}</h1>
          <div className="text-sm text-slate-600">{job.company_name} · {job.location_raw ?? 'Remote'}</div>
          <div className="mt-2 flex flex-wrap gap-2"><Score value={a?.total_score} /><Eligibility status={a?.eligibility?.status} /><Badge tone={job.status === 'active' ? 'green' : 'red'}>{job.status}</Badge>{app?.tier && <Badge tone="violet">{app.tier}</Badge>}{app?.status && <Badge>{app.status}</Badge>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn" title="Visits the listing again to confirm it is still open" onClick={() => recheck.mutate(undefined)} disabled={recheck.isPending}><RefreshCw size={14} /> Re-check open</button>
          <button className="btn btn-primary" disabled={pipeline.isPending || !!running} title="Re-checks the listing, scores it and writes a fresh tailored CV, cover letter, email and answers. It never sends anything." onClick={async () => { setFinished(null); const x = await pipeline.mutateAsync(undefined); setRunId(x.runId); toast({ kind: 'info', title: 'Preparing your application', body: 'This takes about a minute. Progress is shown at the top of the page.' }); }}><Play size={14} /> {running ? 'Agents working…' : 'Prepare application'}</button>
          <a className="btn" title="Opens the job on the employer's or job board's site in a new tab" href={r?.official_url ?? job.apply_url ?? job.source_url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Official listing</a>
        </div>
      </div>
      <ErrorBox error={pipeline.error || recheck.error || approve.error || applied.error} />
      {running && <RunPanel run={run.data} />}
      {!running && finished && <RunPanel run={finished} documents={documents} onClose={() => setFinished(null)} />}

      {/* ---------- Application workspace ---------- */}
      <Card title="Application workspace" actions={workspace ? null : <Link className="link text-sm" to={`/jobs/${id}/workspace`}>Open workspace view</Link>}>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3">
            <KV rows={[
              ['Apply via', r ? `${r.apply_method}${r.ats ? ` (${r.ats})` : ''}` : 'Not researched yet'],
              ['Official link', r?.official_url ? <a className="link" href={r.official_url} target="_blank" rel="noreferrer">{r.official_url}</a> : '—'],
              ['Link verified', r ? (r.official_url_verified ? <Badge tone="green">verified on employer ATS</Badge> : <Badge tone="amber">unverified</Badge>) : '—'],
              ['Application email', r?.apply_email ? <span>{r.apply_email} <Badge tone="green">published in listing</Badge></span> : 'None published — apply via the link'],
              ['Deadline', job.deadline ? fmtDate(job.deadline) : r?.deadline_text ?? 'Not stated'],
              ['Required', (r?.required_documents ?? []).join(', ') || '—'],
              ['Automation', app?.automation_status ?? 'not attempted'],
            ]} />
            <div className="flex flex-wrap gap-2 pt-2">
              {doc('cv') && <a className="btn" href={`/api/documents/${doc('cv').id}/download?format=pdf`}><Download size={14} /> CV (PDF)</a>}
              {doc('cv') && <a className="btn" href={`/api/documents/${doc('cv').id}/download?format=docx`}><Download size={14} /> CV (DOCX)</a>}
              {doc('cover_letter') && <a className="btn" href={`/api/documents/${doc('cover_letter').id}/download?format=pdf`}><Download size={14} /> Cover letter</a>}
              <button className="btn" title="Opens the email composer with this job's recipient (if published), subject, draft email and tailored documents. You review everything before sending." onClick={writeEmail}><Mail size={14} /> Write email</button>
              <button className="btn" title="Use after you have submitted the application yourself on the employer's site" onClick={() => applied.mutate(undefined)} disabled={applied.isPending || app?.status === 'applied'}><Check size={14} /> Mark as applied</button>
            </div>
            {r?.apply_email && doc('email') && (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm">
                <div className="mb-2 font-medium">Send by email (as Alawiye Muritala Adeshina)</div>
                <p className="mb-2 text-xs text-slate-600">Every check is re-run before sending. Nothing is sent unless your job-application sender is verified in Resend and email applications are allowed in Automation.</p>
                <div className="flex gap-2">
                  <button className="btn btn-primary" disabled={approve.isPending} onClick={async () => { if (confirm(`Send this application to ${r.apply_email} now?`)) { setFinished(null); const x = await approve.mutateAsync(undefined); setRunId(x.runId); toast({ kind: 'info', title: 'Checking everything before sending…' }); } }}><Send size={14} /> Approve & send</button>
                  <button className="btn" onClick={writeEmail} title="Edit the email yourself before sending"><Mail size={14} /> Edit in composer</button>
                  {app?.approval_status === 'pending' && <button className="btn" onClick={() => reject.mutate(undefined)}>Decline</button>}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <DocBlock title="Cover letter" d={doc('cover_letter')} text={doc('cover_letter') ? [...doc('cover_letter').content.paragraphs, doc('cover_letter').content.signoff].join('\n\n') : ''} />
            <DocBlock title="Application email" d={doc('email')} text={doc('email') ? `Subject: ${doc('email').content.subject}\n\n${doc('email').content.body}` : ''} />
          </div>
        </div>
        {doc('answers') && (
          <div className="mt-4">
            <h3 className="mb-2 text-sm font-semibold">Screening answers {doc('answers').content.sourcedFromForm && <Badge tone="green">questions from the real application form</Badge>}</h3>
            <div className="space-y-2">
              {[...doc('answers').content.formQuestions, ...doc('answers').content.common].map((x: any, i: number) => (
                <div key={i} className="rounded border border-slate-200 p-2 text-sm">
                  <div className="flex items-center justify-between gap-2"><span className="font-medium">{x.question}{x.required && <span className="text-red-600"> *</span>}</span><button className="text-xs text-slate-500 hover:underline" onClick={() => copy(x.answer)}><Copy size={12} className="inline" /> copy</button></div>
                  <div className={`whitespace-pre-wrap ${/\[[A-Z]/.test(x.answer) ? 'text-amber-800' : 'text-slate-700'}`}>{x.answer}</div>
                </div>
              ))}
            </div>
          </div>
        )}
        {doc('handoff') && <Handoff h={doc('handoff').content} onEmail={r?.apply_email ? writeEmail : undefined} />}
        {doc('cv') && <QaPanel docs={documents} />}
      </Card>

      {/* ---------- Analysis ---------- */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Why this score" className="lg:col-span-2">
          {!a ? <Empty>Not analysed yet.</Empty> : (
            <div className="space-y-3">
              <p className="text-sm">{a.rationale}</p>
              <p className="text-xs text-slate-500">The score measures how well the role matches your profile. It is not a hiring probability.</p>
              {a.breakdown.map((b: any) => (
                <div key={b.key}>
                  <div className="flex justify-between text-sm"><span>{b.label}</span><span className="font-medium">{b.score}/{b.max}</span></div>
                  <div className="h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-slate-700" style={{ width: `${(b.score / b.max) * 100}%` }} /></div>
                  <ul className="mt-1 text-xs text-slate-500">{(b.reasons ?? []).filter(Boolean).map((x: any, i: number) => <li key={i}>{typeof x === 'string' ? x : x.text}</li>)}</ul>
                </div>
              ))}
              {a.concerns?.length > 0 && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-900"><div className="font-medium">Concerns</div><ul className="list-disc pl-5">{a.concerns.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>}
            </div>
          )}
        </Card>
        <div className="space-y-4">
          <Card title="Dates">
            <KV rows={[
              ['Published', <span>{fmtDate(job.effective_published_at ?? job.posted_at)} <span className="text-slate-500">({ageLabel(job.effective_published_at ?? job.posted_at)})</span></span>],
              ['Date source', job.publication_note ?? 'Publication date unverified'],
              ['Original (ATS)', job.original_published_at ? fmtDate(job.original_published_at) : '—'],
              ['Source date', job.posted_at ? fmtDate(job.posted_at) : '—'],
              ['Last updated', job.source_updated_at ? fmtDate(job.source_updated_at) : '—'],
              ['Discovered', fmtDate(job.discovered_at)],
              ['Deadline', job.deadline ? fmtDate(job.deadline) : 'Not stated'],
              ['Verified open', job.last_verified_open_at ? fmtDateTime(job.last_verified_open_at) : 'Not yet'],
              ['Last check', `${fmtDateTime(job.last_checked_at)} — ${job.last_check_result ?? ''}`],
            ]} />
            {job.is_repost && <p className="mt-2 text-xs text-amber-800">This vacancy was re-listed; it is not treated as new.</p>}
          </Card>
          <Card title="Nigeria eligibility">
            <Eligibility status={a?.eligibility?.status} />
            <p className="mt-2 text-sm">{a?.eligibility?.summary}</p>
            {(a?.eligibility?.evidence ?? []).map((e: any, i: number) => {
              const text = typeof e === 'string' ? e : e?.text;
              const tone = e?.effect === 'positive' ? 'border-emerald-400' : e?.effect === 'negative' ? 'border-red-400' : 'border-slate-300';
              return <blockquote key={i} className={`mt-1 border-l-2 ${tone} pl-2 text-xs text-slate-600`}>{e?.effect === 'positive' ? '✓ ' : e?.effect === 'negative' ? '✗ ' : ''}{text}{e?.source && <span className="text-slate-400"> · {e.source}</span>}</blockquote>;
            })}
          </Card>
          <Card title="Salary">
            {a?.salary?.original ? <KV rows={[['Advertised', a.salary.original], ['≈ NGN / month', `${naira(a.salary.ngnMonthlyMin)}${a.salary.ngnMonthlyMax && a.salary.ngnMonthlyMax !== a.salary.ngnMonthlyMin ? ` – ${naira(a.salary.ngnMonthlyMax)}` : ''} (estimate)`], ['Against target', a.salary.status.replace(/_/g, ' ')], ['Note', a.salary.note]]} /> : <p className="text-sm text-slate-500">Not disclosed.</p>}
          </Card>
          <Card title="Company">
            <KV rows={[['Website', company?.website ? <a className="link" href={company.website} target="_blank" rel="noreferrer">{company.website}</a> : 'Not verified'], ['Careers page', r?.careers_page ?? '—'], ['Found on', d.data.source?.name ?? job.source], ['Also seen on', (job.also_seen_on ?? []).map((x: any) => x.source).join(', ') || '—']]} />
          </Card>
        </div>
      </div>

      <Card title="Requirements vs your profile">
        {!a ? <Empty>—</Empty> : (
          <div className="grid gap-2 md:grid-cols-2">
            {a.requirements.map((x: any) => (
              <div key={x.skill} className="flex items-start gap-2 text-sm"><Badge tone={MATCH_TONE[x.match]}>{x.match}</Badge><div><span className="font-medium">{x.label}</span> <span className="text-xs text-slate-500">({x.importance})</span><div className="text-xs text-slate-500">{x.note}</div></div></div>
            ))}
          </div>
        )}
      </Card>

      {r && <Card title="Research log (every check that was made)"><ul className="space-y-1 text-xs">{r.log.map((l: any, i: number) => <li key={i} className={l.ok ? 'text-slate-700' : 'text-slate-500'}>{l.ok ? '✓' : '✗'} <span className="font-medium">{l.step}</span> — {l.result} {l.url && <a className="link" href={l.url} target="_blank" rel="noreferrer">{l.url}</a>}</li>)}</ul></Card>}

      <Card title="Activity history">
        {!act.data ? <Loading /> : (
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-semibold uppercase text-slate-500">Events</h3>
              {!act.data.events.length ? <Empty>No activity yet.</Empty> : <ul className="space-y-1 text-sm">{act.data.events.map((e: any) => <li key={e.id}><span className="text-xs text-slate-500">{fmtDateTime(e.created_at)}</span> <Badge>{e.actor}</Badge> {e.message}</li>)}</ul>}
            </div>
            <div className="space-y-3">
              <h3 className="text-xs font-semibold uppercase text-slate-500">Application attempts</h3>
              {!act.data.attempts.length ? <Empty>None.</Empty> : act.data.attempts.map((t: any) => (
                <details key={t.id} className="rounded border border-slate-200 p-2 text-sm">
                  <summary className="cursor-pointer"><Badge tone={t.status === 'submitted' ? 'green' : t.status === 'failed' || t.status === 'blocked' ? 'red' : 'amber'}>{t.status}</Badge> {t.channel} · {fmtDateTime(t.created_at)} · {t.requested_by}</summary>
                  <p className="mt-1 text-xs">{t.reason}</p>
                  <ul className="mt-1 text-xs">{t.checks.map((c: any, i: number) => <li key={i} className={c.ok ? 'text-emerald-700' : 'text-red-700'}>{c.ok ? '✓' : '✗'} {c.check} — {c.detail}</li>)}</ul>
                </details>
              ))}
              <h3 className="text-xs font-semibold uppercase text-slate-500">Emails</h3>
              {!act.data.emails.length ? <Empty>None.</Empty> : act.data.emails.map((e: any) => <div key={e.id} className="text-xs">{fmtDateTime(e.created_at)} · {e.identity} · from {e.from_name} &lt;{e.from_email}&gt; → {e.to_email} · <Badge tone={e.status === 'accepted' || e.status === 'delivered' ? 'green' : 'amber'}>{e.status}</Badge> {e.error}</div>)}
              <h3 className="text-xs font-semibold uppercase text-slate-500">Notifications</h3>
              {!act.data.notifications.length ? <Empty>None.</Empty> : act.data.notifications.map((n: any) => <div key={n.id} className="text-xs">{fmtDateTime(n.created_at)} · {n.channel} · <Badge>{n.status}</Badge> {n.error}</div>)}
            </div>
          </div>
        )}
      </Card>

      <Card title="Full job description"><div className="max-h-[32rem] overflow-y-auto whitespace-pre-wrap text-sm text-slate-700">{job.description_text}</div></Card>
    </div>
  );
}

function DocBlock({ title, d, text }: { title: string; d: any; text: string }) {
  if (!d) return <div className="rounded border border-dashed border-slate-300 p-3 text-sm text-slate-500">{title}: not generated yet — press “Prepare application”.</div>;
  return (
    <div className="rounded border border-slate-200">
      <div className="flex items-center justify-between border-b border-slate-200 px-3 py-1.5 text-sm"><span className="font-medium">{title} <span className="text-xs font-normal text-slate-500">v{d.version} · {d.engine}</span></span><button className="text-xs text-slate-600 hover:underline" onClick={() => copy(text)}><Copy size={12} className="inline" /> copy</button></div>
      <div className="max-h-64 overflow-y-auto whitespace-pre-wrap p-3 text-sm">{text}</div>
    </div>
  );
}

function QaPanel({ docs }: { docs: any[] }) {
  const items = docs.filter((x) => x.qa && ['cv', 'cover_letter', 'email', 'answers'].includes(x.kind));
  if (!items.length) return null;
  return (
    <div className="mt-4">
      <h3 className="mb-2 text-sm font-semibold">Quality check</h3>
      <div className="grid gap-2 md:grid-cols-2">
        {items.map((x) => (
          <div key={x.id} className="rounded border border-slate-200 p-2 text-xs">
            <div className="mb-1 flex gap-2"><span className="font-medium">{x.kind.replace('_', ' ')}</span><Badge tone={x.qa.passed ? 'green' : 'red'}>{x.qa.passed ? 'QA passed' : 'QA failed'}</Badge><Badge tone={x.qa.submittable ? 'green' : 'amber'}>{x.qa.submittable ? 'ready to send' : 'needs your review'}</Badge></div>
            {x.qa.errors.map((e: string, i: number) => <div key={i} className="text-red-700">✗ {e}</div>)}
            {x.qa.warnings.map((w: string, i: number) => <div key={i} className="text-amber-800">• {w}</div>)}
          </div>
        ))}
      </div>
      <p className="mt-1 text-xs text-slate-500">Resolve evidence conflicts in <Link className="link" to="/evidence">My professional evidence</Link>; documents marked “needs your review” are never sent automatically.</p>
    </div>
  );
}

function Handoff({ h, onEmail }: { h: any; onEmail?: () => void }) {
  return (
    <div className="mt-4 rounded-md border border-violet-200 bg-violet-50 p-3 text-sm">
      <div className="font-semibold text-violet-900">{h.cta}</div>
      <p className="text-xs text-violet-900">{h.reason}</p>
      <ol className="mt-2 list-decimal space-y-0.5 pl-5">{h.steps.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
      <div className="mt-2 flex flex-wrap gap-2">
        {h.destination?.url && <a className="btn btn-primary" href={h.destination.url} target="_blank" rel="noreferrer"><ExternalLink size={14} /> Open the official application</a>}
        {onEmail && <button className="btn btn-primary" onClick={onEmail}><Mail size={14} /> Open in email composer</button>}
      </div>
    </div>
  );
}

/** Plain-language name for each step the agents run. */
const STEP: Record<string, string> = {
  recheck: 'Check the job is still open', extraction: 'Read the job description', company: 'Look up the company', appResearch: 'Find out how to apply',
  matching: 'Match your skills to the requirements', salary: 'Convert the salary to naira', score: 'Score how well the job fits you',
  cv: 'Write a CV tailored to this job', cover: 'Write the cover letter', documents: 'Save the documents and run the quality check',
  execute: 'Send the application', track: 'Update your application tracker', notify: 'Notify you', notifyConfig: 'Warn you about missing setup',
};
const SKIP_WHY: Record<string, string> = {
  execute: 'Not sent: “Prepare application” only writes documents. Nothing is sent unless you press “Approve & send” or turn on auto-apply.',
  notify: 'No alert needed: you started this yourself.', notifyConfig: 'Nothing to warn about.', cv: 'Not needed for this score.', cover: 'Not needed for this score.',
};
const latest = (docs: any[], kind: string) => docs.filter((x) => x.kind === kind).sort((a, b) => b.version - a.version)[0];

function runToast(r: any, docs: any[]) {
  const tasks: any[] = r.tasks ?? [];
  const failed = tasks.filter((t) => t.status === 'failed');
  if (r.workflow === 'apply') {
    const ex = tasks.find((t) => t.step === 'execute');
    return ex?.status === 'succeeded'
      ? { kind: 'success' as const, title: 'Application step finished', body: 'See the result at the top of the page and in Activity history.' }
      : { kind: 'error' as const, title: 'Application was not sent', body: ex?.error ?? 'A safety check did not pass. Details are at the top of the page.' };
  }
  if (r.status === 'failed' || failed.length) return { kind: 'error' as const, title: 'Preparation finished with problems', body: failed.map((t) => `${STEP[t.step] ?? t.step}: ${t.error ?? 'failed'}`).join('\n') };
  const cv = latest(docs, 'cv');
  return { kind: 'success' as const, title: 'Application prepared', body: cv ? `New CV (version ${cv.version}), cover letter, email and answers are ready below. Nothing was sent.` : 'All steps finished. Nothing was sent.' };
}

const DOC_LABEL: Record<string, string> = { cv: 'Tailored CV', cover_letter: 'Cover letter', email: 'Application email', answers: 'Screening answers' };

function RunPanel({ run, documents, onClose }: { run: any; documents?: any[]; onClose?: () => void }) {
  const tasks: any[] = run.tasks ?? [];
  const done = tasks.filter((t) => !['pending', 'running'].includes(t.status)).length;
  const isRunning = ['pending', 'running'].includes(run.status);
  const usedFallback = tasks.some((t) => (t.log ?? []).some((l: any) => /LLM unavailable|overloaded|out of quota/i.test(l.msg ?? '')));
  const docs = documents ?? [];
  const title = isRunning ? `Working… ${done} of ${tasks.length} steps done` : run.status === 'failed' ? 'Finished with problems' : run.workflow === 'apply' ? 'Application attempt finished' : 'Application prepared: nothing was sent';
  return (
    <Card title={title} actions={onClose ? <button className="text-xs text-slate-500 hover:underline" onClick={onClose}>Hide</button> : null}>
      {isRunning && <div className="mb-3 h-1.5 rounded bg-slate-100"><div className="h-1.5 rounded bg-slate-800 transition-all" style={{ width: `${tasks.length ? Math.max(5, (done / tasks.length) * 100) : 5}%` }} /></div>}
      <ol className="grid gap-1 text-sm md:grid-cols-2">
        {tasks.map((t) => (
          <li key={t.step} className="flex items-start gap-2">
            <span className={`mt-0.5 w-4 shrink-0 text-center ${t.status === 'succeeded' ? 'text-emerald-600' : t.status === 'failed' ? 'text-red-600' : t.status === 'running' ? 'text-blue-600' : 'text-slate-400'}`}>{t.status === 'succeeded' ? '✓' : t.status === 'failed' ? '✗' : t.status === 'running' ? '…' : t.status === 'skipped' ? '–' : '○'}</span>
            <span>
              <span className={t.status === 'skipped' ? 'text-slate-500' : ''}>{STEP[t.step] ?? t.step}</span>
              {t.status === 'skipped' && SKIP_WHY[t.step] && <span className="block text-xs text-slate-500">{SKIP_WHY[t.step]}</span>}
              {t.status === 'failed' && <span className="block text-xs text-red-700">{t.error}</span>}
            </span>
          </li>
        ))}
      </ol>
      {!isRunning && run.workflow !== 'apply' && (
        <div className="mt-4 grid gap-3 border-t border-slate-200 pt-3 text-sm md:grid-cols-2">
          <div>
            <div className="mb-1 font-semibold">What changed</div>
            <ul className="space-y-0.5">
              {Object.keys(DOC_LABEL).map((k) => {
                const x = latest(docs, k);
                if (!x) return null;
                return <li key={k}>{DOC_LABEL[k]}: version {x.version} {x.qa ? <Badge tone={x.qa.submittable ? 'green' : 'amber'}>{x.qa.submittable ? 'ready' : 'needs your review'}</Badge> : null}</li>;
              })}
              <li className="text-slate-600">Score and “still open” status refreshed.</li>
            </ul>
            {usedFallback && <p className="mt-1 text-xs text-amber-800">The AI service was busy, so CareerPilot’s built-in rules wrote these. They use only your verified evidence.</p>}
          </div>
          <div>
            <div className="mb-1 font-semibold">What to do next</div>
            <ol className="list-decimal space-y-0.5 pl-5">
              <li>Read the cover letter and answers below and fix anything shown in amber.</li>
              <li>Download the CV (PDF) and cover letter.</li>
              <li>Press <b>Official listing</b> and apply on the employer’s site.</li>
              <li>Come back and press <b>Mark as applied</b> so it’s tracked.</li>
            </ol>
          </div>
        </div>
      )}
    </Card>
  );
}
