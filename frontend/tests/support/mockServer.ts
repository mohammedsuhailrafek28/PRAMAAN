// Replaces axios's network adapter so the *real* api.ts, stores and interceptors
// run against scripted responses that tests can hold open and release at will.
import axios, { AxiosError, type InternalAxiosRequestConfig } from "axios";

export interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void }
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export interface MockReply { status?: number; data?: unknown }
type Handler = (config: InternalAxiosRequestConfig) => MockReply | Promise<MockReply>;

const handlers = new Map<string, Handler>();
/** Every request the client actually sent, e.g. "GET /audit-logs", in order. */
export const requests: string[] = [];

export function on(route: string, handler: Handler | MockReply): void {
  handlers.set(route, typeof handler === "function" ? handler : () => handler);
}
export function resetServer(): void { handlers.clear(); requests.length = 0; }
export function sent(route: string): number { return requests.filter((item) => item === route).length; }

axios.defaults.adapter = async (config) => {
  const route = `${String(config.method).toUpperCase()} ${config.url}`;
  requests.push(route);
  const handler = handlers.get(route);
  const reply = handler ? await handler(config as InternalAxiosRequestConfig) : { status: 404, data: { error: { code: "NOT_FOUND", message: `no mock for ${route}` } } };
  const response = { data: reply.data ?? {}, status: reply.status ?? 200, statusText: "", headers: {}, config: config as InternalAxiosRequestConfig };
  if (response.status >= 400) throw new AxiosError(`HTTP ${response.status}`, "ERR_BAD_REQUEST", response.config, null, response);
  return response;
};

export const loginReply = (id: string, role: "MSME" | "BUYER" | "BANK", token: string): MockReply => ({
  data: { token, user: { id, role, email: `${id}@x.test`, name: id, organizationName: `${id} Org` } },
});
export const businessReply = (legalName: string): MockReply => ({
  data: { business: { id: `b-${legalName}`, userId: "u", legalName, gstin: "33ABCDE1234F1Z5", trustStatus: "SELF_DECLARED", documents: [] } },
});
