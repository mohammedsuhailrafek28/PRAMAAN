// Session plumbing shared by the HTTP client and the auth store, kept free of
// either so there is no import cycle and it can be unit-tested.

export const TOKEN_KEY = "pramaan_access_token";

type Listener = () => void;
let unauthorizedListener: Listener | null = null;

/** The auth store registers here so a 401 can end the UI session. */
export function onUnauthorized(listener: Listener | null): void {
  unauthorizedListener = listener;
}

export function notifyUnauthorized(): void {
  unauthorizedListener?.();
}

/**
 * A 401 only means "session ended" when we actually sent a token. A 401 from a
 * failed login attempt (no token) is just a wrong password.
 */
export function isSessionExpiry(status: number | undefined, sentToken: boolean): boolean {
  return status === 401 && sentToken;
}
