// Session epoch: a counter that advances whenever the signed-in identity changes
// (login, logout, register, 401). Async work captures the epoch when it starts
// and must not write state, show results or trigger follow-up requests once the
// epoch has moved on.
//
// This protects the *frontend* from stale results. It cannot cancel a backend
// mutation that was already sent: that request executed as the user who sent it.

let epoch = 0;

export function currentEpoch(): number { return epoch; }
export function advanceEpoch(): void { epoch += 1; }

/** Thrown to callers when an operation finished after its session ended. Callers should stop quietly. */
export class StaleSessionError extends Error {
  constructor() { super("This operation belongs to a session that has ended."); this.name = "StaleSessionError"; }
}

export function isStaleSession(error: unknown): error is StaleSessionError {
  return error instanceof StaleSessionError;
}

export interface SessionGuard {
  isCurrent: () => boolean;
  /** Throws StaleSessionError if the session has changed since the guard was captured. */
  assertCurrent: () => void;
  /** Awaits `work`; if the session changed meanwhile, its result *or error* is discarded in favour of StaleSessionError. */
  run: <T>(work: Promise<T>) => Promise<T>;
}

export function captureSession(): SessionGuard {
  const captured = epoch;
  const isCurrent = () => captured === epoch;
  const assertCurrent = () => { if (!isCurrent()) throw new StaleSessionError(); };
  return {
    isCurrent,
    assertCurrent,
    run: async (work) => {
      let value;
      try { value = await work; }
      catch (error) { assertCurrent(); throw error; }
      assertCurrent();
      return value;
    },
  };
}
