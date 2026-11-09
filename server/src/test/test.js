// Checks that every piece of server configuration works: env vars, Neon connection,
// migrated schema, Drizzle, JWT, bcrypt, CORS, cookies and the auth/role API end to end.
// Run: npm test   (needs server/.env; creates two throwaway users and deletes them after)

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { inArray, sql } from 'drizzle-orm';
import { config } from '../config.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { app } from '../app.js';

const runId = Date.now();
const adminEmail = `zz-test-admin-${runId}@test.local`;
const employeeEmail = `zz-test-emp-${runId}@test.local`;
const password = 'password123';

let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  baseUrl = `http://localhost:${server.address().port}/api`;
});

after(async () => {
  await db.delete(users).where(inArray(users.email, [adminEmail, employeeEmail]));
  server?.close();
});

async function request(path, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body && { 'Content-Type': 'application/json' }),
      ...(cookie && { Cookie: cookie }),
      ...headers,
    },
    body: body && JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, headers: res.headers };
}

const sessionCookie = (res) => res.headers.get('set-cookie')?.split(';')[0];

describe('environment config', () => {
  test('required env vars are set', () => {
    assert.ok(config.databaseUrl, 'DATABASE_URL missing');
    assert.ok(config.jwtSecret, 'JWT_SECRET missing');
  });

  test('DATABASE_URL is a postgres URL with SSL', () => {
    const url = new URL(config.databaseUrl);
    assert.match(url.protocol, /^postgres(ql)?:$/);
    assert.equal(url.searchParams.get('sslmode'), 'require');
  });

  test('JWT_SECRET is long enough to be safe', () => {
    assert.ok(config.jwtSecret.length >= 32, 'JWT_SECRET should be at least 32 characters');
  });

  test('PORT and CLIENT_URL are valid', () => {
    assert.ok(Number.isInteger(config.port) && config.port > 0);
    assert.doesNotThrow(() => new URL(config.clientUrl));
  });
});

