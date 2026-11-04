import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { one } from './db.js';

export interface AuthedRequest extends Request { userId?: number }
const COOKIE = 'cp_session';

export async function login(email: string, password: string): Promise<string | null> {
  const u = await one<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE lower(email)=lower($1)', [email]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return null;
  return jwt.sign({ sub: u.id }, config.jwtSecret, { expiresIn: '7d' });
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.isProd, maxAge: 7 * 864e5, path: '/' });
}
export function clearSessionCookie(res: Response) { res.clearCookie(COOKIE, { path: '/' }); }

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE] ?? (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) return res.status(401).json({ error: 'Not signed in' });
  try {
    const p = jwt.verify(token, config.jwtSecret) as unknown as { sub: number };
    req.userId = Number(p.sub);
    next();
  } catch { res.status(401).json({ error: 'Session expired' }); }
}

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
