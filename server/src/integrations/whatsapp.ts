import { config } from '../config.js';

/**
 * WhatsApp via Meta's official WhatsApp Business Cloud API (graph.facebook.com).
 * Optional channel: if not configured, callers record "not_configured" and email continues independently.
 * Business-initiated messages outside a 24h customer window must use an approved template; set
 * WHATSAPP_TEMPLATE_NAME to a template with body params {{1}}=title/company, {{2}}=match %, {{3}}=workspace link.
 */
export function whatsappStatus() {
  const w = config.whatsapp;
  const missing = [w.provider !== 'meta' && 'WHATSAPP_PROVIDER=meta', !w.accessToken && 'WHATSAPP_ACCESS_TOKEN', !w.phoneNumberId && 'WHATSAPP_PHONE_NUMBER_ID', !w.to && 'WHATSAPP_TO'].filter(Boolean) as string[];
  return { configured: missing.length === 0, missing, usesTemplate: !!w.templateName, detail: missing.length ? `Missing ${missing.join(', ')}` : w.templateName ? `Template "${w.templateName}"` : 'No template set — free-text messages only deliver inside a 24h customer-service window' };
}

export async function sendWhatsApp(to: string, summary: string, score: number, link: string): Promise<{ ok: boolean; id: string | null; status: string; error: string | null }> {
  const st = whatsappStatus();
  if (!st.configured) return { ok: false, id: null, status: 'not_configured', error: st.detail };
  const w = config.whatsapp;
  const body = w.templateName
    ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: w.templateName, language: { code: w.templateLang }, components: [{ type: 'body', parameters: [{ type: 'text', text: summary.slice(0, 200) }, { type: 'text', text: `${score}%` }, { type: 'text', text: link }] }] } }
    : { messaging_product: 'whatsapp', to, type: 'text', text: { preview_url: false, body: `${summary}\nMatch: ${score}%\nWorkspace: ${link}` } };
  try {
    const r = await fetch(`https://graph.facebook.com/${w.apiVersion}/${w.phoneNumberId}/messages`, { method: 'POST', headers: { authorization: `Bearer ${w.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const d: any = await r.json().catch(() => ({}));
    if (r.ok && d.messages?.[0]?.id) return { ok: true, id: d.messages[0].id, status: 'accepted', error: null };
    return { ok: false, id: null, status: 'rejected', error: d?.error?.message ?? `HTTP ${r.status}` };
  } catch (e) { return { ok: false, id: null, status: 'error', error: (e as Error).message }; }
}
