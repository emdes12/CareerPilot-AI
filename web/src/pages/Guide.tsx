import { Link } from 'react-router-dom';
import { Card } from '../components/ui';

/** Plain-language manual: what each page is for and what each button does. */
const FLOW: [string, string][] = [
  ['1. Find jobs', 'Every morning at 07:00 (or when you press “Search all sources now” on the Dashboard) CareerPilot searches the job boards and company career pages in Search settings. Each job is checked for Nigeria eligibility and scored against your profile.'],
  ['2. Review matches', 'Open Jobs. The best matches are at the top. Click a job to see why it scored what it did, the salary in naira, and whether you can apply from Nigeria.'],
  ['3. Prepare the application', 'On a job, press “Prepare application”. In about a minute it writes a CV, cover letter, email and screening answers tailored to that job, using only your verified evidence. It never sends anything.'],
  ['4. Apply', 'Read the documents, download the CV, press “Official listing” and apply on the employer’s site. Most jobs use an online form, which CareerPilot cannot fill for you.'],
  ['5. Track it', 'Press “Mark as applied”. The job moves to Applications, where you record replies, interviews and outcomes.'],
];

const PAGES: { page: string; to: string; what: string; buttons: [string, string][] }[] = [
  { page: 'Dashboard', to: '/', what: 'Overview: new matches, applications in progress and the last search.', buttons: [['Search all sources now', 'Starts a job search right away in the background. New jobs appear on the Jobs page a few minutes later.']] },
  { page: 'Jobs', to: '/jobs', what: 'Every job found, best matches first. Filter by score, eligibility and how recently it was posted.', buttons: [['Import', 'Paste the link (and optionally the text) of a job you found yourself. It is scored like any other job.']] },
  { page: 'A single job', to: '/jobs', what: 'Everything about one job: score breakdown, eligibility, salary, dates and your documents for it.', buttons: [
    ['Prepare application', 'Re-checks the job, re-scores it and writes fresh tailored documents (a new version each time; old versions are kept). Progress shows at the top of the page, then a summary of what changed. Nothing is sent.'],
    ['Re-check open', 'Visits the listing again to confirm it is still accepting applications.'],
    ['Official listing', 'Opens the job on the employer’s or job board’s site in a new tab. Apply there.'],
    ['CV (PDF) / CV (DOCX) / Cover letter', 'Downloads that document so you can upload it to the employer’s form.'],
    ['Mark as applied', 'Records that you applied yourself. The job moves to Applications.'],
    ['Approve & send', 'Only appears when the listing publishes an application email. Re-runs every safety check, then emails your application from me@alawiyemuritala.xyz. You are asked to confirm first.'],
    ['Write email', 'Opens the email composer filled in for this job. Nothing is sent until you press Send there.'],
    ['copy', 'Copies that text so you can paste it into an application form.'],
  ] },
  { page: 'Email composer (envelope button, bottom-right)', to: '/emails', what: 'Write and send your own emails from any page, as Alawiye Muritala Adeshina <me@alawiyemuritala.xyz>. On desktop it opens beside the page; on a phone it fills the screen. Closing it keeps your draft.', buttons: [
    ['Fill from this job', 'On a job page: adds the employer’s published application email (if any), a subject, the drafted email and that job’s tailored CV and cover letter. You can change everything.'],
    ['Attach files', 'PDF, Word, ODT, RTF, TXT or images, up to 10 MB each and 25 MB in total.'],
    ['Attach a CareerPilot CV / cover letter', 'Attaches a generated document directly, as PDF or DOCX, with no download needed.'],
    ['Send', 'Checks the recipients, subject, message, attachments and that your sender is verified, then sends. A message tells you whether Resend accepted it. Pressing Send twice never sends twice.'],
  ] },
  { page: 'Sent emails', to: '/emails', what: 'Every email you sent from the composer: recipients, message, attachments and status. “Accepted” means Resend took it, which is not proof of delivery.', buttons: [['Check delivery', 'Asks Resend whether the email was delivered, delayed or bounced.'], ['Include automatic emails', 'Also lists notifications and automatic applications.']] },
  { page: 'Applications', to: '/applications', what: 'Your pipeline: ready to apply, applied, interviewing, offer, rejected.', buttons: [['Status / notes', 'Update where each application stands; changes save immediately.']] },
  { page: 'Automation', to: '/automation', what: 'Rules for anything that happens without you pressing a button.', buttons: [
    ['Pause all automation', 'Emergency stop. Nothing is submitted automatically while this is on.'],
    ['Automatic submission', 'Lets CareerPilot send applications on its own for jobs at or above your minimum score. Only by email to an address the employer published, and only if every check passes. Off by default.'],
    ['Require my approval', 'Matching jobs wait for you to press “Approve & send”.'],
    ['Save', 'Saves the rules on this page. A message confirms it or explains what was wrong.'],
  ] },
  { page: 'My CVs & documents', to: '/documents', what: 'Every CV and letter ever generated, with versions. Your master CV is never overwritten.', buttons: [['Generate master CV', 'Creates a general CV from your evidence as a new version.']] },
  { page: 'My professional evidence', to: '/evidence', what: 'The facts documents are allowed to use: jobs, dates, projects, technologies. Only verified or confirmed items appear in CVs.', buttons: [['Confirm / Remove / Correct', 'Approve, remove or correct a fact.'], ['Add as user-confirmed', 'Adds a fact you vouch for yourself.'], ['Choose file (Upload a CV)', 'Reads an existing CV and lists what it found for you to confirm.']] },
  { page: 'Profile', to: '/profile', what: 'Your contact details and targets.', buttons: [['Save', 'Saves your details; new documents use them.'], ['Re-score all jobs', 'Recalculates every job’s score after you change skills or targets.']] },
  { page: 'Skills & development', to: '/skills', what: 'What employers ask for that you don’t have yet, ranked by how many jobs it would unlock.', buttons: [] },
  { page: 'Agent runs', to: '/runs', what: 'A technical log of every background job: which steps ran, how long they took and any errors.', buttons: [] },
  { page: 'Integrations', to: '/integrations', what: 'Email (Resend) and WhatsApp setup status.', buttons: [['Send test notification', 'Emails you a test message to prove notifications work.']] },
  { page: 'Search settings', to: '/settings', what: 'What to search for, salary targets, schedule, job boards and scoring weights.', buttons: [['Save', 'Saves the settings for the next search.'], ['Refresh now', 'Fetches today’s exchange rates for naira estimates.'], ['Back up database now', 'Saves a copy of all your data to disk.']] },
];

