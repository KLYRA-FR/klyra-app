"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appliquerDependances, avecIdentifiant, dependancesManquantes, identifiantLibre } from "../../convex/model/definitions";
// Les règles de la bibliothèque (`convex/model/definitions.ts`) servent aussi ici : aperçu, dossiers, identifiants.
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { DEFAULT_META, PRINCIPAL } from "@/data/agents";
import { getField, parseAgentFile, parseBody, splitDescription } from "@/lib/agent-file";
import {
  BridgeError,
  getBridge,
  unwrap,
  type AgentsMeta,
  type EntreeMesAgents,
  type HistoryEntry,
  type MesAgents,
  type OrigineAgent,
} from "@/lib/bridge";
import { ROLE_TEINTES, type Role, type RoleFile, type RoleTeinte } from "@/types/domain";

/**
 * Les agents de la personne.
 * - Les fiches sont les vrais fichiers `~/.claude/agents/*.md` (app de bureau), rechargées dès
 *   qu'elles changent sur le disque, même modifiées hors de l'app. L'app n'en supprime jamais.
 * - « Mes agents » (`mes-agents.json`, process principal) dit lesquels sont à elle et actifs :
 *   seuls ceux-là sont proposés, mentionnables et appelables par l'assistant.
 * - Navigateur (pnpm dev) : l'assistant seul, en lecture seule.
 */

export type AgentsStatus = "chargement" | "disque" | "exemple" | "erreur";

/** Où en est une fiche de l'ordinateur par rapport à Mes agents. */
export type StatutAgent = "actif" | "desactive" | "disponible";

export interface AgentLocal {
  role: Role;
  statut: StatutAgent;
  entree: EntreeMesAgents | null;
  /** Agent reçu de la bibliothèque dont la fiche a changé depuis son ajout (ici ou ailleurs). */
  modifie: boolean;
  /** Dépendances encore à configurer (`{{chemin:…}}` dans la fiche) : l'agent n'est pas prêt. */
  manquantes: string[];
}

/** Une définition à ajouter, d'où qu'elle vienne (modèle KLYRA ou bibliothèque). */
export interface DefinitionAAjouter {
  _id: string;
  slug: string;
  contenu: string;
  version: number;
  auteur: { nom: string };
}

/** Couleur stable pour un agent sans réglage : tirée de son nom. */
function teinteParDefaut(name: string): RoleTeinte {
  const palette = ROLE_TEINTES.filter((t) => t !== "bleu-k1");
  const hash = [...name].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return palette[hash % palette.length];
}

const estTeinte = (t: string | null | undefined): t is RoleTeinte => (ROLE_TEINTES as string[]).includes(t ?? "");

/** La fiche locale d'une définition : sous l'identifiant choisi (mot pour mot s'il ne change pas), dossiers remplis. */
function ficheLocale(partage: string, id: string, valeurs: Record<string, string>): string {
  const memeNom = getField(parseAgentFile(partage).frontmatter, "name") === id;
  return appliquerDependances(memeNom ? partage : avecIdentifiant(partage, id), valeurs).contenu;
}

