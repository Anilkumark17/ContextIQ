import { Router } from 'express';
import { asc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { publicUser, requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();

router.use(requireAuth, requireRole('admin'));

router.get('/', async (req, res) => {
  const rows = await db.select().from(users).orderBy(asc(users.createdAt));
  res.json({ users: rows.map(publicUser) });
});

const roleSchema = z.object({ role: z.enum(['employee', 'admin']) });

router.patch('/:id/role', async (req, res) => {
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ message: 'Role must be employee or admin' });
  if (!z.string().uuid().safeParse(req.params.id).success) {
    return res.status(404).json({ message: 'User not found' });
  }
  if (req.params.id === req.user.id) {
    return res.status(400).json({ message: 'You cannot change your own role' });
  }

  const [user] = await db
    .update(users)
    .set({ role: parsed.data.role })
    .where(eq(users.id, req.params.id))
    .returning();
  if (!user) return res.status(404).json({ message: 'User not found' });

  res.json({ user: publicUser(user) });
});

export default router;
