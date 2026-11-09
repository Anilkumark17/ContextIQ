import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import { config } from './config.js';
import authRoutes from './common/routes/auth.js';
import userRoutes from './common/routes/users.js';
import { documentRoutes, uploadthingRoutes } from './services/uploadthing/uploadthing.route.js';

export const app = express();

app.use(cors({ origin: config.clientUrl, credentials: true }));
app.use(express.json());
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/uploadthing', uploadthingRoutes);
app.use('/api/documents', documentRoutes);

app.use((req, res) => res.status(404).json({ message: 'Not found' }));

// True when the database could not be reached at all (network), as opposed to a failing query.
function isDbUnreachable(err) {
  for (let e = err; e; e = e.cause) {
    if (/Error connecting to database/.test(e.message ?? '')) return true;
  }
  return false;
}

// Express 5 forwards rejected async handlers here.
app.use((err, req, res, next) => {
  if (isDbUnreachable(err)) {
    console.error(`[db] unreachable: ${req.method} ${req.originalUrl}`);
    return res.status(503).json({ message: 'Database unreachable, please try again' });
  }
  console.error(err);
  res.status(500).json({ message: 'Something went wrong' });
});
