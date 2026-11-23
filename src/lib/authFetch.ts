import { auth } from './firebase';

/**
 * Wrapper around `fetch` that automatically attaches the signed-in user's
 * Firebase Auth ID token (`Authorization: Bearer <token>`) when available.
 */
export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers ?? {});
  const currentUser = auth.currentUser;
  if (currentUser) {
    try {
      const idToken = await currentUser.getIdToken();
      if (idToken) {
        headers.set('Authorization', `Bearer ${idToken}`);
      }
    } catch {
      // Proceed without token if transient token refresh fails; server will enforce auth where required
    }
  }
  return fetch(input, { ...init, headers });
}