describe('database (Neon + Drizzle)', () => {
  test('can connect and run a query', async () => {
    const result = await db.execute(sql`select 1 as ok`);
    assert.equal(result.rows[0].ok, 1);
  });

  test('users table exists with the migrated columns', async () => {
    const result = await db.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'users'
    `);
    const columns = result.rows.map((r) => r.column_name).sort();
    assert.deepEqual(columns, ['created_at', 'email', 'id', 'name', 'password_hash', 'role']);
  });

  test('role enum has employee and admin', async () => {
    const result = await db.execute(sql`select unnest(enum_range(null::role))::text as value`);
    assert.deepEqual(result.rows.map((r) => r.value).sort(), ['admin', 'employee']);
  });

  test('all app tables exist', async () => {
    const result = await db.execute(sql`
      select table_name from information_schema.tables where table_schema = 'public'
    `);
    const tables = result.rows.map((r) => r.table_name);
    for (const name of [
      'users',
      'documents',
      'document_chunks',
      'conversations',
      'messages',
      'approval_requests',
      'feedback',
      'audit_events',
    ]) {
      assert.ok(tables.includes(name), `missing table ${name}`);
    }
  });

  test('pgvector extension is installed', async () => {
    const result = await db.execute(sql`select 1 from pg_extension where extname = 'vector'`);
    assert.equal(result.rows.length, 1);
  });

  test('drizzle query builder works on users', async () => {
    const rows = await db.select({ id: users.id }).from(users).limit(1);
    assert.ok(Array.isArray(rows));
  });
});

describe('crypto', () => {
  test('JWT signs and verifies with JWT_SECRET', () => {
    const token = jwt.sign({ sub: 'abc' }, config.jwtSecret, { expiresIn: 60 });
    assert.equal(jwt.verify(token, config.jwtSecret).sub, 'abc');
    assert.throws(() => jwt.verify(token, 'wrong-secret'));
  });

  test('bcrypt hashes and compares', async () => {
    const hash = await bcrypt.hash('secret', 4);
    assert.equal(await bcrypt.compare('secret', hash), true);
    assert.equal(await bcrypt.compare('nope', hash), false);
  });
});

describe('HTTP config', () => {
  test('health endpoint responds', async () => {
    const res = await request('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { status: 'ok' });
  });

  test('CORS allows CLIENT_URL with credentials', async () => {
    const res = await request('/health', { headers: { Origin: config.clientUrl } });
    assert.equal(res.headers.get('access-control-allow-origin'), config.clientUrl);
    assert.equal(res.headers.get('access-control-allow-credentials'), 'true');
  });

  test('unknown routes return JSON 404', async () => {
    const res = await request('/does-not-exist');
    assert.equal(res.status, 404);
    assert.equal(res.data.message, 'Not found');
  });
});

describe('authentication and authorization', () => {
  let adminCookie;
  let employeeCookie;
  let employeeId;

  before(async () => {
    // The first account in an empty DB becomes admin, so promote explicitly to stay order-independent.
    const adminRes = await request('/auth/register', {
      method: 'POST',
      body: { name: 'Test Admin', email: adminEmail, password },
    });
    assert.equal(adminRes.status, 201, JSON.stringify(adminRes.data));
    await db.update(users).set({ role: 'admin' }).where(inArray(users.email, [adminEmail]));
    adminCookie = sessionCookie(adminRes);
  });

  test('register sets an httpOnly session cookie and defaults to employee', async () => {
    const res = await request('/auth/register', {
      method: 'POST',
      body: { name: 'Test Employee', email: employeeEmail, password },
    });
    assert.equal(res.status, 201);
    assert.equal(res.data.user.role, 'employee');
    assert.equal(res.data.user.passwordHash, undefined, 'password hash must never leave the server');
    const setCookie = res.headers.get('set-cookie');
    assert.match(setCookie, new RegExp(`^${config.cookieName}=`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    employeeCookie = sessionCookie(res);
    employeeId = res.data.user.id;
  });

  test('register rejects invalid input and duplicates', async () => {
    const bad = await request('/auth/register', {
      method: 'POST',
      body: { name: 'X', email: 'not-an-email', password: 'short' },
    });
    assert.equal(bad.status, 400);

    const dup = await request('/auth/register', {
      method: 'POST',
      body: { name: 'Again', email: employeeEmail, password },
    });
    assert.equal(dup.status, 409);
  });

  test('login works (email case-insensitive) and rejects wrong password', async () => {
    const ok = await request('/auth/login', {
      method: 'POST',
      body: { email: employeeEmail.toUpperCase(), password },
    });
    assert.equal(ok.status, 200);
    assert.ok(sessionCookie(ok));

    const wrong = await request('/auth/login', {
      method: 'POST',
      body: { email: employeeEmail, password: 'wrong-password' },
    });
    assert.equal(wrong.status, 401);
  });

  test('/auth/me needs a valid session', async () => {
    assert.equal((await request('/auth/me')).status, 401);
    assert.equal((await request('/auth/me', { cookie: `${config.cookieName}=garbage` })).status, 401);

    const me = await request('/auth/me', { cookie: employeeCookie });
    assert.equal(me.status, 200);
    assert.equal(me.data.user.email, employeeEmail);
  });

  test('employee cannot access admin routes', async () => {
    assert.equal((await request('/users', { cookie: employeeCookie })).status, 403);
    const res = await request(`/users/${employeeId}/role`, {
      method: 'PATCH',
      cookie: employeeCookie,
      body: { role: 'admin' },
    });
    assert.equal(res.status, 403);
  });

  test('admin can list users and change roles', async () => {
    const list = await request('/users', { cookie: adminCookie });
    assert.equal(list.status, 200);
    assert.ok(list.data.users.some((u) => u.email === employeeEmail));

    const promote = await request(`/users/${employeeId}/role`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'admin' },
    });
    assert.equal(promote.status, 200);
    assert.equal(promote.data.user.role, 'admin');

    // Role is re-read from the DB, so the existing session gains access immediately.
    assert.equal((await request('/users', { cookie: employeeCookie })).status, 200);
  });

  test('admin cannot change own role; bad ids and roles are rejected', async () => {
    const me = await request('/auth/me', { cookie: adminCookie });
    const self = await request(`/users/${me.data.user.id}/role`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'employee' },
    });
    assert.equal(self.status, 400);

    const badId = await request('/users/not-a-uuid/role', {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'employee' },
    });
    assert.equal(badId.status, 404);

    const badRole = await request(`/users/${employeeId}/role`, {
      method: 'PATCH',
      cookie: adminCookie,
      body: { role: 'superuser' },
    });
    assert.equal(badRole.status, 400);
  });

  test('logout clears the session cookie', async () => {
    const res = await request('/auth/logout', { method: 'POST', cookie: employeeCookie });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('set-cookie'), new RegExp(`^${config.cookieName}=;`));
  });
});
