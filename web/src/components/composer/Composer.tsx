import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Briefcase, FileText, Loader2, Mail, Paperclip, Send, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { api, useApi } from '../../lib/api';
import { toast } from '../../lib/toast';
import { isBodyEmpty, useComposer, type LocalFile } from './ComposerContext';
import { RichEditor } from './RichEditor';

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;
const ACCEPT = '.pdf,.doc,.docx,.odt,.rtf,.txt,.md,.csv,.png,.jpg,.jpeg';
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const jobIdFromPath = (p: string) => { const m = p.match(/^\/jobs\/(\d+)/); return m ? Number(m[1]) : null; };

/** Floating "Compose email" button: global, bottom-right, hidden while the composer is open. */
export function ComposerFab() {
  const { isOpen, open } = useComposer();
  if (isOpen) return null;
  return (
    <button onClick={() => open()} aria-label="Compose email" title="Compose email"
      className="group fixed bottom-5 right-5 z-30 flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg ring-4 ring-white transition hover:bg-slate-700 focus:outline-none focus-visible:ring-slate-400">
      <Mail size={22} />
      <span className="pointer-events-none absolute right-16 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-xs opacity-0 transition group-hover:opacity-100 group-focus-visible:opacity-100">Compose email</span>
    </button>
  );
}

/**
 * The composer. Desktop (md+): a right-hand column in the app's flex row that animates its width,
 * so the page beside it shrinks instead of being covered. Mobile: a full-height sheet sliding up.
 */
export function ComposerDock() {
  const { isOpen, close } = useComposer();
  const ref = useRef<HTMLDivElement>(null);
  // Closed panel must not be reachable by Tab / screen readers.
  useEffect(() => { const el = ref.current; if (!el) return; if (isOpen) el.removeAttribute('inert'); else el.setAttribute('inert', ''); }, [isOpen]);
  return (
    <div ref={ref} aria-hidden={!isOpen}
      className={`fixed inset-0 z-40 transition-transform duration-300 ease-out md:sticky md:inset-auto md:top-0 md:z-auto md:h-screen md:shrink-0 md:translate-y-0 md:overflow-hidden md:transition-[width] ${isOpen ? 'translate-y-0 md:w-[440px] xl:w-[500px]' : 'translate-y-full md:w-0'}`}
      onKeyDown={(e) => { if (e.key === 'Escape') close(); }}>
      <section role="dialog" aria-label="Compose email" className="flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-xl md:w-[440px] md:shadow-none xl:w-[500px]">
        {isOpen && <ComposerForm />}
      </section>
    </div>
  );
}

function RecipientField({ label, values, onChange, autoFocus }: { label: string; values: string[]; onChange: (v: string[]) => void; autoFocus?: boolean }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const commit = (raw = text) => {
    const parts = raw.split(/[\s,;]+/).map((x) => x.trim().replace(/^<|>$/g, '')).filter(Boolean);
    if (!parts.length) return true;
    const bad = parts.filter((p) => !EMAIL_RE.test(p));
    const good = parts.filter((p) => EMAIL_RE.test(p) && !values.includes(p.toLowerCase())).map((p) => p.toLowerCase());
    if (good.length) onChange([...values, ...good]);
    setText(bad.join(' ')); setErr(bad.length ? `Not a valid email: ${bad.join(', ')}` : null);
    return !bad.length;
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (['Enter', ',', ';', 'Tab'].includes(e.key) && text.trim()) { if (e.key !== 'Tab') e.preventDefault(); commit(); }
    if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
  };
  const id = `rcpt-${label}`;
  return (
    <div>
      <div className={`flex flex-wrap items-center gap-1 rounded-md border px-2 py-1 ${err ? 'border-red-400' : 'border-slate-300 focus-within:border-slate-500'}`}>
        <label htmlFor={id} className="w-8 shrink-0 text-xs font-medium text-slate-500">{label}</label>
        {values.map((v) => (
          <span key={v} className="flex items-center gap-1 rounded bg-slate-100 px-1.5 py-0.5 text-xs">{v}
            <button type="button" aria-label={`Remove ${v}`} onClick={() => onChange(values.filter((x) => x !== v))} className="text-slate-500 hover:text-slate-900"><X size={12} /></button></span>
        ))}
        <input id={id} autoFocus={autoFocus} className="min-w-[8rem] flex-1 py-0.5 text-sm focus:outline-none" type="email" inputMode="email" autoComplete="email" multiple
          value={text} onChange={(e) => { setText(e.target.value); setErr(null); }} onKeyDown={onKey} onBlur={() => commit()} onPaste={(e) => { const t = e.clipboardData.getData('text'); if (/[\s,;]/.test(t.trim())) { e.preventDefault(); commit(text + ' ' + t); } }}
          placeholder={values.length ? '' : 'name@company.com'} aria-invalid={!!err} aria-describedby={err ? `${id}-err` : undefined} />
      </div>
      {err && <p id={`${id}-err`} className="mt-0.5 text-xs text-red-700">{err}</p>}
    </div>
  );
}

