import { Mail, Paperclip, RefreshCw } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, KV, Loading } from '../components/ui';
import { useComposer } from '../components/composer/ComposerContext';
import { fmtDateTime, post, useAction, useApi } from '../lib/api';

/** What each status means — provider acceptance is not proof the email reached the inbox. */
export const EMAIL_STATUS: Record<string, [string, string]> = {
  sending: ['blue', 'Being handed to the email provider'],
  accepted: ['blue', 'Accepted by Resend. Not yet confirmed as delivered.'],
  sent: ['blue', 'Sent by Resend to the recipient’s mail server. Not yet confirmed as delivered.'],
  delivered: ['green', 'Delivered: the recipient’s mail server accepted it.'],
  delivery_delayed: ['amber', 'Delivery delayed: Resend is still retrying.'],
  opened: ['green', 'Delivered and opened.'], clicked: ['green', 'Delivered and a link was clicked.'],
  bounced: ['red', 'Bounced: the address rejected it. It was not delivered.'],
  complained: ['red', 'Delivered, but marked as spam by the recipient.'],
  rejected: ['red', 'Refused by Resend. Nothing was sent.'], error: ['red', 'Failed: nothing was sent.'],
  not_configured: ['red', 'Not sent: email sending wasn’t set up.'],
};
const StatusBadge = ({ s }: { s: string }) => { const [tone] = EMAIL_STATUS[s] ?? ['gray']; return <Badge tone={tone}>{s.replace('_', ' ')}</Badge>; };
const fmtBytes = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const list = (x: unknown) => (Array.isArray(x) ? x.join(', ') : '');

export function Emails() {
  const [sp, setSp] = useSearchParams();
  const showAll = sp.get('all') === '1';
  const selected = Number(sp.get('id')) || null;
  const emails = useApi<any[]>(`/emails${showAll ? '?kind=all' : ''}`);
  const { open } = useComposer();
  const select = (id: number) => { const n = new URLSearchParams(sp); n.set('id', String(id)); setSp(n); };
  if (emails.isLoading) return <Loading />;
  if (emails.error) return <ErrorBox error={emails.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Sent emails</h1>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={showAll} onChange={(e) => { const n = new URLSearchParams(sp); if (e.target.checked) n.set('all', '1'); else n.delete('all'); setSp(n); }} /> Include automatic emails</label>
          <button className="btn btn-primary" onClick={() => open()}><Mail size={14} /> Compose</button>
        </div>
      </div>
      <p className="text-sm text-slate-600">Every email you send from the composer{showAll ? ', plus notifications and automatic applications' : ''}. “Accepted” means Resend took it; press “Check delivery” to see whether it was delivered or bounced.</p>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card title={`${emails.data!.length} email${emails.data!.length === 1 ? '' : 's'}`}>
          {!emails.data!.length ? <Empty>Nothing sent yet. Use the envelope button at the bottom-right to write one.</Empty> : (
            <ul className="-mx-2 divide-y divide-slate-100">{emails.data!.map((e) => (
              <li key={e.id}>
                <button onClick={() => select(e.id)} className={`w-full px-2 py-2 text-left text-sm hover:bg-slate-50 ${selected === e.id ? 'bg-slate-100' : ''}`}>
                  <div className="flex items-center gap-2"><span className="min-w-0 flex-1 truncate font-medium">{e.subject}</span><StatusBadge s={e.status} /></div>
                  <div className="flex items-center gap-2 text-xs text-slate-500"><span className="min-w-0 flex-1 truncate">To {list(e.to_list) || e.to_email}</span>
                    {e.attachments?.length > 0 && <span className="flex items-center gap-0.5"><Paperclip size={11} />{e.attachments.length}</span>}<span>{fmtDateTime(e.created_at)}</span></div>
                  {e.kind !== 'manual' && <div className="text-xs text-slate-400">{e.identity === 'notifications' ? 'Notification' : 'Automatic application'}</div>}
                </button>
              </li>
            ))}</ul>
          )}
        </Card>
        {selected ? <EmailDetail id={selected} /> : <Card><Empty>Select an email to read it.</Empty></Card>}
      </div>
    </div>
  );
}

function EmailDetail({ id }: { id: number }) {
  const e = useApi<any>(`/emails/${id}`);
  const refresh = useAction(() => post(`/emails/${id}/refresh`), [[`/emails/${id}`], ['/emails'], ['/emails?kind=all']], {
    pending: 'Asking Resend for the delivery status…',
    success: (r: any) => (r.status ? { title: `Status: ${String(r.status).replace('_', ' ')}`, body: EMAIL_STATUS[r.status]?.[1] } : { title: 'No new status', body: r.note }),
    error: 'Could not check delivery',
  });
  if (e.isLoading) return <Card><Loading /></Card>;
  if (e.error) return <ErrorBox error={e.error} />;
  const m = e.data;
  return (
    <Card title={m.subject} actions={m.provider_id ? <button className="btn py-1 text-xs" onClick={() => refresh.mutate(undefined)} disabled={refresh.isPending}><RefreshCw size={12} className={refresh.isPending ? 'animate-spin' : ''} /> Check delivery</button> : null}>
      <div className="space-y-3">
        <KV rows={[
          ['Status', <span><StatusBadge s={m.status} /> <span className="text-xs text-slate-600">{EMAIL_STATUS[m.status]?.[1] ?? ''}</span>{m.status_checked_at && <span className="block text-xs text-slate-400">checked {fmtDateTime(m.status_checked_at)}</span>}</span>],
          ['From', `${m.from_name ?? ''} <${m.from_email ?? ''}>`],
          ['To', list(m.to_list) || m.to_email],
          ...(m.cc?.length ? [['Cc', list(m.cc)] as [string, string]] : []),
          ...(m.bcc?.length ? [['Bcc', list(m.bcc)] as [string, string]] : []),
          ['Sent', fmtDateTime(m.created_at)],
          ['Attachments', m.attachments?.length ? <ul>{m.attachments.map((a: any, i: number) => <li key={i} className="flex items-center gap-1"><Paperclip size={12} /> {a.filename} <span className="text-xs text-slate-500">{fmtBytes(a.bytes)}</span></li>)}</ul> : 'None'],
          ...(m.job_id ? [['Job', <Link className="link" to={`/jobs/${m.job_id}`}>{m.job_title} — {m.company_name}</Link>] as [string, React.ReactNode]] : []),
          ['Provider ID', <code className="text-xs">{m.provider_id ?? '—'}</code>],
          ...(m.error ? [['Error', <span className="text-red-700">{m.error}</span>] as [string, React.ReactNode]] : []),
        ]} />
        <div className="rounded-md border border-slate-200">
          <div className="border-b border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-500">Message</div>
          {m.body_html
            ? <iframe title="Email message" sandbox="" srcDoc={`<style>body{font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#1f2937;margin:12px}a{color:#1d4ed8}</style>${m.body_html}`} className="h-96 w-full" />
            : m.body_text ? <div className="whitespace-pre-wrap p-3 text-sm">{m.body_text}</div> : <p className="p-3 text-sm text-slate-500">The message body wasn’t stored for this older email.</p>}
        </div>
      </div>
    </Card>
  );
}
