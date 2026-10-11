/** Single-user session auth. No password / financial data is embedded in the client. */
export interface PocketKuAuthEnv {
  DB: D1Database;
  PK_LOGIN_ID?: string;
  PK_PASSWORD_HASH?: string;
}

const COOKIE_NAME = 'pocketku_session';
const SESSION_LIFETIME = 8 * 60 * 60;
const LOGIN_LIMIT = 6;
const LOCK_SECONDS = 15 * 60;
const encoder = new TextEncoder();

function error(message: string, status: number): Response {
  return Response.json({ success: false, error: message }, {
    status, headers: { 'Cache-Control': 'no-store' },
  });
}
function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  const h = new Headers(headers);
  h.set('Cache-Control', 'no-store');
  return Response.json(body, { status, headers: h });
}
function bytesToB64Url(bytes: Uint8Array): string {
  let raw = '';
  for (const value of bytes) raw += String.fromCharCode(value);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function b64UrlToBytes(value: string): Uint8Array {
  if (!/^[\w-]+$/.test(value)) throw new Error('Invalid encoded data');
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
async function sha256(value: string): Promise<string> {
  return bytesToB64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))));
}
function constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
  const max = Math.max(a.length, b.length);
  let difference = a.length ^ b.length;
  for (let index = 0; index < max; index++) difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  return difference === 0;
}
async function verifyPassword(password: string, configuredHash: string): Promise<boolean> {
  const parts = configuredHash.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isSafeInteger(iterations) || iterations < 100000 || iterations > 100000) return false;
  const salt = b64UrlToBytes(parts[2]);
  const expected = b64UrlToBytes(parts[3]);
  if (salt.length < 16 || expected.length !== 32) return false;
  const imported = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const derived = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, imported, 256));
  return constantTimeEquals(derived, expected);
}
function cookieValue(request: Request): string | null {
  const matched = request.headers.get('Cookie')?.match(/(?:^|;\s*)pocketku_session=([^;]+)/);
  return matched ? matched[1] : null;
}
function sessionCookie(token: string, request: Request, maxAge: number): string {
  // Browsers accept Secure cookies on localhost; deployment requires HTTPS.
  const isLocal = new URL(request.url).hostname === 'localhost' || new URL(request.url).hostname === '127.0.0.1';
  return `${COOKIE_NAME}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${isLocal ? '' : '; Secure'}`;
}
/** Reject cross-site writes even when an authenticated session cookie exists. */
function sameOriginMutation(request: Request): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return true;
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') return false;
  return origin === new URL(request.url).origin;
}
function configured(env: PocketKuAuthEnv): boolean {
  return Boolean(env.PK_LOGIN_ID?.trim() && env.PK_PASSWORD_HASH?.startsWith('pbkdf2-sha256$'));
}
export async function hasPocketKuSession(request: Request, env: PocketKuAuthEnv): Promise<boolean> {
  if (!configured(env)) return false;
  const token = cookieValue(request);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const sessionHash = await sha256(token);
  const row = await env.DB.prepare('SELECT 1 AS valid FROM pk_auth_sessions WHERE session_hash=? AND expires_at>?')
    .bind(sessionHash, Math.floor(Date.now() / 1000)).first();
  return Boolean(row);
}
export function mutationAllowed(request: Request): boolean { return sameOriginMutation(request); }

export async function authRoute(request: Request, env: PocketKuAuthEnv, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith('/api/auth/')) return null;
  if (!configured(env)) return error('PocketKu login has not been configured. Run the local login setup.', 503);
  if (!sameOriginMutation(request)) return error('Cross-origin request rejected.', 403);
  try {
    if (url.pathname === '/api/auth/me' && request.method === 'GET') {
      const authenticated = await hasPocketKuSession(request, env);
      return json({ success: true, authenticated });
    }
    if (url.pathname === '/api/auth/logout' && request.method === 'POST') {
      const token = cookieValue(request);
      if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
        await env.DB.prepare('DELETE FROM pk_auth_sessions WHERE session_hash=?').bind(await sha256(token)).run();
      }
      return json({ success: true }, 200, { 'Set-Cookie': sessionCookie('', request, 0) });
    }
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      const contentType = request.headers.get('Content-Type') ?? '';
      if (!contentType.includes('application/json')) return error('JSON request required.', 415);
      // Limit request body consumption before parsing passwords.
      const length = Number(request.headers.get('Content-Length') ?? '0');
      if (length > 4096) return error('Request too large.', 413);
      const payload = await request.json() as Record<string, unknown>;
      if (!payload || typeof payload !== 'object' || typeof payload.login !== 'string' || typeof payload.password !== 'string' ||
        payload.login.length > 255 || payload.password.length > 1024) return error('Invalid credentials.', 401);
      const submittedLogin = payload.login.trim().toLowerCase();
      const configuredLogin = env.PK_LOGIN_ID!.trim().toLowerCase();
      const ip = request.headers.get('CF-Connecting-IP') || 'local';
      const subject = await sha256(`${ip}|${configuredLogin}`);
      const now = Math.floor(Date.now() / 1000);
      const attempt = await env.DB.prepare('SELECT failures, blocked_until FROM pk_auth_attempts WHERE subject=?')
        .bind(subject).first<{ failures: number; blocked_until: number }>();
      if (attempt && attempt.blocked_until > now) return error('Too many attempts. Try again later.', 429);
      const passwordOkay = await verifyPassword(payload.password, env.PK_PASSWORD_HASH!);
      if (!(submittedLogin === configuredLogin && passwordOkay)) {
        const failures = (attempt && attempt.blocked_until === 0 ? attempt.failures : 0) + 1;
        await env.DB.prepare(`INSERT INTO pk_auth_attempts(subject,failures,blocked_until,updated_at)
          VALUES(?,?,?,?) ON CONFLICT(subject) DO UPDATE SET
          failures=excluded.failures,blocked_until=excluded.blocked_until,updated_at=excluded.updated_at`)
          .bind(subject, failures, failures >= LOGIN_LIMIT ? now + LOCK_SECONDS : 0, now).run();
        return error('Invalid login or password.', 401);
      }
      await env.DB.prepare('DELETE FROM pk_auth_attempts WHERE subject=?').bind(subject).run();
      const random = crypto.getRandomValues(new Uint8Array(32));
      const token = bytesToB64Url(random);
      await env.DB.prepare('INSERT INTO pk_auth_sessions(session_hash,created_at,expires_at) VALUES(?,?,?)')
        .bind(await sha256(token), now, now + SESSION_LIFETIME).run();
      return json({ success: true, authenticated: true }, 200, {
        'Set-Cookie': sessionCookie(token, request, SESSION_LIFETIME),
      });
    }
    return error('Authentication endpoint not found.', 404);
  } catch (exception) {
    console.error('Authentication request failed', exception instanceof Error ? exception.name : 'unknown');
    return error('Login is unavailable. Ensure migration 0010 has been applied and secrets configured.', 503);
  }
}

export function unauthorized(): Response { return error('Sign in to PocketKu first.', 401); }
export function missingAuthConfig(): Response { return error('PocketKu login is not configured. Access denied.', 503); }
export function isPocketKuConfigured(env: PocketKuAuthEnv): boolean { return configured(env); }
export function csrfDenied(): Response { return error('Request origin not allowed.', 403); }