const TERMS: [string, string][] = [
  ['Score (e.g. 82%)', 'How well the job matches your profile: skills, experience, salary, location and freshness. It is not your chance of being hired.'],
  ['Nigeria eligible', 'The listing explicitly accepts candidates in Nigeria or worldwide. Jobs that exclude Nigeria are never recommended.'],
  ['priority / strong / good', 'Score bands: 90+ priority, 80–89 strong, 70–79 good, 50–69 possible.'],
  ['ready_to_apply', 'Documents are prepared; you have not applied yet.'],
  ['unverified', 'CareerPilot could not confirm this on the employer’s own website, so check it yourself.'],
  ['v5 · mixed / rules', 'Document version 5. “rules” means written by built-in templates; “mixed” means AI helped polish it.'],
  ['needs your review', 'The quality check found something to fix (for example a “[REVIEW]” placeholder). It will never be sent automatically.'],
];

export function Guide() {
  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">How CareerPilot works</h1>
      <p className="text-sm text-slate-600">CareerPilot finds remote jobs you can take from Nigeria, scores them and prepares tailored applications. You stay in control: nothing is sent unless you press “Approve & send” or turn on auto-apply yourself. After every button press a message appears in the bottom-right corner saying whether it worked.</p>
      <Card title="The everyday flow">
        <ol className="space-y-2">{FLOW.map(([h, t]) => <li key={h} className="text-sm"><div className="font-semibold">{h}</div><div className="text-slate-700">{t}</div></li>)}</ol>
      </Card>
      <Card title="Each page and its buttons">
        <div className="space-y-4">{PAGES.map((p) => (
          <div key={p.page}>
            <Link to={p.to} className="text-sm font-semibold hover:underline">{p.page}</Link>
            <p className="text-sm text-slate-700">{p.what}</p>
            {p.buttons.length > 0 && <dl className="mt-1 grid gap-x-4 gap-y-1 text-sm md:grid-cols-[12rem_1fr]">{p.buttons.map(([b, t]) => [<dt key={`${b}-k`} className="font-medium text-slate-800">{b}</dt>, <dd key={`${b}-v`} className="text-slate-600">{t}</dd>])}</dl>}
          </div>
        ))}</div>
      </Card>
      <Card title="Labels you will see">
        <dl className="grid gap-x-4 gap-y-1.5 text-sm md:grid-cols-[12rem_1fr]">{TERMS.map(([k, v]) => [<dt key={`${k}-k`} className="font-medium">{k}</dt>, <dd key={`${k}-v`} className="text-slate-600">{v}</dd>])}</dl>
      </Card>
    </div>
  );
}
