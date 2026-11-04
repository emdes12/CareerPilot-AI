import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading, Toggle } from '../components/ui';
import { api, fmtDateTime, useAction, useApi } from '../lib/api';

export function Automation() {
  const st = useApi<any>('/automation');
  const dash = useApi<any>('/automation/dashboard', { refetchInterval: 15000 });
  const integ = useApi<any>('/integrations');
  const [s, setS] = useState<any>(null);
  useEffect(() => { if (st.data) setS(st.data.settings); }, [st.data]);
  const save = useAction((body: any) => api('/automation', { method: 'PUT', json: body }), [['/automation'], ['/automation/dashboard']], { pending: 'Saving automation settings…', success: 'Automation settings saved', error: 'Automation settings were not saved' });
  if (st.isLoading || !s) return <Loading />;
  const set = (k: string, v: unknown) => setS({ ...s, [k]: v });
  const enableAuto = async (v: boolean) => {
    if (!v) return save.mutate({ auto_apply_enabled: false });
    const ok = window.confirm('Enable automatic submission?\n\nOnly jobs at or above the minimum score below (lowest allowed: 75) that pass every check — Nigeria eligibility confirmed, verified open in the last 36h, documents passed QA with no placeholders or unresolved evidence conflicts, an application email published in the listing, your verified sender — can be sent without you pressing a button.\n\nPortal applications are never submitted automatically.');
    if (ok) save.mutate({ auto_apply_enabled: true, confirm: 'ENABLE AUTO-APPLY' } as any);
  };
  const appSender = integ.data?.resend?.jobApplication;
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Automation</h1>
      <p className="text-sm text-slate-600">{st.data.note}</p>
      <ErrorBox error={save.error} />
      {appSender && !appSender.configured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Email applications cannot be sent yet: <b>{appSender.detail}</b>. <Link className="link" to="/integrations">Set up your sender identity →</Link>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Permissions" actions={<button className="btn btn-primary" onClick={() => { const { auto_apply_enabled: _a, updated_at: _u, updated_by: _b, user_id: _id, ...rest } = s; save.mutate(rest); }} disabled={save.isPending}>Save</button>}>
          <div className={`mb-3 rounded-md p-3 ${s.paused ? 'bg-red-50' : 'bg-slate-50'}`}>
            <Toggle checked={s.paused} onChange={(v) => save.mutate({ paused: v })} label="Pause all automation" hint="Stops every automatic submission immediately. Discovery and documents keep working." />
          </div>
          <Toggle checked={st.data.settings.auto_apply_enabled} onChange={enableAuto} label="Automatic submission (score ≥ your minimum)" hint={st.data.settings.auto_apply_enabled ? 'ON — requires every check to pass' : 'OFF (default). Turning it on asks for confirmation and is logged.'} />
          <Toggle checked={s.require_approval} onChange={(v) => set('require_approval', v)} label="Require my approval for every application" hint="When on, matching jobs wait in “Pending approval” instead of being sent." />
          <Toggle checked={s.allow_email_applications} onChange={(v) => set('allow_email_applications', v)} label="Allow email applications" hint="Only to an address published in the listing, from your own verified identity." />
          <Toggle checked={s.allow_portal_applications} onChange={(v) => set('allow_portal_applications', v)} label="Allow portal applications" hint="Portals are never auto-submitted (CAPTCHA/terms/employer API keys). You always get a handoff package." />
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div><label className="label">Auto-apply minimum score</label><input type="number" min={75} max={100} className="input" value={s.auto_apply_min_score} onChange={(e) => set('auto_apply_min_score', Number(e.target.value))} /></div>
            <div><label className="label">Max applications / day</label><input type="number" min={0} max={50} className="input" value={s.max_applications_per_day} onChange={(e) => set('max_applications_per_day', Number(e.target.value))} /></div>
            <div><label className="label">Prepare documents from</label><input type="number" className="input" value={s.docs_min_score} onChange={(e) => set('docs_min_score', Number(e.target.value))} /></div>
            <div><label className="label">Notify me from</label><input type="number" className="input" value={s.notify_min_score} onChange={(e) => set('notify_min_score', Number(e.target.value))} /></div>
          </div>
          <div className="mt-3"><label className="label">Excluded companies (comma separated)</label><input className="input" value={s.excluded_companies.join(', ')} onChange={(e) => set('excluded_companies', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></div>
          <div className="mt-3"><label className="label">Excluded keywords / categories</label><input className="input" value={s.excluded_keywords.join(', ')} onChange={(e) => set('excluded_keywords', e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} /></div>
        </Card>
        <Card title="Notifications">
          <Toggle checked={s.notify_email_enabled} onChange={(v) => set('notify_email_enabled', v)} label="Email notifications" hint={`From ${integ.data?.resend?.notifications?.fromName ?? 'CareerPilot AI'} <${integ.data?.resend?.notifications?.fromEmail ?? '…'}> — ${integ.data?.resend?.notifications?.configured ? 'ready' : integ.data?.resend?.notifications?.detail ?? ''}`} />
          <div className="mb-3"><label className="label">Notification email</label><input className="input" type="email" value={s.notification_email ?? ''} placeholder="me@alawiyemuritala.xyz" onChange={(e) => set('notification_email', e.target.value || null)} /></div>
          <Toggle checked={s.notify_whatsapp_enabled} onChange={(v) => set('notify_whatsapp_enabled', v)} label="WhatsApp notifications (optional)" hint={integ.data?.whatsapp?.configured ? 'Connected via Meta WhatsApp Cloud API' : `Not connected: ${integ.data?.whatsapp?.detail ?? ''}`} />
          <div><label className="label">WhatsApp number (international format)</label><input className="input" value={s.whatsapp_to ?? ''} placeholder="2348…" onChange={(e) => set('whatsapp_to', e.target.value || null)} /></div>
          <h3 className="mt-4 text-sm font-semibold">What happens at each score</h3>
          <ul className="mt-1 space-y-1 text-sm">{st.data.tiers.map((t: any) => <li key={t.tier}><span className="font-medium">{t.label}:</span> <span className="text-slate-600">{t.action}</span></li>)}</ul>
        </Card>
      </div>
      {dash.data && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Application attempts (audit log)">
            {!dash.data.attempts.length ? <Empty>No attempts yet.</Empty> : <ul className="space-y-1 text-sm">{dash.data.attempts.map((a: any) => (
              <li key={a.id}><span className="text-xs text-slate-500">{fmtDateTime(a.created_at)}</span> <Badge tone={a.status === 'submitted' ? 'green' : ['blocked', 'failed'].includes(a.status) ? 'red' : 'amber'}>{a.status}</Badge> <Link className="link" to={`/jobs/${a.job_id}/workspace`}>{a.title} · {a.company_name}</Link><div className="text-xs text-slate-500">{a.channel} · {a.requested_by} · {a.reason}</div></li>
            ))}</ul>}
          </Card>
          <Card title="Notifications sent">
            {!dash.data.notifications.length ? <Empty>None yet.</Empty> : <ul className="space-y-1 text-sm">{dash.data.notifications.map((n: any) => <li key={n.id}><span className="text-xs text-slate-500">{fmtDateTime(n.created_at)}</span> <Badge tone={n.status === 'sent' ? 'green' : 'amber'}>{n.channel}: {n.status}</Badge> {n.subject} {n.error && <span className="text-xs text-red-700">— {n.error}</span>}</li>)}</ul>}
          </Card>
          <Card title="Permission changes">
            {!dash.data.settingsAudit.length ? <Empty>No changes yet.</Empty> : <ul className="space-y-1 text-xs">{dash.data.settingsAudit.map((x: any) => <li key={x.id}>{fmtDateTime(x.created_at)}: {x.changes.map((c: any) => `${c.field} ${JSON.stringify(c.from)} → ${JSON.stringify(c.to)}`).join('; ')}</li>)}</ul>}
          </Card>
        </div>
      )}
    </div>
  );
}
