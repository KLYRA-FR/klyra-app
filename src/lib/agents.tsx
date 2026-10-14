"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { DEFAULT_META, PRINCIPAL } from "@/data/agents";
import { getField, parseAgentFile, parseBody, splitDescription } from "@/lib/agent-file";
import { BridgeError, getBridge, unwrap, type AgentsMeta, type HistoryEntry } from "@/lib/bridge";
import { ROLE_TEINTES, type Role, type RoleFile, type RoleTeinte } from "@/types/domain";

/**
 * Les agents de l'équipe, lus dans `~/.claude/agents/*.md`.
 * - App de bureau : les vrais fichiers, rechargés dès qu'ils changent sur le
 *   disque (même modifiés hors de l'app). Modifiables.
 * - Navigateur (pnpm dev) : les fiches de l'équipe embarquées, en lecture seule.
 */

export type AgentsStatus = "chargement" | "disque" | "exemple" | "erreur";

/** Couleur stable pour un agent sans réglage : tirée de son nom. */
function teinteParDefaut(name: string): RoleTeinte {
  const palette = ROLE_TEINTES.filter((t) => t !== "bleu-k1");
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return palette[hash % palette.length];
}

/** Construit un agent à partir du texte de sa fiche. */
export function roleFromContent(
  name: string,
  content: string,
  meta: AgentsMeta,
  file: RoleFile | null,
): Role {
  const { frontmatter, body } = parseAgentFile(content);
  const displayName = getField(frontmatter, "displayName") || name;
  const description = getField(frontmatter, "description") ?? "";
  const { title, skills, whenToCall } = splitDescription(description);
  const parsed = parseBody(body);
  const headingRole = parsed.heading.split(" — ")[1]?.trim();
  const reglage = meta[name] ?? {};
  const teinte = (ROLE_TEINTES as string[]).includes(reglage.teinte ?? "")
    ? (reglage.teinte as RoleTeinte)
    : (DEFAULT_META[name]?.teinte ?? teinteParDefaut(name));
  return {
    id: name,
    name: displayName,
    tag: reglage.tag || DEFAULT_META[name]?.tag || headingRole || name,
    title: title || headingRole || "",
    initial: displayName.charAt(0).toUpperCase(),
    teinte,
    description,
    whenToCall: whenToCall || description,
    skills,
    heading: parsed.heading,
    pitch: parsed.pitch,
    sections: parsed.sections,
    model: getField(frontmatter, "model") ?? "",
    memory: getField(frontmatter, "memory") ?? "",
    file,
  };
}

const EXEMPLES: Role[] = AGENT_TEMPLATES.map((t) => roleFromContent(t.name, t.content, {}, null));

interface AgentsApi {
  /** Le Principal, puis les agents par ordre alphabétique de prénom. */
  roles: Role[];
  status: AgentsStatus;
  error: string | null;
  /** Dossier des fiches sur ce poste. */
  dir: string | null;
  /** Agents de l'équipe KLYRA pas encore installés sur ce poste. */
  missing: string[];
  meta: AgentsMeta;
  canEdit: boolean;
  reload: () => Promise<void>;
  install: (names?: string[]) => Promise<string[]>;
  /** Enregistre la fiche et les réglages de l'app ; lève une BridgeError « conflit » si le fichier a changé. */
  save: (id: string, content: string, reglage: { tag: string; teinte: RoleTeinte }, expectedModifiedAt: number | null) => Promise<void>;
  create: (id: string, content: string, reglage: { tag: string; teinte: RoleTeinte }) => Promise<void>;
  history: (id: string) => Promise<HistoryEntry[]>;
  readVersion: (id: string, versionId: string) => Promise<string>;
  reveal: (id: string) => Promise<void>;
}

const AgentsContext = createContext<AgentsApi | null>(null);

export function AgentsProvider({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const [files, setFiles] = useState<{ name: string; content: string; file: RoleFile }[]>([]);
  const [meta, setMeta] = useState<AgentsMeta>({});
  // Toujours la dernière version des réglages : plusieurs écritures peuvent s'enchaîner.
  const metaRef = useRef<AgentsMeta>({});
  const [status, setStatus] = useState<AgentsStatus>(bridge ? "chargement" : "exemple");
  const [error, setError] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bridge) return;
    try {
      const [listing, reglages] = await Promise.all([bridge.agents.list().then(unwrap), bridge.agents.readMeta().then(unwrap)]);
      setDir(listing.dir);
      metaRef.current = reglages;
      setMeta(reglages);
      setFiles(listing.agents.map((a) => ({ name: a.name, content: a.content, file: { path: a.path, content: a.content, modifiedAt: a.modifiedAt } })));
      setStatus("disque");
      setError(null);
    } catch (e) {
      setStatus("erreur");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [bridge]);

  useEffect(() => {
    if (!bridge) return;
    // Premier chargement, puis à chaque changement des fichiers sur le disque.
    const first = setTimeout(() => void reload(), 0);
    const stop = bridge.agents.onChange(() => void reload());
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [bridge, reload]);

  const roles = useMemo(() => {
    const agents =
      status === "exemple" ? EXEMPLES : files.map((f) => roleFromContent(f.name, f.content, meta, f.file));
    return [PRINCIPAL, ...[...agents].sort((a, b) => a.name.localeCompare(b.name, "fr"))];
  }, [status, files, meta]);

  const missing = useMemo(
    () => (status === "disque" ? AGENT_TEMPLATES.map((t) => t.name).filter((n) => !files.some((f) => f.name === n)) : []),
    [status, files],
  );

  const requireBridge = useCallback(() => {
    if (!bridge) throw new BridgeError("navigateur", "Disponible seulement dans l’app de bureau.");
    return bridge;
  }, [bridge]);

  const saveMeta = useCallback(
    async (id: string, reglage: { tag: string; teinte: RoleTeinte }) => {
      const current = metaRef.current[id];
      if (current?.tag === reglage.tag && current?.teinte === reglage.teinte) return;
      const next = { ...metaRef.current, [id]: reglage };
      metaRef.current = next;
      unwrap(await requireBridge().agents.writeMeta(next));
      setMeta(next);
    },
    [requireBridge],
  );

  const api = useMemo<AgentsApi>(
    () => ({
      roles,
      status,
      error,
      dir,
      missing,
      meta,
      canEdit: status === "disque",
      reload,
      install: async (names) => {
        const templates = AGENT_TEMPLATES.filter((t) => !names || names.includes(t.name));
        const installed = unwrap(await requireBridge().agents.installTeam(templates));
        await reload();
        return installed;
      },
      save: async (id, content, reglage, expectedModifiedAt) => {
        unwrap(await requireBridge().agents.write(id, content, expectedModifiedAt));
        await saveMeta(id, reglage);
        await reload();
      },
      create: async (id, content, reglage) => {
        unwrap(await requireBridge().agents.create(id, content));
        await saveMeta(id, reglage);
        await reload();
      },
      history: async (id) => unwrap(await requireBridge().agents.history(id)),
      readVersion: async (id, versionId) => unwrap(await requireBridge().agents.readVersion(id, versionId)),
      reveal: async (id) => unwrap(await requireBridge().agents.reveal(id)),
    }),
    [roles, status, error, dir, missing, meta, reload, requireBridge, saveMeta],
  );

  return <AgentsContext.Provider value={api}>{children}</AgentsContext.Provider>;
}

export function useAgents(): AgentsApi {
  const ctx = useContext(AgentsContext);
  if (!ctx) throw new Error("useAgents doit être utilisé dans <AgentsProvider>");
  return ctx;
}
