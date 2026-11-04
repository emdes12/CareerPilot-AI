import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { hashPassword } from './auth.js';
import { config, ROOT } from './config.js';
import { json, one, q } from './db.js';
import { ensureSettings } from './engine/settings.js';
import { seedExperiences, seedProfile, seedProjects, seedSkills } from './seed/profile.js';
import { seedEvidenceFor } from './engine/evidence.js';
import { computeAllFreshness } from './engine/freshness.js';
import { getAutomation } from './engine/policy.js';

/**
 * First-run setup: creates the single owner account and seeds the master profile.
 * If OWNER_PASSWORD is not set, a strong random password is generated and written to
 * storage/INITIAL_PASSWORD.txt (never logged) — sign in, then change it in Settings.
 */
export async function bootstrap(): Promise<number> {
  fs.mkdirSync(config.storageDir, { recursive: true });
  let user = await one<{ id: number }>('SELECT id FROM users ORDER BY id LIMIT 1');
  if (!user) {
    let pw = config.ownerPassword;
    if (!pw) {
      pw = crypto.randomBytes(12).toString('base64url');
      const f = path.join(config.storageDir, 'INITIAL_PASSWORD.txt');
      fs.writeFileSync(f, `CareerPilot AI initial login\nEmail: ${config.ownerEmail}\nPassword: ${pw}\n\nChange it in Settings, then delete this file.\n`, { mode: 0o600 });
      console.log(`[bootstrap] Owner account created. Initial password written to ${path.relative(ROOT, f)}`);
    }
    user = await one<{ id: number }>('INSERT INTO users (email, password_hash) VALUES ($1,$2) RETURNING id', [config.ownerEmail, await hashPassword(pw)]);
  }
  const uid = user!.id;
  const hasProfile = await one('SELECT 1 FROM profiles WHERE user_id=$1', [uid]);
  if (!hasProfile) {
    const s = seedProfile;
    await q(`INSERT INTO profiles (user_id, full_name, headline, location, email, phone, links, summary, target_roles, target_level, availability, verification_flags)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [uid, s.full_name, s.headline, s.location, s.email, s.phone, json(s.links), s.summary, json(s.target_roles), s.target_level, s.availability, json(s.verification_flags)]);
    for (const k of seedSkills) await q(`INSERT INTO skills (user_id,name,label,category,proficiency,professional,years,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT DO NOTHING`, [uid, k.name, k.label, k.category, k.proficiency, k.professional, k.years ?? null, k.evidence]);
    let i = 0;
    for (const e of seedExperiences) await q(`INSERT INTO experiences (user_id,company,company_url,title,start_date,end_date,is_current,employment_type,description,bullets,technologies,needs_verification,verification_note,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [uid, e.company, e.company_url, e.title, e.start_date, e.end_date, e.is_current, e.employment_type, e.description, json(e.bullets), json(e.technologies), e.needs_verification, e.verification_note, i++]);
    i = 0;
    for (const p of seedProjects) await q(`INSERT INTO projects (user_id,name,url,repo_url,problem,contribution,team_context,technologies,features,architecture,challenges,evidence,needs_verification,sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [uid, p.name, p.url, p.repo_url, p.problem, p.contribution, p.team_context, json(p.technologies), json(p.features), p.architecture, p.challenges, p.evidence, p.needs_verification, i++]);
    console.log('[bootstrap] Seeded master profile from portfolio + GitHub evidence.');
  }
  await ensureSettings(uid);
  await getAutomation(uid); // creates the all-OFF automation defaults on first run
  await seedEvidenceFor(uid);
  // Professional contact email for documents and applications (only replaces the original seeded value).
  await q(`UPDATE profiles SET email='me@alawiyemuritala.xyz' WHERE user_id=$1 AND email='naijabayz@gmail.com'`, [uid]);
  // Backfill freshness fields once for jobs stored before migration 004.
  const stale = await one(`SELECT 1 FROM jobs WHERE user_id=$1 AND posted_at_source IS NULL LIMIT 1`, [uid]);
  if (stale) console.log(`[bootstrap] Freshness computed for ${await computeAllFreshness(uid)} jobs`);
  return uid;
}
