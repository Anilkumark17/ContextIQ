import jwt from 'jsonwebtoken';
import { eq } from 'drizzle-orm';
import { config } from '../../config.js';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';

export const publicUser = ({ id, name, email, role, createdAt }) => ({ id, name, email, role, createdAt });

// Resolves the signed-in user from the JWT cookie, loaded fresh so role changes apply immediately.
// Returns { user } on success or { error } with a message explaining why there is no user.
async function resolveUser(req) {
  const token = req.cookies?.[config.cookieName];
  if (!token) return { error: 'Not authenticated' };

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    return { error: 'Session expired, please sign in again' };
  }

  const [user] = await db.select().from(users).where(eq(users.id, payload.sub));
  if (!user) return { error: 'Account no longer exists' };

  return { user: publicUser(user) };
}

// For code outside the Express middleware chain (e.g. UploadThing middleware): user or null.
export async function getAuthUser(req) {
  const { user } = await resolveUser(req);
  return user ?? null;
}

export async function requireAuth(req, res, next) {
  const { user, error } = await resolveUser(req);
  if (!user) return res.status(401).json({ message: error });

  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return res.status(403).json({ message: 'You do not have permission to do this' });
  }
  next();
};
