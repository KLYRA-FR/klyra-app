"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appliquerDependances, avecIdentifiant, dependancesManquantes, identifiantLibre } from "../../convex/model/definitions";
// Les règles de la bibliothèque (`convex/model/definitions.ts`) servent aussi ici : aperçu, dossiers, identifiants.
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { DEFAULT_META, PRINCIPAL } from "@/data/agents";
import { getField, parseAgentFile, parseBody, serializeAgentFile, setFields, splitDescription } from "@/lib/agent-file";
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
import { useLieuActif } from "@/lib/lieux";
import { pontAgents, type PontAgents } from "@/lib/agents-pont";
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

/**
 * La fiche locale d'une définition : sous l'identifiant choisi (mot pour mot s'il ne change pas),
 * dossiers remplis, et le modèle choisi par la personne s'il diffère (une préférence, comme son nom).
 */
function ficheLocale(partage: string, id: string, valeurs: Record<string, string>, modele?: string): string {
  const { frontmatter, body } = parseAgentFile(partage);
  const memeNom = getField(frontmatter, "name") === id;
  const base = memeNom ? partage : avecIdentifiant(partage, id);
  const avecModele = modele && modele !== getField(frontmatter, "model") ? serializeAgentFile({ frontmatter: setFields(parseAgentFile(base).frontmatter, { model: modele }), body }) : base;
  return appliquerDependances(avecModele, valeurs).contenu;
}

