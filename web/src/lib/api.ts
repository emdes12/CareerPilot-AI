import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { dismiss, toast } from './toast';

/** Thin client for the CareerPilot API. Session is an httpOnly cookie; no secrets ever reach the browser. */
export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

export async function api<T = any>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    ...rest,
    headers: { ...(json !== undefined ? { 'content-type': 'application/json' } : {}), ...(rest.headers ?? {}) },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) throw new ApiError(res.status, (data as any)?.error ?? res.statusText);
  return data as T;
}

export const useApi = <T = any>(path: string | null, opts: { refetchInterval?: number | false } = {}) =>
  useQuery<T>({ queryKey: [path], queryFn: () => api<T>(path!), enabled: !!path, refetchInterval: opts.refetchInterval });

/** What to tell the user about an action. `success: false` means the caller reports success itself. */
export interface ActionMessages<T = any> { pending?: string; success?: string | false | { title: string; body?: string } | ((data: T) => string | { title: string; body?: string }); error?: string }

/** POST/PUT helper: invalidates the given query keys on success and always tells the user what happened. */
export function useAction<V = unknown, T = any>(fn: (v: V) => Promise<T>, invalidate: QueryKey[] = [], msg: ActionMessages<T> = {}) {
  const qc = useQueryClient();
  return useMutation<T, Error, V, number | undefined>({
    mutationFn: fn,
    onMutate: () => (msg.pending ? toast({ kind: 'loading', title: msg.pending }) : undefined),
    onSuccess: (data, _v, tid) => {
      for (const k of invalidate) qc.invalidateQueries({ queryKey: k });
      if (msg.success === false) { if (tid) dismiss(tid); return; }
      const m = typeof msg.success === 'function' ? msg.success(data) : msg.success ?? 'Done';
      const o = typeof m === 'string' ? { title: m } : m;
      toast({ id: tid, kind: 'success', ...o });
    },
    onError: (e, _v, tid) => toast({ id: tid, kind: 'error', title: msg.error ?? 'That didn’t work', body: e.message }),
  });
}

export const post = <T = any>(path: string, body?: unknown) => api<T>(path, { method: 'POST', json: body ?? {} });
export const put = <T = any>(path: string, body: unknown) => api<T>(path, { method: 'PUT', json: body });

export const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const fmtDateTime = (d?: string | null) => (d ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
export const ageLabel = (d?: string | null) => {
  if (!d) return 'date unknown';
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 864e5);
  return days <= 0 ? 'today' : days === 1 ? '1 day ago' : `${days} days ago`;
};
export const naira = (n?: number | null) => (n == null ? '—' : `₦${Math.round(n).toLocaleString('en-US')}`);
