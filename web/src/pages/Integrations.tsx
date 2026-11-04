import { RefreshCw, Send } from 'lucide-react';
import { useState } from 'react';
import { Badge, Card, ErrorBox, KV, Loading } from '../components/ui';
import { post, useAction, useApi } from '../lib/api';

function IdentityCard({ title, purpose, s }: { title: string; purpose: string; s: any }) {
  return (
    <Card title={title} actions={<Badge tone={s.configured ? 'green' : 'amber'}>{s.configured ? 'Ready' : 'Not ready'}</Badge>}>
      <p className="mb-2 text-xs text-slate-500">{purpose}</p>
      <KV rows={[['Sender name', s.fromName ?? '—'], ['Sender email', s.fromEmail ?? '—'], ['Domain', s.senderDomain ?? '—'], ['Domain verified', s.domainVerified === null ? 'Not checked' : s.domainVerified ? 'Yes' : 'No'], ['Status', s.detail]]} />
      {s.missing?.length > 0 && <p className="mt-2 text-xs text-red-700">Missing server variables: {s.missing.join(', ')}</p>}
    </Card>
  );
}

export function Integrations() {
  const [refresh, setRefresh] = useState(0);
  const st = useApi<any>(`/integrations${refresh ? `?refresh=1&n=${refresh}` : ''}`);
  const test = useAction(() => post('/integrations/test-notification'), [], { pending: 'Sending a test email…', success: (r: any) => r?.ok ? { title: 'Test email sent', body: `From ${r.from} to ${r.to}. Check your inbox (and spam).` } : { title: 'Test email not sent', body: r?.error ?? r?.status ?? 'Unknown reason' }, error: 'Test email failed' });
  if (st.isLoading) return <Loading />;
  if (st.error) return <ErrorBox error={st.error} />;
  const d = st.data;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Integrations</h1>
        <div className="flex gap-2">
          <button className="btn" onClick={() => setRefresh(refresh + 1)}><RefreshCw size={14} /> Re-check</button>
          <button className="btn btn-primary" disabled={!d.resend.notifications.configured || test.isPending} onClick={() => test.mutate(undefined)}><Send size={14} /> Send test notification</button>
        </div>
      </div>
      {test.data && <div className={`rounded-md p-3 text-sm ${test.data.ok ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}`}>{test.data.ok ? `Sent to ${test.data.to} from ${test.data.from}.` : `Not sent (${test.data.status}): ${test.data.error}`}</div>}
      <ErrorBox error={test.error} />
      <p className="text-sm text-slate-600">API keys live only in the server’s .env file. This page shows whether they are set and working, never their values.</p>
      <div className="grid gap-4 lg:grid-cols-2">
        <IdentityCard title="Notifications sender" purpose="Job alerts, application updates and reminders — sent only to your notification inbox." s={d.resend.notifications} />
        <IdentityCard title="Job-application sender" purpose="Applications to employers, sent as you. CareerPilot AI never appears as the sender, and it never falls back to the notifications sender." s={d.resend.jobApplication} />
        <Card title="AI provider" actions={<Badge tone={d.ai.enabled ? 'green' : 'gray'}>{d.ai.enabled ? 'Enabled' : 'Off'}</Badge>}>
          <KV rows={[['Provider', d.ai.provider ?? '—'], ['Models', Object.entries(d.ai.models ?? {}).map(([k, v]) => `${k}: ${v || '—'}`).join(' · ')]]} />
          <p className="mt-2 text-xs text-slate-500">Without AI everything still works: agents use their deterministic rules, and AI output is only accepted when it passes the truthfulness guards.</p>
        </Card>
        <Card title="WhatsApp (optional)" actions={<Badge tone={d.whatsapp.configured ? 'green' : 'gray'}>{d.whatsapp.configured ? 'Connected' : 'Not connected'}</Badge>}>
          <p className="text-sm">{d.whatsapp.detail}</p>
          <p className="mt-2 text-xs text-slate-500">Uses Meta’s official WhatsApp Business Cloud API. Business-initiated messages need an approved template (WHATSAPP_TEMPLATE_NAME). Email notifications work independently of this.</p>
        </Card>
      </div>
      <Card title="Set up Resend and verify your domain">
        <ol className="list-decimal space-y-1 pl-5 text-sm">{d.setupGuide.map((s: string, i: number) => <li key={i}>{s}</li>)}</ol>
        <p className="mt-3 text-xs text-slate-500">Adding the variables does not verify anything by itself. CareerPilot checks with Resend that alawiyemuritala.xyz is “Verified” before every send, and email applications stay off until you enable them in Automation.</p>
      </Card>
    </div>
  );
}