/** Construit un agent à partir du texte de sa fiche et des préférences de la personne. */
/** La couleur qu'un agent pas encore créé recevra (carte de l'atelier, au bureau comme sur le téléphone). */
export const teinteNouvelAgent = (id: string): RoleTeinte => roleFromContent(id, "", {}, null).teinte;

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
    ...(reglage.fournisseur ? { fournisseur: reglage.fournisseur } : {}),
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
  /** Le serveur affiché n'est pas encore à jour : il n'a pas d'équipe à lui, et c'est celle de ce PC. */
  serveurAncien: boolean;
  /** Copie un agent sur un autre serveur (null : ce PC). Refuse si un agent de ce nom y est déjà. */
  copierVers: (id: string, cible: string | null) => Promise<void>;
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
  /**
   * Enregistre la fiche et les réglages de l'app donnés (les autres restent tels quels) ; lève une
   * BridgeError « conflit » si le fichier a changé.
   */
  save: (id: string, content: string, reglage: { tag?: string; teinte?: RoleTeinte; nom?: string }, expectedModifiedAt: number | null) => Promise<void>;
  /** Préférences personnelles seules (nom affiché, rôle court, couleur) : la fiche ne change pas. */
  saveReglage: (id: string, reglage: { tag?: string; teinte?: RoleTeinte; nom?: string }) => Promise<void>;
  /**
   * Le modèle d'un agent. Reçu de la bibliothèque : une préférence gardée aux mises à jour, sans
   * le détacher (sa fiche est réécrite depuis la version suivie) ; sinon, écrit dans sa fiche.
   */
  changerModele: (id: string, modele: string) => Promise<void>;
  /** Le fournisseur de ses nouvelles conversations et de ses fils. */
  changerFournisseur: (id: string, fournisseur: string) => Promise<void>;
  /**
   * Sa place dans la barre et ses notifications, sur ce poste : masqué (toujours actif et appelable),
   * muet (ses réponses finies ne préviennent plus ; ses erreurs, si), épinglé en haut.
   */
  preferer: (id: string, preference: { masque?: boolean; muet?: boolean; epingle?: boolean }) => Promise<void>;
  /** L'ordre choisi dans la barre (glisser un agent) : chaque agent donné reçoit son rang, en une seule écriture. */
  ranger: (ids: string[]) => Promise<void>;
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

  /* L'équipe du serveur affiché. Un serveur pas encore à jour n'a pas d'équipe à lui : celle de ce PC, et l'écran le dit. */
  const lieu = useLieuActif();
  const [ancien, setAncien] = useState<string | null>(null);
  const lieuEquipe = lieu && lieu !== ancien && bridge?.agents.vps ? lieu : null;
  const pont = useMemo<PontAgents | null>(() => (bridge ? pontAgents(bridge, lieuEquipe) : null), [bridge, lieuEquipe]);
  /* Ce que voit l'écran pendant le changement de serveur : rien de l'équipe d'avant. */
  const [equipeVue, setEquipeVue] = useState<string | null>(lieuEquipe);
  if (equipeVue !== lieuEquipe) {
    setEquipeVue(lieuEquipe);
    setFiles([]);
    setMes(null);
    setMeta({});
    setStatus(bridge ? "chargement" : "exemple");
    setError(null);
  }

  const reload = useCallback(async () => {
    if (!pont) return;
    try {
      /* La liste d'abord : sur un VPS neuf, c'est elle qui crée son équipe (cf. `agents:vps`). */
      const listing = unwrap(await pont.list());
      const [reglages, choix] = await Promise.all([pont.readMeta().then(unwrap), pont.mes().then(unwrap)]);
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
      if (e instanceof BridgeError && e.code === "serveur-ancien" && lieuEquipe) {
        setAncien(lieuEquipe);
        return;
      }
      setStatus("erreur");
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [pont, lieuEquipe]);

  useEffect(() => {
    if (!bridge) return;
    const first = setTimeout(() => void reload(), 0);
    /* Sur un VPS, une relecture régulière : aucun signal n'arrive de ses fichiers. */
    if (lieuEquipe) {
      const minuterie = setInterval(() => void reload(), 30_000);
      return () => {
        clearTimeout(first);
        clearInterval(minuterie);
      };
    }
    // Premier chargement, puis à chaque changement des fichiers sur le disque.
    const stop = bridge.agents.onChange(() => void reload());
    return () => {
      clearTimeout(first);
      stop();
    };
  }, [bridge, reload, lieuEquipe]);

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

  const requirePont = useCallback(() => {
    if (!pont) throw new BridgeError("navigateur", "Disponible seulement dans l’app de bureau.");
    return pont;
  }, [pont]);

  /* Les préférences d'un agent : on remplace ce qui est donné, le reste (modèle choisi…) est gardé. */
  const saveMeta = useCallback(
    async (id: string, reglage: { tag?: string; teinte?: RoleTeinte; nom?: string; modele?: string; fournisseur?: string; masque?: boolean; muet?: boolean; epingleLe?: string }) => {
      const current = metaRef.current[id] ?? {};
      const voulu = { ...current, ...reglage };
      // Une bascule éteinte ne s'écrit pas.
      if ("masque" in reglage && !reglage.masque) delete voulu.masque;
      if ("muet" in reglage && !reglage.muet) delete voulu.muet;
      if ("epingleLe" in reglage && !reglage.epingleLe) delete voulu.epingleLe;
      if ("nom" in reglage && !reglage.nom?.trim()) delete voulu.nom;
      if ("modele" in reglage && !reglage.modele) delete voulu.modele;
      // Claude est le fournisseur par défaut : il ne s'écrit pas.
      if ("fournisseur" in reglage && (!reglage.fournisseur || reglage.fournisseur === "claude")) delete voulu.fournisseur;
      if (JSON.stringify(voulu) === JSON.stringify(current)) return;
      const next = { ...metaRef.current, [id]: voulu };
      metaRef.current = next;
      unwrap(await requirePont().writeMeta(next));
      setMeta(next);
    },
    [requirePont],
  );

  const pris = useCallback((id: string) => id === PRINCIPAL.id || filesRef.current.some((f) => f.name === id), []);

  const serveurAncien = !!lieu && lieu === ancien;

  const api = useMemo<AgentsApi>(
    () => ({
      serveurAncien,
      copierVers: async (id, cible) => {
        if (!bridge) throw new BridgeError("navigateur", "Disponible seulement dans l’app de bureau.");
        const fiche = filesRef.current.find((f) => f.name === id);
        if (!fiche) throw new BridgeError("introuvable", "Cette fiche n’existe plus.");
        /* Une copie : un agent distinct, avec ses discussions et sa mémoire. Rien n'écrase un agent déjà là. */
        const autre = pontAgents(bridge, cible);
        unwrap(await autre.create(id, fiche.content));
        const { tag, teinte, nom } = metaRef.current[id] ?? {};
        const reglages = unwrap(await autre.readMeta());
        unwrap(await autre.writeMeta({ ...reglages, [id]: { ...(tag ? { tag } : {}), ...(teinte ? { teinte } : {}), ...(nom ? { nom } : {}) } }));
      },
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
        setMes(unwrap(await requirePont().nommerAssistant(nom, teinte)));
      },
      activer: async (id, actif) => {
        setMes(unwrap(await requirePont().activer(id, actif)));
      },
      ajouter: async (id) => {
        setMes(unwrap(await requirePont().ajouter(id)));
      },
      identifiantLibre: (propose) => identifiantLibre(propose, pris),
      installer: async (def, { id, origine, valeurs = {} }) => {
        const local = ficheLocale(def.contenu, id, valeurs, metaRef.current[id]?.modele);
        const { mes: choix } = unwrap(
          await requirePont().installer(id, local, origine, origine.type === "bibliotheque" ? def.contenu : null),
        );
        setMes(choix);
        await reload();
        return id;
      },
      appliquer: async (id, partage, origine, forcer = false) => {
        const local = ficheLocale(partage, id, origine.type === "bibliotheque" ? origine.valeurs : {}, metaRef.current[id]?.modele);
        const fiche = filesRef.current.find((f) => f.name === id);
        const { mes: choix } = unwrap(
          await requirePont().appliquer(id, local, origine, partage, fiche?.file.modifiedAt ?? null, forcer),
        );
        setMes(choix);
        await reload();
      },
      changerOrigine: async (id, origine) => {
        setMes(unwrap(await requirePont().changerOrigine(id, origine)));
      },
      definitionRecue: async (id) => unwrap(await requirePont().definitionRecue(id)),
      save: async (id, content, reglage, expectedModifiedAt) => {
        unwrap(await requirePont().write(id, content, expectedModifiedAt));
        await saveMeta(id, reglage);
        await reload();
      },
      saveReglage: async (id, reglage) => {
        await saveMeta(id, reglage);
      },
      changerFournisseur: (id, fournisseur) => saveMeta(id, { fournisseur }),
      preferer: (id, { masque, muet, epingle }) =>
        saveMeta(id, {
          ...(masque !== undefined ? { masque } : {}),
          ...(muet !== undefined ? { muet } : {}),
          ...(epingle !== undefined ? { epingleLe: epingle ? new Date().toISOString() : undefined } : {}),
        }),
      ranger: async (ids) => {
        const next = { ...metaRef.current };
        ids.forEach((id, rang) => {
          next[id] = { ...next[id], rang };
        });
        if (JSON.stringify(next) === JSON.stringify(metaRef.current)) return;
        const avant = metaRef.current;
        // L'ordre change tout de suite à l'écran ; un échec d'écriture le remet comme avant.
        metaRef.current = next;
        setMeta(next);
        const r = await requirePont().writeMeta(next);
        if (!r.ok) {
          metaRef.current = avant;
          setMeta(avant);
        }
        unwrap(r);
      },
      changerModele: async (id, modele) => {
        const fiche = filesRef.current.find((f) => f.name === id);
        if (!fiche) throw new BridgeError("introuvable", `La fiche « ${id} » n’existe plus sur le disque.`);
        const origine = mes?.agents[id]?.origine;
        const partage = origine?.type === "bibliotheque" ? unwrap(await requirePont().definitionRecue(id)) : null;
        if (origine?.type === "bibliotheque" && partage) {
          /* Agent reçu : le modèle est une préférence, la fiche est réécrite depuis la version suivie. */
          await saveMeta(id, { modele });
          const local = ficheLocale(partage, id, origine.valeurs, modele);
          setMes(unwrap(await requirePont().appliquer(id, local, origine, partage, fiche.file.modifiedAt, false)).mes);
        } else {
          const { frontmatter, body } = parseAgentFile(fiche.content);
          unwrap(await requirePont().write(id, serializeAgentFile({ frontmatter: setFields(frontmatter, { model: modele }), body }), fiche.file.modifiedAt));
        }
        await reload();
      },
      create: async (id, content, reglage) => {
        unwrap(await requirePont().create(id, content));
        await saveMeta(id, reglage);
        await reload();
      },
      history: async (id) => unwrap(await requirePont().history(id)),
      readVersion: async (id, versionId) => unwrap(await requirePont().readVersion(id, versionId)),
      reveal: async (id) => unwrap(await requirePont().reveal(id)),
    }),
    [roles, tous, mes, status, error, dir, meta, reload, requirePont, saveMeta, pris, serveurAncien, bridge],
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
