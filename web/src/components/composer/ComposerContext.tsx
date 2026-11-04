import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import { toast } from '../../lib/toast';

/** A file picked from the computer, read into memory until Send. */
export interface LocalFile { key: string; filename: string; bytes: number; contentBase64: string }
/** A CareerPilot-generated CV / cover letter, rendered by the server at send time (never downloaded and re-uploaded). */
export interface GeneratedDoc { id: number; format: 'pdf' | 'docx'; label: string }

export interface Draft {
  to: string[]; cc: string[]; bcc: string[]; showCc: boolean;
  subject: string; html: string; files: LocalFile[]; documents: GeneratedDoc[];
  jobId: number | null; jobLabel: string | null;
  /** One key per draft: the server refuses a second send with the same key (no duplicate emails). */
  clientKey: string;
}
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const empty = (): Draft => ({ to: [], cc: [], bcc: [], showCc: false, subject: '', html: '', files: [], documents: [], jobId: null, jobLabel: null, clientKey: newKey() });

interface Ctx {
  isOpen: boolean; draft: Draft; contentVersion: number;
  open: (opts?: { jobId?: number; prefill?: boolean }) => void; close: () => void;
  update: (patch: Partial<Draft>) => void; reset: () => void;
  /** Replace the editor body from outside (prefill); bumps contentVersion so the editor reloads it. */
  setBody: (html: string) => void;
  fillFromJob: (jobId: number, opts?: { overwrite?: boolean }) => Promise<void>;
}
const ComposerCtx = createContext<Ctx | null>(null);
export const useComposer = () => { const c = useContext(ComposerCtx); if (!c) throw new Error('useComposer outside ComposerProvider'); return c; };

export const isBodyEmpty = (html: string) => !html.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim();

export function ComposerProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(empty);
  const [contentVersion, setCv] = useState(0);
  const update = useCallback((patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch })), []);
  const setBody = useCallback((html: string) => { setDraft((d) => ({ ...d, html })); setCv((v) => v + 1); }, []);
  const reset = useCallback(() => { setDraft(empty()); setCv((v) => v + 1); }, []);

  const fillFromJob = useCallback(async (jobId: number, opts: { overwrite?: boolean } = {}) => {
    try {
      const c = await api<any>(`/compose/context?jobId=${jobId}`);
      setDraft((d) => {
        const docs = c.documents.map((x: any) => ({ id: x.id, format: 'pdf' as const, label: x.label }));
        const keepDocs = d.documents.filter((x) => !docs.some((y: GeneratedDoc) => y.id === x.id));
        const to = c.recipient && !d.to.includes(c.recipient.email) ? [...d.to, c.recipient.email] : d.to;
        const next = { ...d, jobId, jobLabel: `${c.job.title} — ${c.job.company}`, to, documents: [...keepDocs, ...docs], subject: opts.overwrite || !d.subject ? c.subject : d.subject };
        if (c.draftHtml && (opts.overwrite || isBodyEmpty(d.html))) { next.html = c.draftHtml; setCv((v) => v + 1); }
        return next;
      });
      toast({ kind: 'info', title: 'Filled from this job — review before sending', body: [
        c.recipient ? `To: ${c.recipient.email} (${c.recipient.source.toLowerCase()})` : 'No application email is published for this job, so add the recipient yourself.',
        c.documents.length ? `Attached: ${c.documents.map((x: any) => x.label).join(', ')}` : 'No tailored CV yet — press “Prepare application” on the job first.',
      ].join('\n') });
    } catch (e) { toast({ kind: 'error', title: 'Could not load this job’s details', body: (e as Error).message }); }
  }, []);

  const open = useCallback((opts: { jobId?: number; prefill?: boolean } = {}) => {
    setOpen(true);
    if (opts.jobId && opts.prefill) void fillFromJob(opts.jobId);
  }, [fillFromJob]);
  const close = useCallback(() => setOpen(false), []);

  const value = useMemo(() => ({ isOpen, draft, contentVersion, open, close, update, reset, setBody, fillFromJob }), [isOpen, draft, contentVersion, open, close, update, reset, setBody, fillFromJob]);
  return <ComposerCtx.Provider value={value}>{children}</ComposerCtx.Provider>;
}
