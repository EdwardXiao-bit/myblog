import type { APIRoute } from 'astro';
import { adminCookie, checkPassword, issueToken, verifyToken } from '../../lib/auth';
import { createEntry, removeEntry, setStatus, validateMessage } from '../../lib/guestbook';

export const prerender = false;

const back = (path: string, m?: string) =>
  new Response(null, { status: 303, headers: { Location: m ? `${path}?m=${m}` : path } });

export const POST: APIRoute = async ({ request, cookies }) => {
  // 同源校验：管理动作都靠 cookie 认证，必须挡住跨站提交
  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (origin && host) {
    try {
      if (new URL(origin).host !== host) {
        return new Response('Forbidden', { status: 403 });
      }
    } catch {
      return new Response('Forbidden', { status: 403 });
    }
  }

  const form = await request.formData();
  const action = String(form.get('action') ?? '');

  // ---- 登录（唯一不需要已登录的动作）----
  if (action === 'login') {
    const password = String(form.get('password') ?? '');
    if (!checkPassword(password)) return back('/admin', 'bad-password');

    cookies.set(adminCookie.name, issueToken(), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: adminCookie.maxAge,
    });
    return back('/admin', 'signed-in');
  }

  // ---- 以下动作都要求已登录 ----
  if (!verifyToken(cookies.get(adminCookie.name)?.value)) return back('/admin', 'need-auth');

  if (action === 'logout') {
    cookies.delete(adminCookie.name, { path: '/' });
    return back('/admin');
  }

  if (action === 'diary') {
    const visibility = String(form.get('visibility') ?? 'public');
    const { ok, reason, body } = validateMessage(null, form.get('body'));
    if (!ok) return back('/admin', reason === 'too-long' ? 'too-long' : 'empty');

    createEntry({
      kind: 'diary',
      nickname: null,
      body,
      status: visibility === 'private' ? 'private' : 'published',
    });
    return back('/admin', visibility === 'private' ? 'diary-private' : 'diary-public');
  }

  if (action === 'moderate') {
    const id = Number(form.get('id') ?? 0);
    const op = String(form.get('op') ?? '');
    if (!Number.isInteger(id) || id <= 0) return back('/admin', 'bad-request');

    if (op === 'approve') setStatus(id, 'published');
    else if (op === 'reject') setStatus(id, 'rejected');
    else if (op === 'delete') removeEntry(id);
    else return back('/admin', 'bad-request');

    return back('/admin', 'done');
  }

  return back('/admin', 'bad-request');
};
