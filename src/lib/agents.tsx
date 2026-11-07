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
   *}"