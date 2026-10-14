/**
 * Pont vers le système, exposé par `electron/preload.ts` sous `window.klyra`.
 * Absent dans un navigateur (pnpm dev) : l'app passe alors en lecture seule.
 */

export type Reponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface AgentFile {
  name: string;
  path: string;
  content: string;
  modifiedAt: number;
}

export interface AgentsListing {
  dir: string;
  exists: boolean;
  agents: AgentFile[];
}

export interface HistoryEntry {
  id: string;
  savedAt: number;
}

export type AgentsMeta = Record<string, { tag?: string; teinte?: string }>;

export interface ClaudeResult {
  ok: boolean;
  text: string;
  error?: string;
  costUsd?: number;
}

export interface KlyraBridge {
  agents: {
    list: () => Promise<Reponse<AgentsListing>>;
    write: (name: string, content: string, expectedModifiedAt: number | null) => Promise<Reponse<AgentFile>>;
    create: (name: string, content: string) => Promise<Reponse<AgentFile>>;
    installTeam: (templates: { name: string; content: string }[]) => Promise<Reponse<string[]>>;
    history: (name: string) => Promise<Reponse<HistoryEntry[]>>;
    readVersion: (name: string, id: string) => Promise<Reponse<string>>;
    readMeta: () => Promise<Reponse<AgentsMeta>>;
    writeMeta: (meta: AgentsMeta) => Promise<Reponse<void>>;
    reveal: (name: string) => Promise<Reponse<void>>;
    onChange: (callback: () => void) => () => void;
  };
  claude: {
    status: () => Promise<Reponse<{ path: string | null }>>;
    run: (requestId: string, agent: string, prompt: string) => Promise<Reponse<ClaudeResult>>;
    cancel: (requestId: string) => Promise<Reponse<void>>;
  };
}

declare global {
  interface Window {
    klyra?: KlyraBridge;
  }
}

/** Le pont si l'app tourne dans Electron, sinon null (navigateur). */
export function getBridge(): KlyraBridge | null {
  return typeof window !== "undefined" ? (window.klyra ?? null) : null;
}

/** Déballe une réponse du pont, ou lève une erreur avec son code. */
export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function unwrap<T>(reponse: Reponse<T>): T {
  if (!reponse.ok) throw new BridgeError(reponse.code, reponse.message);
  return reponse.data;
}
