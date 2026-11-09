import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { publicUser, requireAuth } from '../middleware/auth.js';

const router = Router();

const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

const cookieOptions = {
  httpOnly: true,
  secure: config.isProd,
  sameSite: 'lax',
  path: '/',
};

function setSession(res, user) {
  const token = jwt.sign({ sub: user.id }, config.jwtSecret, { expiresIn: config.tokenTtlSeconds });
  res.cookie(config.cookieName, token, { ...cookieOptions, maxAge: config.tokenTtlSeconds * 1000 });
}

const badRequest = (res, error) =>
  res.status(400).json({ message: error.issues[0]?.message ?? 'Invalid input' });

router.post('/register', async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const { name, email, password } = parsed.data;

  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
  if (existing) return res.status(409).json({ message: 'An account with this email already exists' });

  // The first account becomes admin so the workspace can be bootstrapped.
  const [{ total }] = await db.select({ total: count() }).from(users);
  const role = total === 0 ? 'admin' : 'employee';

  const passwordHash = await bcrypt.hash(password, 12);
  const [user] = await db.insert(users).values({ name, email, passwordHash, role }).returning();

  setSession(res, user);
  res.status(201).json({ user: publicUser(user) });
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) return badRequest(res, parsed.error);
  const { email, password } = parsed.data;

  const [user] = await db.select().from(users).where(eq(users.email, email));
  const valid = user && (await bcrypt.compare(password, user.passwordHash));
  if (!valid) return res.status(401).json({ message: 'Invalid email or password' });

  setSession(res, user);
  res.json({ user: publicUser(user) });
});

router.post('/logout', (req, res) => {
  res.clearCookie(config.cookieName, cookieOptions);
  res.json({ message: 'Signed out' });
});

router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

export default router;
