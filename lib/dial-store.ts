/**
 * In-process store linking a test call placed by /api/dial to the Twilio
 * callbacks it triggers (/api/dial-callback): the speech transcript and the
 * async answering-machine result. Kept on globalThis so both route bundles see
 * the same Map. Entries expire after 10 minutes. If a callback never arrives
 * (e.g. another server instance), the dial test simply reports without it.
 */
export interface DialCallState {
  /** The exact callback URL (with ?k=token) Twilio was given; used to verify its signature. */
  url: string;
  created: number;
  answeredBy?: string;
  speech?: string;
  gatherDone?: boolean;
}

const g = globalThis as unknown as { __cresDialStore?: Map<string, DialCallState> };
export const dialStore: Map<string, DialCallState> = g.__cresDialStore ?? (g.__cresDialStore = new Map());

export function pruneDialStore(now = Date.now()): void {
  for (const [k, v] of dialStore) if (now - v.created > 10 * 60 * 1000) dialStore.delete(k);
}
