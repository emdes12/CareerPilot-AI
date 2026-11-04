import { Download } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Badge, Card, Empty, ErrorBox, Loading } from '../components/ui';
import { fmtDateTime, post, useAction, useApi } from '../lib/api';

export function Documents() {
  const docs = useApi<any[]>('/documents');
  const master = useAction(() => post('/documents/master-cv'), [['/documents']], { pending: 'Building your master CV…', success: (d: any) => ({ title: 'Master CV created', body: `Version ${d?.version ?? ''} is in the list below. Your master CV is never overwritten — each build is a new version.` }), error: 'Could not build the master CV' });
  if (docs.isLoading) return <Loading />;
  if (docs.error) return <ErrorBox error={docs.error} />;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">My CVs & documents</h1>
        <button className="btn btn-primary" onClick={() => master.mutate(undefined)} disabled={master.isPending}>Generate master CV</button>
      </div>
      <p className="text-sm text-slate-600">Your master profile is never overwritten; every tailored document is a new version.</p>
      <ErrorBox error={master.error} />
      <Card>
        {!docs.data!.length ? <Empty>No documents yet.</Empty> : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-slate-500"><tr><th className="py-2">Document</th><th>Kind</th><th>Engine</th><th>Created</th><th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {docs.data!.map((d) => (
                <tr key={d.id}>
                  <td className="py-2">{d.job_id ? <Link className="link" to={`/jobs/${d.job_id}/workspace`}>{d.title}</Link> : d.title} <span className="text-xs text-slate-500">v{d.version}</span>{(d.warnings ?? []).length > 0 && <div className="text-xs text-amber-800">{d.warnings.length} note(s) to review</div>}</td>
                  <td><Badge>{d.kind.replace('_', ' ')}</Badge></td>
                  <td className="text-xs">{d.engine}</td>
                  <td className="text-xs">{fmtDateTime(d.created_at)}</td>
                  <td className="text-right">{['cv', 'cover_letter'].includes(d.kind) && <span className="flex justify-end gap-1"><a className="btn py-0.5 text-xs" href={`/api/documents/${d.id}/download?format=pdf`}><Download size={12} /> PDF</a><a className="btn py-0.5 text-xs" href={`/api/documents/${d.id}/download?format=docx`}>DOCX</a></span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
