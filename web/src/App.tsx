import { useQueryClient } from '@tanstack/react-query';
import { Activity, BookOpen, Bot, Briefcase, FileText, Gauge, GraduationCap, LogOut, Mail, Plug, Search, Settings as Cog, ShieldCheck, User, Zap } from 'lucide-react';
import { Component, useState, type FormEvent, type ReactNode } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { api, post, useApi } from './lib/api';
import { ComposerDock, ComposerFab } from './components/composer/Composer';
import { ComposerProvider } from './components/composer/ComposerContext';
import { Applications } from './pages/Applications';
import { Emails } from './pages/Emails';
import { Automation } from './pages/Automation';
import { Dashboard } from './pages/Dashboard';
import { Documents } from './pages/Documents';
import { Evidence } from './pages/Evidence';
import { Integrations } from './pages/Integrations';
import { JobDetail } from './pages/JobDetail';
import { Guide } from './pages/Guide';
import { Jobs } from './pages/Jobs';
import { Toaster } from './lib/toast';
import { Profile } from './pages/Profile';
import { Runs } from './pages/Runs';
import { SettingsPage } from './pages/Settings';
import { Skills } from './pages/Skills';

const NAV = [
  ['/guide', 'How it works', BookOpen], ['/', 'Dashboard', Gauge], ['/jobs', 'Jobs', Search], ['/applications', 'Applications', Briefcase], ['/emails', 'Sent emails', Mail], ['/automation', 'Automation', Zap],
  ['/documents', 'My CVs & documents', FileText], ['/evidence', 'My professional evidence', ShieldCheck], ['/profile', 'Profile', User],
  ['/skills', 'Skills & development', GraduationCap], ['/runs', 'Agent runs', Bot], ['/integrations', 'Integrations', Plug], ['/settings', 'Search settings', Cog],
] as const;

/** Keeps one broken page from blanking the whole app; shows the error instead. */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="card space-y-2">
        <h1 className="text-lg font-semibold text-red-700">This page hit an error</h1>
        <p className="text-sm text-slate-700">{this.state.error.message}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>Try again</button>
      </div>
    );
  }
}

export function App() {
  const me = useApi<{ id: number; email: string }>('/auth/me');
  const location = useLocation();
  const qc = useQueryClient();
  if (me.isLoading) return <p className="p-8 text-slate-500">Loading…</p>;
  if (me.error) return <Login onDone={() => qc.invalidateQueries()} />;
  return (
    <ComposerProvider>
    <div className="flex min-h-screen">
      <Toaster />
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 overflow-y-auto border-r border-slate-200 bg-white md:block">
        <div className="flex items-center gap-2 px-4 py-4 font-semibold"><Activity size={18} /> CareerPilot AI</div>
        <nav className="flex flex-col px-2">
          {NAV.map(([to, label, Icon]) => (
            <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `flex items-center gap-2 rounded-md px-3 py-2 text-sm ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700 hover:bg-slate-100'}`}>
              <Icon size={16} /> {label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-6 px-4 text-xs text-slate-500">{me.data?.email}</div>
        <button className="mx-4 mt-2 flex items-center gap-1 text-xs text-slate-600 hover:underline" onClick={async () => { await post('/auth/logout'); qc.invalidateQueries(); }}><LogOut size={12} /> Sign out</button>
      </aside>
      <div className="min-w-0 flex-1">
        <nav className="flex gap-1 overflow-x-auto border-b border-slate-200 bg-white px-3 py-2 md:hidden">
          {NAV.map(([to, label]) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `whitespace-nowrap rounded px-2 py-1 text-xs ${isActive ? 'bg-slate-900 text-white' : 'text-slate-700'}`}>{label}</NavLink>)}
        </nav>
        <main className="mx-auto max-w-7xl p-4 pb-24 md:p-6 md:pb-24">
          <PageBoundary key={location.pathname}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/jobs" element={<Jobs />} />
            <Route path="/jobs/:id" element={<JobDetail />} />
            <Route path="/jobs/:id/workspace" element={<JobDetail workspace />} />
            <Route path="/applications" element={<Applications />} />
            <Route path="/automation" element={<Automation />} />
            <Route path="/documents" element={<Documents />} />
            <Route path="/evidence" element={<Evidence />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/skills" element={<Skills />} />
            <Route path="/runs" element={<Runs />} />
            <Route path="/integrations" element={<Integrations />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/guide" element={<Guide />} />
            <Route path="/emails" element={<Emails />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
          </PageBoundary>
        </main>
      </div>
      <ComposerDock />
      <ComposerFab />
    </div>
    </ComposerProvider>
  );
}

function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [err, setErr] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null);
    try { await api('/auth/login', { method: 'POST', json: { email, password } }); onDone(); } catch (x) { setErr((x as Error).message); }
  };
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="card w-full max-w-sm space-y-3">
        <h1 className="flex items-center gap-2 text-lg font-semibold"><Activity size={18} /> CareerPilot AI</h1>
        <div><label className="label">Email</label><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required /></div>
        <div><label className="label">Password</label><input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required /></div>
        {err && <p className="text-sm text-red-700">{err}</p>}
        <button className="btn btn-primary w-full justify-center">Sign in</button>
        <p className="text-xs text-slate-500">First run: the initial password is in storage/INITIAL_PASSWORD.txt on the server.</p>
      </form>
    </div>
  );
}