function ComposerForm() {
  const { draft, update, close, reset, contentVersion, fillFromJob } = useComposer();
  const qc = useQueryClient();
  const loc = useLocation();
  const pageJobId = jobIdFromPath(loc.pathname);
  const status = useApi<any>('/compose/status');
  const gen = useApi<any[]>('/compose/documents');
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileErr, setFileErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const limits = status.data?.limits ?? { maxFileMb: 10, maxTotalMb: 25, maxFiles: 10, types: ACCEPT.replace(/\./g, '').split(',') };

  const send = useMutation({
    mutationFn: () => api<any>('/compose/send', { method: 'POST', json: {
      clientKey: draft.clientKey, to: draft.to, cc: draft.cc, bcc: draft.bcc, subject: draft.subject, html: draft.html, jobId: draft.jobId,
      files: draft.files.map((f) => ({ filename: f.filename, contentBase64: f.contentBase64 })), documents: draft.documents.map((d) => ({ id: d.id, format: d.format })),
    } }),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['/emails'] });
      toast({ kind: 'success', title: 'Email accepted for delivery', body: `Sent as ${r.from} to ${draft.to.join(', ')}${r.attachments.length ? ` with ${r.attachments.length} attachment(s)` : ''}. Resend accepted it; delivery to the inbox is confirmed separately in Sent emails.`, link: { to: `/emails?id=${r.id}`, label: 'Open in Sent emails' } });
      reset(); close();
    },
    onError: (e: Error) => toast({ kind: 'error', title: 'Email not sent', body: e.message }),
  });

  const addFiles = async (list: FileList | null) => {
    if (!list) return;
    setFileErr(null);
    const errs: string[] = []; const added: LocalFile[] = [];
    let total = draft.files.reduce((n, f) => n + f.bytes, 0);
    for (const f of Array.from(list)) {
      const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
      if (!limits.types.includes(ext)) { errs.push(`${f.name}: .${ext} isn't allowed`); continue; }
      if (f.size > limits.maxFileMb * 1048576) { errs.push(`${f.name} is over ${limits.maxFileMb} MB`); continue; }
      if (!f.size) { errs.push(`${f.name} is empty`); continue; }
      if (draft.files.length + added.length + draft.documents.length >= limits.maxFiles) { errs.push(`At most ${limits.maxFiles} attachments`); break; }
      if (total + f.size > limits.maxTotalMb * 1048576) { errs.push(`${f.name}: attachments would exceed ${limits.maxTotalMb} MB in total`); continue; }
      const b64 = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] ?? ''); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
      total += f.size;
      added.push({ key: `${f.name}-${f.size}-${f.lastModified}`, filename: f.name, bytes: f.size, contentBase64: b64 });
    }
    if (added.length) update({ files: [...draft.files, ...added.filter((a) => !draft.files.some((x) => x.key === a.key))] });
    if (errs.length) setFileErr(errs.join(' · '));
    if (fileInput.current) fileInput.current.value = '';
  };

  const validate = () => {
    if (!draft.to.length) return 'Add at least one recipient in To.';
    if (!draft.subject.trim()) return 'Add a subject.';
    if (isBodyEmpty(draft.html)) return 'Write a message.';
    if (!status.data?.ready) return `Email sending isn't set up: ${status.data?.detail ?? 'checking…'}`;
    return null;
  };
  const onSend = () => {
    if (send.isPending) return;
    const v = validate(); setFormErr(v);
    if (v) return;
    send.mutate();
  };

  const attachCount = draft.files.length + draft.documents.length;
  const offerJob = pageJobId && pageJobId !== draft.jobId;

  return (
    <>
      <header className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">New email</h2>
          <p className="text-xs text-slate-500">
            {status.isLoading ? 'Checking sender…' : status.data?.ready ? <>From <b>{status.data.fromName}</b> &lt;{status.data.fromEmail}&gt;</> : <span className="text-red-700">Sender not ready</span>}
          </p>
        </div>
        <button onClick={close} className="rounded p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900" aria-label="Close composer (your draft is kept)" title="Close (draft is kept)"><X size={18} /></button>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-3">
        {status.data && !status.data.ready && (
          <div className="flex gap-2 rounded-md border border-red-200 bg-red-50 p-2 text-xs text-red-800"><AlertTriangle size={14} className="mt-0.5 shrink-0" />
            <div>Emails can't be sent yet: {status.data.detail}. Set it up on the <Link className="underline" to="/integrations">Integrations</Link> page. Nothing will be sent until then.</div></div>
        )}
        {offerJob && (
          <div className="flex items-center justify-between gap-2 rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900">
            <span className="flex items-center gap-1.5"><Briefcase size={14} /> You're on a job page.</span>
            <button className="btn py-0.5 text-xs" onClick={() => fillFromJob(pageJobId!)}>Fill from this job</button>
          </div>
        )}
        {draft.jobLabel && <p className="flex items-center gap-1.5 text-xs text-slate-600"><Briefcase size={13} /> Linked to <b>{draft.jobLabel}</b>
          <button className="ml-auto text-slate-500 underline" onClick={() => update({ jobId: null, jobLabel: null })}>unlink</button></p>}

        <RecipientField label="To" values={draft.to} onChange={(to) => update({ to })} autoFocus={!draft.to.length} />
        {draft.showCc ? (<>
          <RecipientField label="Cc" values={draft.cc} onChange={(cc) => update({ cc })} />
          <RecipientField label="Bcc" values={draft.bcc} onChange={(bcc) => update({ bcc })} />
        </>) : <button className="text-xs text-slate-600 underline" onClick={() => update({ showCc: true })}>Add Cc / Bcc</button>}
        <div>
          <label htmlFor="compose-subject" className="sr-only">Subject</label>
          <input id="compose-subject" className="input" placeholder="Subject" maxLength={250} value={draft.subject} onChange={(e) => update({ subject: e.target.value })} />
        </div>

        <RichEditor html={draft.html} version={contentVersion} onChange={(html) => update({ html })} placeholder="Write your message. Use the toolbar for bold, lists, links and more." />

        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn" onClick={() => fileInput.current?.click()}><Paperclip size={14} /> Attach files</button>
            <input ref={fileInput} type="file" multiple accept={ACCEPT} className="hidden" onChange={(e) => addFiles(e.target.files)} />
            {!!gen.data?.length && (
              <select className="input w-auto max-w-full flex-1 py-1 text-xs" value="" aria-label="Attach a CareerPilot document"
                onChange={(e) => { const d = gen.data!.find((x) => String(x.id) === e.target.value); if (d && !draft.documents.some((x) => x.id === d.id)) update({ documents: [...draft.documents, { id: d.id, format: 'pdf', label: `${d.kind === 'cv' ? 'CV' : 'Cover letter'} v${d.version}${d.company_name ? ` — ${d.company_name}` : ' — master'}` }] }); }}>
                <option value="">+ Attach a CareerPilot CV / cover letter…</option>
                {gen.data.map((d) => <option key={d.id} value={d.id}>{d.kind === 'cv' ? 'CV' : 'Cover letter'} v{d.version} — {d.company_name ?? 'master'}{d.job_title ? ` (${d.job_title})` : ''}</option>)}
              </select>
            )}
          </div>
          <p className="text-xs text-slate-500">PDF, Word, ODT, RTF, TXT or images · up to {limits.maxFileMb} MB each, {limits.maxTotalMb} MB total.</p>
          {fileErr && <p className="text-xs text-red-700" role="alert">{fileErr}</p>}
          {attachCount > 0 && (
            <ul className="space-y-1">
              {draft.documents.map((d) => (
                <li key={`d${d.id}`} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                  <FileText size={14} className="shrink-0 text-violet-700" /><span className="min-w-0 flex-1 truncate">{d.label}</span>
                  <select aria-label="Format" className="rounded border border-slate-200 px-1 py-0.5" value={d.format} onChange={(e) => update({ documents: draft.documents.map((x) => (x.id === d.id ? { ...x, format: e.target.value as 'pdf' | 'docx' } : x)) })}><option value="pdf">PDF</option><option value="docx">DOCX</option></select>
                  <button aria-label={`Remove ${d.label}`} onClick={() => update({ documents: draft.documents.filter((x) => x.id !== d.id) })} className="text-slate-500 hover:text-red-700"><X size={14} /></button>
                </li>
              ))}
              {draft.files.map((f) => (
                <li key={f.key} className="flex items-center gap-2 rounded border border-slate-200 px-2 py-1 text-xs">
                  <Paperclip size={14} className="shrink-0 text-slate-500" /><span className="min-w-0 flex-1 truncate">{f.filename}</span><span className="text-slate-500">{fmtBytes(f.bytes)}</span>
                  <button aria-label={`Remove ${f.filename}`} onClick={() => update({ files: draft.files.filter((x) => x.key !== f.key) })} className="text-slate-500 hover:text-red-700"><X size={14} /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <footer className="border-t border-slate-200 px-4 py-3">
        {formErr && <p className="mb-2 text-xs text-red-700" role="alert">{formErr}</p>}
        <div className="flex items-center gap-2">
          <button className="btn btn-primary" onClick={onSend} disabled={send.isPending || status.isLoading}>
            {send.isPending ? <><Loader2 size={14} className="animate-spin" /> Sending…</> : <><Send size={14} /> Send</>}
          </button>
          <span className="text-xs text-slate-500">Review recipients, subject and attachments first: nothing is sent until you press Send.</span>
          <button className="ml-auto text-xs text-slate-500 hover:text-red-700" disabled={send.isPending} onClick={() => { if (confirm('Discard this draft?')) reset(); }}>Discard</button>
        </div>
      </footer>
    </>
  );
}
