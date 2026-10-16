import { authenticate, createAccount, listKoperasi, loanAction, setSubscription, setupKoperasi, type Env } from '../_lib/handlers.ts';
import { ApiError } from '../_lib/google.ts';

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Cloudflare Pages Function: semua rute /api/*. */
export const onRequest = async (context: { request: Request; env: Env }): Promise<Response> => {
  const { request, env } = context;
  const route = new URL(request.url).pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');

  try {
    const caller = await authenticate(request, env);

    if (route === 'me' && request.method === 'GET') {
      return json({ uid: caller.uid, kid: caller.kid, role: caller.role, superadmin: caller.superadmin });
    }
    if (request.method !== 'POST') throw new ApiError(405, 'Metode tidak diizinkan');

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    switch (route) {
      case 'setup-koperasi':
        return json(await setupKoperasi(caller, body, env));
      case 'create-account':
        return json(await createAccount(caller, body, env));
      case 'list-koperasi':
        return json(await listKoperasi(caller, env));
      case 'set-subscription':
        return json(await setSubscription(caller, body, env));
      case 'loan-action':
        return json(await loanAction(caller, body, env));
      default:
        throw new ApiError(404, 'Rute tidak ditemukan');
    }
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    console.error(e);
    const detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 200) : '';
    return json({ error: `Terjadi kesalahan pada server${detail ? ` (${detail})` : ''}` }, 500);
  }
};