/** Construit un agent à partir du texte de sa fiche et des préférences de la personne. */
export function roleFromContent(name: string, content: string, meta: AgentsMeta, file: RoleFile | null): Role {
  const { frontmatter, body } = parseAgentFile(content);
  const reglage = meta[name] ?? {};
  const displayName = reglage.nom?.trim() || getField(frontmatter, "displayName") || name;
  const description = getField(frontmatter, "description") ?? "";
  const { title, skills, whenToCall } = splitDescription(description);
  const parsed = parseBody(body);
  const headingRole = parsed.heading.split(" — ")[1]?.trim();
  const teinte = estTeinte(reglage.teinte) ? reglage.teinte : (DEFAULT_META[name]?.teinte ?? teinteParDefaut(name));
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

/** L'assistant, avec le nom et la couleur choisis. Son identifiant ne change jamais. */
export function roleAssistant(assistant: MesAgents["assistant"] | null): Role {
  const nom = assistant?.nom?.trim() || PRINCIPAL.name;
  return {
    ...PRINCIPAL,
    name: nom,
    initial: nom.charAt(0).toUpperCase(),
    teinte: estTeinte(assistant?.teinte) ? assistant.teinte : PRINCIPAL.teinte,
    heading: `${nom} — ${PRINCIPAL.title}`,
  };
}

interface AgentsApi {
  /** L'assistant, puis les agents actifs de Mes agents par ordre alphabétique : ceux qu'on peut appeler. */
  roles: Role[];
  /** Toutes les fiches de l'ordinateur : actives, désactivées, et celles pas encore choisies. */
  tous: AgentLocal[];
  /** Le choix de la personne ; null dans un navigateur ou avant le chargement. */
  mes: MesAgents | null;
  /** L'assistant n'a pas encore de nom (nouveau profil). */
  assistantANommer: boolean;
  status: AgentsStatus;
  error: string | null;
  /** Dossier des fiches sur ce poste. */
  dir: string | null;
  meta: AgentsMeta;
  canEdit: boolean;
  reload: () => Promise<void>;
  nommerAssistant: (nom: string, teinte?: RoleTeinte | null) => Promise<void>;
  activer: (id: string, actif: boolean) => Promise<void>;
  /** Ajoute à Mes agents une fiche déjà sur l'ordinateur. */
  ajouter: (id: string) => Promise<void>;
  /** Un identifiant libre pour une nouvelle fiche, à partir de celui proposé. */
  identifiantLibre: (propose: string) => string;
  /** Ajoute une définition comme nouvelle fiche, sous `id` (jamais par-dessus une autre). */
  installer: (def: DefinitionAAjouter, options: { id: string; origine: OrigineAgent; valeurs?: Record<string, string> }) => Promise<string>;
  /**
   * Réécrit un agent reçu avec une définition (mise à jour acceptée, dossiers configurés).
   * Lève une BridgeError « modifie-localement » si sa fiche a changé, sauf `forcer`.
   */
  appliquer: (id: string, partage: string, origine: OrigineAgent, forcer?: boolean) => Promise<void>;
  changerOrigine: (id: string, origine: OrigineAgent) => Promise<void>;
  definitionRecue: (id: string) => Promise<string | null>;
  /** Enregistre la fiche et les réglages de l'app ; lève une BridgeError « conflit » si le fichier a changé. */
  save: (id: string, content: string, reglage: { tag: string; teinte: RoleTeinte; nom?: string }, expectedModifiedAt: number | null) => Promise<void>;
  /** Préférences personnelles seules (nom affiché, rôle court, couleur) : la fiche ne change pas. */
  saveReglage: (id: string, reglage: { tag: string; teinte: RoleTeinte; nom?: string }) => Promise<void>;
  create: (id: string, content: string, reglage: { tag: string; teinte: RoleTeinte }) => Promise<void>;
  history: (id: string) => Promise<HistoryEntry[]>;
  readVersion: (id: string, versionId: string) => Promise<string>;
  reveal: (id: string) => Promise<void>;
}

const AgentsContext = createContext<AgentsApi | null>(null);

type Fiche = { name: string; content: string; file: RoleFile; empreinte: string };

export function AgentsProvider({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const [files, setFiles] = useState<Fiche[]>([]);
  const [mes, setMes] = useState<MesAgents | null>(null);
  const [meta, setMeta] = useState<AgentsMeta>({});
  // Toujours la dernière version des réglages : plusieurs écritures peuvent s'enchaîner.
  const metaRef = useRef<AgentsMeta>({});
  const filesRef = useRef<Fiche[]>([]);
  const [status, setStatus] = useState<AgentsStatus>(bridge ? "chargement" : "exemple");
  const [error, setError] = useState<string | null>(null);
  const [dir, setDir] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!bridge) return;
    try {
      const [listing, reglages, choix] = await Promise.all([
        bridge.agents.list().then(unwrap),
        bridge.agents.readMeta().then(unwrap),
        bridge.agents.mes().then(unwrap),
      ]);
      setDir(listing.dir);
      metaRef.current = reglages;
      setMeta(reglages);
      setMes(choix);
      const fiches = listing.agents.map((a) => ({
        name: a.name,
        content: a.content,
        empreinte: a.empreinte,
        file: { path: a.path, content: a.content, modifiedAt: a.modifiedAt },
      }));
      filesRef.current = fiches;
      setFiles(fiches);
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

  const tous = useMemo<AgentLocal[]>(
    () =>
      files
        .map((f) => {
          const entree = mes?.agents[f.name] ?? null;
          const statut: StatutAgent = !entree ? "disponible" : entree.actif ? "actif" : "desactive";
          return {
            role: roleFromContent(f.name, f.content, meta, f.file),
            statut,
            entree,
            modifie: entree?.origine.type === "bibliotheque" && entree.empreinte !== null && entree.empreinte !== f.empreinte,
            manquantes: dependancesManquantes(f.content),
          };
        })
        .sort((a, b) => a.role.name.localeCompare(b.role.name, "fr")),
    [files, mes, meta],
  );

  const roles = useMemo(
    () => [roleAssistant(mes?.assistant ?? null), ...tous.filter((a) => a.statut === "actif").map((a) => a.role)],
    [mes, tous],
  );

  const requireBridge = useCallback(() => {
    if (!bridge) throw new BridgeError("navigateur", "Disponible seulement dans l’app de bureau.");
    return bridge;
  }, [bridge]);

  const saveMeta = useCallback(
    async (id: string, reglage: { tag: string; teinte: RoleTeinte; nom?: string }) => {
      const current = metaRef.current[id];
      const nom = reglage.nom?.trim() || undefined;
      if (current?.tag === reglage.tag && current?.teinte === reglage.teinte && current?.nom === nom) return;
      const next = { ...metaRef.current, [id]: { tag: reglage.tag, teinte: reglage.teinte, ...(nom ? { nom } : {}) } };
      metaRef.current = next;
      unwrap(await requireBridge().agents.writeMeta(next));
      setMeta(next);
    },
    [requireBridge],
  );

  const pris = useCallback((id: string) => id === PRINCIPAL.id || filesRef.current.some((f) => f.name === id), []);

  const api = useMemo<AgentsApi>(
    () => ({
      roles,
      tous,
      mes,
      assistantANommer: status === "disque" && !!mes && mes.assistant.nom === null,
      status,
      error,
      dir,
      meta,
      canEdit: status === "disque",
      reload,
      nommerAssistant: async (nom, teinte = null) => {
        setMes(unwrap(await requireBridge().agents.nommerAssistant(nom, teinte)));
      },
      activer: async (id, actif) => {
        setMes(unwrap(await requireBridge().agents.activer(id, actif)));
      },
      ajouter: async (id) => {
        setMes(unwrap(await requireBridge().agents.ajouter(id)));
      },
      identifiantLibre: (propose) => identifiantLibre(propose, pris),
      installer: async (def, { id, origine, valeurs = {} }) => {
        const local = ficheLocale(def.contenu, id, valeurs);
        const { mes: choix } = unwrap(
          await requireBridge().agents.installer(id, local, origine, origine.type === "bibliotheque" ? def.contenu : null),
        );
        setMes(choix);
        await reload();
        return id;
      },
      appliquer: async (id, partage, origine, forcer = false) => {
        const local = ficheLocale(partage, id, origine.type === "bibliotheque" ? origine.valeurs : {});
        const fiche = filesRef.current.find((f) => f.name === id);
        const { mes: choix } = unwrap(
          await requireBridge().agents.appliquer(id, local, origine, partage, fiche?.file.modifiedAt ?? null, forcer),
        );
        setMes(choix);
        await reload();
      },
      changerOrigine: async (id, origine) => {
        setMes(unwrap(await requireBridge().agents.changerOrigine(id, origine)));
      },
      definitionRecue: async (id) => unwrap(await requireBridge().agents.definitionRecue(id)),
      save: async (id, content, reglage, expectedModifiedAt) => {
        unwrap(await requireBridge().agents.write(id, content, expectedModifiedAt));
        await saveMeta(id, reglage);
        await reload();
      },
      saveReglage: async (id, reglage) => {
        await saveMeta(id, reglage);
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
    [roles, tous, mes, status, error, dir, meta, reload, requireBridge, saveMeta, pris],
  );

  return <AgentsContext.Provider value={api}>{children}</AgentsContext.Provider>;
}

export function useAgents(): AgentsApi {
  const ctx = useContext(AgentsContext);
  if (!ctx) throw new Error("useAgents doit être utilisé dans <AgentsProvider>");
  return ctx;
}

/** Les modèles KLYRA embarqués : une collection facultative, ajoutée une fiche à la fois. */
export const MODELES = AGENT_TEMPLATES.map((t) => ({
  ...t,
  role: roleFromContent(t.name, t.content, {}, null),
}));
