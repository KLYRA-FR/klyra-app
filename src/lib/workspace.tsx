"use client";

import { DIRECT, dansEspace, idDirect, lieuDeConversation, lieuDeHote, lieuParDefaut, lireIdDirect, retenirLieu, useLieuActif } from "./lieux";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { PRINCIPAL } from "@/data/agents";
import { Bouton } from "@/components/ui/Bouton";
import { createMockWorkspace, type MockWorkspace } from "@/data/mock";
import { AgentsProvider, useAgents } from "@/lib/agents";
import { getBridge, type Acces, type AgentEvent } from "@/lib/bridge";
import { rendezVousEntre } from "@/lib/agenda-equipe";
import { identiteAffichee, type Identite, type ProfilCompte } from "@/lib/identite";
import { libelleEtape } from "@/lib/etapes";
import { planningPourAgents } from "@/lib/planning-agents";
import { prochainPassage } from "@/lib/planning";
import { lienMessage, lienWorkflow, pousserAuTelephone } from "@/lib/push";
import { appelAtelier, atelierEnCours, lireChoix, lireMajAtelier, sansEssaisEnCours } from "@/lib/atelier-agent";
import { appelEquipe, equipeEnCours, lireMajEquipe, OUTIL_EQUIPE_CLAUDE } from "@/lib/atelier-equipe";
import { lireCarte, OUTIL_CARTE_CLAUDE, reponseNette } from "../../electron/cartes-interactives";
import { lireDemandeSecret } from "../../electron/coffre-regles";
import { contexteFil, texteAttente, texteFilOuvert, texteRetourFil } from "../../electron/fils-outils";
import { finTacheDeFond, sansFondOrphelin } from "./passation-fond";
import { noterReponse, poserFond, poserFondParReponse } from "./fond-agents";
import { lirePublication, publierRendu, renduDeLOrigine, renduDepuisServeur, typeDeRendu } from "@/lib/rendus";
import { renduDansEspace } from "@/lib/rendus-espace";
import type { EtatEspace } from "@/lib/espace-sync";
import { useEspaceServeurs } from "@/lib/useEspaceServeurs";
import { reglagesActuels, surReglages } from "@/lib/reglages";
import { useLivraisonRoutines } from "@/lib/routines-livraison";
import { useRoutines } from "@/lib/routines";
import { marquerRappelNotifie, restaurerRappels, supprimerRappel, type RappelSupprime } from "@/lib/suppression-rappels";
import { refusSuppression, sansConversation } from "@/lib/suppression-conversation";
import { jouer, notificationSonore } from "@/lib/sons/sons";
import { skillEnTete } from "@/lib/skills";
import { avecEpingle, basculerEpingle, trierConversations } from "@/lib/epinglage";
import { aReprendre, changerDeMoteur, fournisseur, limiterReprise, moteurDe, moteurDuMessage, PAR_DEFAUT } from "@/lib/fournisseurs";
import { COMMANDE_RESUME_AUTO, estAvantDepart, estCommandeCompacter, formaterJetons, nouvelleMesure, peutRepartir, repartirAZero, resumeAvantEnvoi, resumePause, viderConversation } from "@/lib/contexte";
import { CONFIGURATION_PAR_DEFAUT } from "../../electron/configuration-klyra";
import { apresReponse, auDebut, avecEtapes, briefDuRappel, ferme, ligneTicket, type ChampsTicket, type RappelAConfier, lireEcheance, lireEtatOutil, lirePriorite, peutFermer, peutMettreAJour, poserEtape, rouvert, trierTickets } from "@/lib/tickets";
import { notificationDeFin } from "@/lib/tickets-demandes";
import { libererPlaceFil } from "@/lib/liberer-place-fil";
import { executer, type Outils, type Resultat } from "@/lib/workflows/moteur";
import { creerOutilsWorkflows } from "@/lib/workflows/outils-agents";
import { extraitMarkdown } from "@/lib/apercu/extrait";
import { texteBrut, type Inline } from "@/lib/apercu/markdown";
import type { ExecutionWorkflow, SourceExecution, VersionWorkflow, Workflow } from "@/types/workflows";
import type {
  Artefact,
  Rendu,
  Chat,
  Citation,
  Etape,
  EtapeTicket,
  MajAtelier,
  MajEquipe,
  Message,
  ReponseCarte,
  MessagePart,
  Project,
  Role,
  RelaisRoutine,
  RoleId,
  Routine,
  Tache,
  TacheAgent,
  Evenement,
  Categorie,
  User,
} from "@/types/domain";

/** Une carte de l'atelier, et ce que l'écran peut y noter. */
type PartAtelier = Extract<MessagePart, { type: "atelier-agent" }>;
type PatchAtelier = Partial<Pick<PartAtelier, "teinte" | "cree" | "resultats" | "ajouts" | "essais">>;
/** Une carte de l'atelier d'équipe, et ce que l'écran peut y noter. */
type PartEquipe = Extract<MessagePart, { type: "atelier-equipe" }>;
type PatchEquipe = Partial<Pick<PartEquipe, "teintes" | "ecartes" | "crees" | "choix">>;

/** Les catégories de rappels à la première ouverture. */
const CATEGORIES_DE_DEPART: Categorie[] = [
  { id: "perso", nom: "Perso", teinte: "violet", icone: "home-01" },
  { id: "clients", nom: "Clients", teinte: "bleu-k2", icone: "users-profiles-01" },
  { id: "ecole", nom: "École", teinte: "jaune", icone: "file-01" },
];

/** Les catégories enregistrées. Les anciennes « listes » (de simples noms) laissent place aux catégories de départ ;
 *  un rappel dont la catégorie n'existe plus s'affiche dans la première. */
function lireCategories(brut: unknown): Categorie[] | null {
  if (!Array.isArray(brut) || !brut.length || typeof brut[0] === "string") return null;
  return brut as Categorie[];
}

/** L'ancien artefact de départ (le design system KLYRA), mis d'office sur chaque poste jusqu'à la bibliothèque
 *  de l'équipe : ce n'était pas un artefact de la personne. Retiré au chargement ; il se partage désormais. */
const ANCIEN_ARTEFACT_DE_DEPART = "design-system-klyra";

/**
 * État de l'espace de travail : projets, conversations, messages.
 * Dans l'app de bureau, les agents répondent pour de vrai (Claude Code, cf.
 * electron/claude.ts) et les conversations sont gardées sur le disque. Dans
 * un navigateur, l'app montre des conversations d'exemple et simule les
 * réponses.
 */

/** Un agent au travail dans une conversation. */
export interface Travail {
  roleId: RoleId;
  messageId: string;
  debut: number;
  /** Tokens écrits depuis le début, estimés en direct : la preuve que l'agent avance. */
  jetons?: number;
}

/** Un message envoyé pendant que l'agent travaille : il part dès qu'il a fini. */
export interface EnAttente {
  id: string;
  text: string;
  to: RoleId | null;
  fichiers: string[];
  /** « Répondre » à un message d'agent : il repart avec le message. */
  citation?: Citation;
  /** Une exécution de routine qui attend son tour (cf. `useLivraisonRoutines`). */
  routineRun?: string;
}

interface WorkspaceState extends MockWorkspace {
  /** Faux tant que les conversations ne sont pas lues sur le disque. */
  charge: boolean;
  travail: Record<string, Travail>;
  file: Record<string, EnAttente[]>;
  routines: Routine[];
  artefacts: Artefact[];
  /** Les fichiers publiés par les agents (outil `publier_artefact`, cf. `src/lib/rendus.ts`). */
  rendus: Rendu[];
  /** Les artefacts claude.ai dans l'écran Artefacts : une source facultative, pour qui s'en sert. */
  artefactsClaude: boolean;
  /** Ce que les agents de ce PC peuvent faire sans demander. */
  acces: Acces;
  /** La même chose, pour chaque VPS où on l'a choisi. Sinon, le choix de ce PC. */
  accesParServeur: Record<string, Acces>;
  taches: Tache[];
  /** Annulation temporaire, jamais écrite sur le disque. */
  rappelsSupprimes: RappelSupprime[];
  evenements: Evenement[];
  /** Les catégories de rappels, dans l'ordre des colonnes. */
  categories: Categorie[];
  workflows: Workflow[];
  /** Les exécutions des workflows, les plus récentes d'abord. */
  executions: ExecutionWorkflow[];
  /** Le profil du compte d'équipe connecté (cf. `src/lib/identite.ts`). En mémoire seulement : jamais écrit sur le disque. */
  profilCompte: ProfilCompte | null;
  /** Événements du compte, occurrences déjà développées. null : pas encore reçus. Jamais écrits sur le disque. */
  evenementsCompte: Evenement[] | null;
}

/** Liste explicite : les états transitoires (dont Annuler) ne quittent jamais la mémoire. */
function conversationsAEnregistrer(etat: WorkspaceState) {
  return {
    version: VERSION_STOCKAGE, chats: etat.chats, messages: etat.messages,
    routines: etat.routines, artefacts: etat.artefacts, rendus: etat.rendus, artefactsClaude: etat.artefactsClaude, projects: etat.projects,
    currentUser: etat.currentUser, acces: etat.acces, accesParServeur: etat.accesParServeur, taches: etat.taches,
    evenements: etat.evenements, categories: etat.categories,
    workflows: etat.workflows, executions: etat.executions,
  };
}

type WorkspaceAction =
  | {
      type: "charger";
      chats: Chat[];
      messages: Message[];
      routines: Routine[];
      artefacts: Artefact[];
      rendus: Rendu[];
      artefactsClaude: boolean;
      projects: Project[];
      currentUser: User | null;
      acces: Acces | null;
      accesParServeur: Record<string, Acces> | null;
      taches: Tache[];
      evenements: Evenement[];
      categories: Categorie[] | null;
      workflows: Workflow[];
      executions: ExecutionWorkflow[];
    }
  | { type: "tache/enregistrer"; tache: Tache }
  | { type: "tache/supprimer"; id: string }
  | { type: "tache/restaurer" }
  | { type: "tache/oublierSuppressions" }
  | { type: "tache/notifiee"; id: string }
  | { type: "evenement/enregistrer"; evenement: Evenement }
  | { type: "evenement/supprimer"; id: string }
  | { type: "categories/changer"; categories: Categorie[] }
  | { type: "acces/choisir"; acces: Acces; lieu: string | null }
  | { type: "espace/fusion"; etat: EtatEspace }
  | { type: "projet/enregistrer"; project: Project }
  | { type: "projet/supprimer"; id: string }
  | { type: "profil/enregistrer"; user: User }
  | { type: "profil/modifier"; patch: Partial<User> }
  | { type: "compte/profil"; profil: ProfilCompte | null }
  | { type: "compte/evenements"; evenements: Evenement[] | null }
  | { type: "routine/enregistrer"; routine: Routine }
  | { type: "routine/supprimer"; id: string }
  | { type: "artefact/ajouter"; artefact: Artefact }
  | { type: "artefact/supprimer"; id: string }
  | { type: "artefact/modifier"; id: string; patch: Partial<Artefact> }
  | { type: "artefact/synchroniser"; liste: { titre: string; url: string; misAJour: string | null }[] }
  | { type: "artefacts-claude/choisir"; actif: boolean }
  | { type: "rendu/publier"; rendu: Rendu }
  | { type: "rendu/retirer"; id: string }
  | { type: "chat/add"; chat: Chat }
  | { type: "chat/update"; id: string; patch: (chat: Chat) => Chat }
  | { type: "chat/vider"; id: string; le: string }
  | { type: "chat/supprimer"; id: string }
  | { type: "chat/repartir"; id: string; le: string }
  | { type: "message/add"; message: Message }
  | { type: "message/update"; id: string; patch: (message: Message) => Message }
  | { type: "travail/debut"; chatId: string; travail: Travail }
  | { type: "travail/fin"; chatId: string; messageId?: string }
  | { type: "travail/jetons"; chatId: string; total: number }
  | { type: "file/ajouter"; chatId: string; message: EnAttente }
  | { type: "file/retirer"; chatId: string; id: string }
  | { type: "workflow/enregistrer"; workflow: Workflow }
  | { type: "workflow/supprimer"; id: string }
  | { type: "execution/enregistrer"; execution: ExecutionWorkflow };

/** Les exécutions gardées par workflow. */
const EXECUTIONS_GARDEES = 30;

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "charger":
      return {
        ...state,
        // Les fils d'avant les tickets reçoivent leur étape (src/lib/tickets.ts).
        chats: avecEtapes(action.chats, action.messages),
        messages: action.messages,
        routines: action.routines,
        artefacts: action.artefacts,
        rendus: action.rendus,
        artefactsClaude: action.artefactsClaude,
        projects: action.projects,
        currentUser: action.currentUser ?? state.currentUser,
        acces: action.acces ?? state.acces,
        accesParServeur: action.accesParServeur ?? state.accesParServeur,
        taches: action.taches,
        evenements: action.evenements,
        categories: action.categories ?? state.categories,
        workflows: action.workflows,
        executions: action.executions,
        charge: true,
      };
    case "workflow/enregistrer": {
      const existe = state.workflows.some((w) => w.id === action.workflow.id);
      return {
        ...state,
        workflows: existe
          ? state.workflows.map((w) => (w.id === action.workflow.id ? action.workflow : w))
          : [...state.workflows, action.workflow],
      };
    }
    case "workflow/supprimer":
      return {
        ...state,
        workflows: state.workflows.filter((w) => w.id !== action.id),
        executions: state.executions.filter((e) => e.workflowId !== action.id),
      };
    case "execution/enregistrer": {
      const e = action.execution;
      const autres = state.executions.filter((x) => x.id !== e.id);
      const memes = autres.filter((x) => x.workflowId === e.workflowId).slice(0, EXECUTIONS_GARDEES - 1);
      return {
        ...state,
        executions: [e, ...autres.filter((x) => x.workflowId !== e.workflowId), ...memes].sort((a, b) =>
          b.debut.localeCompare(a.debut),
        ),
      };
    }
    case "tache/enregistrer": {
      const existe = state.taches.some((t) => t.id === action.tache.id);
      return {
        ...state,
        taches: existe ? state.taches.map((t) => (t.id === action.tache.id ? action.tache : t)) : [...state.taches, action.tache],
      };
    }
    case "tache/supprimer":
      return supprimerRappel(state, action.id);
    case "tache/restaurer":
      return restaurerRappels(state);
    case "tache/oublierSuppressions":
      return { ...state, rappelsSupprimes: [] };
    case "tache/notifiee":
      return marquerRappelNotifie(state, action.id);
    case "evenement/enregistrer": {
      const existe = state.evenements.some((e) => e.id === action.evenement.id);
      return {
        ...state,
        evenements: existe
          ? state.evenements.map((e) => (e.id === action.evenement.id ? action.evenement : e))
          : [...state.evenements, action.evenement],
      };
    }
    case "evenement/supprimer":
      return { ...state, evenements: state.evenements.filter((e) => e.id !== action.id) };
    case "categories/changer":
      return { ...state, categories: action.categories };
    case "espace/fusion":
      return { ...state, ...action.etat };
    case "acces/choisir":
      return action.lieu ? { ...state, accesParServeur: { ...state.accesParServeur, [action.lieu]: action.acces } } : { ...state, acces: action.acces };
    case "projet/enregistrer": {
      const existe = state.projects.some((p) => p.id === action.project.id);
      return {
        ...state,
        projects: existe
          ? state.projects.map((p) => (p.id === action.project.id ? action.project : p))
          : [...state.projects, action.project],
      };
    }
    case "projet/supprimer":
      return { ...state, projects: state.projects.filter((p) => p.id !== action.id) };
    case "profil/enregistrer":
      return { ...state, currentUser: action.user };
    case "profil/modifier":
      return { ...state, currentUser: { ...state.currentUser, ...action.patch } };
    case "compte/profil":
      return { ...state, profilCompte: action.profil, evenementsCompte: action.profil ? state.evenementsCompte : null };
    case "compte/evenements":
      return { ...state, evenementsCompte: action.evenements };
    case "routine/enregistrer": {
      const existe = state.routines.some((r) => r.id === action.routine.id);
      return {
        ...state,
        routines: existe
          ? state.routines.map((r) => (r.id === action.routine.id ? action.routine : r))
          : [...state.routines, action.routine],
      };
    }
    case "routine/supprimer":
      return { ...state, routines: state.routines.filter((r) => r.id !== action.id) };
    case "artefacts-claude/choisir":
      return { ...state, artefactsClaude: action.actif };
    case "rendu/publier":
      return { ...state, rendus: publierRendu(state.rendus, action.rendu) };
    case "rendu/retirer":
      return { ...state, rendus: state.rendus.filter((r) => r.id !== action.id) };
    case "artefact/ajouter":
      return { ...state, artefacts: [action.artefact, ...state.artefacts] };
    case "artefact/supprimer":
      return { ...state, artefacts: state.artefacts.filter((a) => a.id !== action.id) };
    case "artefact/modifier":
      return { ...state, artefacts: state.artefacts.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)) };
    case "artefact/synchroniser": {
      // Par lien : on met à jour ceux qu'on a déjà (sans écraser un titre changé dans l'app), on ajoute les nouveaux.
      const cle = (url: string) => url.replace(/\/$/, "");
      const parUrl = new Map(state.artefacts.map((a) => [cle(a.url), a]));
      const maintenant = new Date().toISOString();
      const nouveaux: Artefact[] = [];
      for (const x of action.liste) {
        const avant = parUrl.get(cle(x.url));
        if (avant) {
          parUrl.set(cle(x.url), {
            ...avant,
            titre: avant.titrePerso ? avant.titre : x.titre,
            misAJour: x.misAJour ?? avant.misAJour ?? null,
            source: avant.source ?? "claude",
          });
        } else {
          nouveaux.push({
            id: crypto.randomUUID(),
            titre: x.titre,
            url: x.url,
            description: "",
            projectId: null,
            ajouteLe: maintenant,
            source: "claude",
            misAJour: x.misAJour,
          });
        }
      }
      return { ...state, artefacts: [...nouveaux, ...state.artefacts.map((a) => parUrl.get(cle(a.url)) ?? a)] };
    }
    case "chat/add":
      if (state.chats.some((c) => c.id === action.chat.id)) return state;
      return { ...state, chats: [action.chat, ...state.chats] };
    case "chat/update":
      return {
        ...state,
        chats: state.chats.map((c) => (c.id === action.id ? action.patch(c) : c)),
      };
    case "message/add": {
      const { message } = action;
      return {
        ...state,
        messages: [...(message.routineRun ? state.messages.filter((m) => m.id !== message.id) : state.messages), message],
        chats: state.chats.map((chat) =>
          chat.id === message.chatId ? { ...chat, updatedAt: message.createdAt } : chat,
        ),
      };
    }
    case "chat/vider":
      return {
        ...state,
        messages: state.messages.filter((m) => m.chatId !== action.id),
        chats: state.chats.map((c) => (c.id === action.id ? viderConversation(c, action.le) : c)),
      };
    case "chat/supprimer":
      return sansConversation(state, action.id);
    case "chat/repartir":
      return { ...state, chats: state.chats.map((c) => (c.id === action.id ? repartirAZero(c, action.le) : c)) };
    case "message/update":
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? action.patch(m) : m)),
      };
    case "travail/debut":
      return {
        ...state,
        travail: { ...state.travail, [action.chatId]: action.travail },
        // Une réponse commence dans un fil : son ticket passe « en cours ».
        chats: state.chats.some((c) => c.id === action.chatId && c.fil)
          ? state.chats.map((c) => (c.id === action.chatId && c.fil ? { ...c, fil: auDebut(c.fil) } : c))
          : state.chats,
      };
    case "travail/jetons": {
      const t = state.travail[action.chatId];
      if (!t) return state;
      return { ...state, travail: { ...state.travail, [action.chatId]: { ...t, jetons: action.total } } };
    }
    case "travail/fin": {
      if (action.messageId && state.travail[action.chatId]?.messageId !== action.messageId) return state;
      const travail = { ...state.travail };
      delete travail[action.chatId];
      return { ...state, travail };
    }
    case "file/ajouter":
      return {
        ...state,
        file: {
          ...state.file,
          [action.chatId]: [...(state.file[action.chatId] ?? []), action.message],
        },
      };
    case "file/retirer":
      return {
        ...state,
        file: {
          ...state.file,
          [action.chatId]: (state.file[action.chatId] ?? []).filter((m) => m.id !== action.id),
        },
      };
  }
}

/* ─── Construction des messages d'un agent ─────────────────────── */

/** Ajoute un morceau de texte à la réponse : à la suite du dernier texte, ou dans un nouveau bloc. */
/** Le compte Claude que la conversation demande, seulement quand c'est Claude Code qui répond. */
function compteDe(chat: Chat | undefined, moteur: string): { compteClaude?: string } {
  return moteur === PAR_DEFAUT && chat?.compteClaude ? { compteClaude: chat.compteClaude } : {};
}

function ajouterTexte(parts: MessagePart[], delta: string, nouveauBloc: boolean): MessagePart[] {
  const dernier = parts[parts.length - 1];
  if (dernier?.type === "text" && !nouveauBloc) {
    return [...parts.slice(0, -1), { type: "text", text: dernier.text + delta }];
  }
  return [...parts, { type: "text", text: delta }];
}

/** Outils par lesquels un agent confie une partie du travail à un collègue. */
const OUTILS_PASSATION = new Set(["Agent", "Task"]);

function ajouterEtape(
  parts: MessagePart[],
  etape: Etape,
  roles: Role[],
  entree: Record<string, unknown>,
): MessagePart[] {
  const sousAgent = typeof entree.subagent_type === "string" ? entree.subagent_type : null;
  if (OUTILS_PASSATION.has(etape.outil) && sousAgent && roles.some((r) => r.id === sousAgent)) {
    const consigne = typeof entree.description === "string" ? entree.description : "";
    return [
      ...parts,
      {
        type: "passation",
        etapeId: etape.id,
        roleId: sousAgent,
        consigne,
        statut: "en-cours",
        ...(entree.run_in_background === true ? { fond: true } : {}),
      },
    ];
  }
  // L'atelier d'un agent : la carte se complète dans le fil (cf. atelier-agent.ts), après ses étapes.
  const maj = etape.outil === "mcp__klyra__proposer_agent" ? lireMajAtelier(entree) : null;
  if (maj) return poserAtelier(parts, etape.id, maj, false);
  // L'atelier d'une équipe : la carte d'équipe se complète de même (cf. atelier-equipe.ts).
  const majEquipe = etape.outil === OUTIL_EQUIPE_CLAUDE ? lireMajEquipe(entree) : null;
  if (majEquipe) return poserEquipe(parts, etape.id, majEquipe, false);
  // Une carte interactive : la personne la remplit sous la réponse (cf. cartes-interactives.ts).
  const carte = etape.outil === OUTIL_CARTE_CLAUDE ? lireCarte(entree) : null;
  if (carte && "carte" in carte) return poserCarte(parts, etape.id, carte.carte, false);
  // Des réponses toutes prêtes sous la question de l'assistant.
  const choix = etape.outil === "mcp__klyra__proposer_choix" ? lireChoix(entree) : null;
  if (choix) return [...parts, { type: "choix", etapeId: etape.id, ...choix }];
  // Un secret demandé par l'agent : la carte sécurisée où la personne le colle (cf. CarteCoffre).
  const demande = etape.outil === "mcp__klyra__coffre_demander" ? lireDemandeSecret(entree) : null;
  if (demande) return [...parts, { type: "coffre-demande", etapeId: etape.id, ...demande }];
  // Toutes les étapes de la réponse vivent dans un seul bloc, en tête du message.
  const index = parts.findIndex((p) => p.type === "etapes");
  if (index === -1) return [{ type: "etapes", etapes: [etape] }, ...parts];
  return parts.map((p, i) => (i === index && p.type === "etapes" ? { ...p, etapes: [...p.etapes, etape] } : p));
}

/**
 * La carte de l'atelier pour cet appel : ajoutée, ou mise à jour si elle s'écrivait déjà en direct
 * (`provisoire`, cf. l'événement `etape-partielle`). Ce que la personne y a déjà fait reste.
 */
function poserAtelier(parts: MessagePart[], etapeId: string, maj: MajAtelier, provisoire: boolean): MessagePart[] {
  const i = parts.findIndex((p) => p.type === "atelier-agent" && p.etapeId === etapeId);
  if (i === -1) return [...parts, { type: "atelier-agent", etapeId, maj, ...(provisoire ? { provisoire } : {}) }];
  return parts.map((p, j) => {
    if (j !== i || p.type !== "atelier-agent") return p;
    const { provisoire: _ancien, ...reste } = p;
    void _ancien;
    return { ...reste, maj, ...(provisoire ? { provisoire } : {}) };
  });
}

/** La carte d'équipe pour cet appel : ajoutée, ou mise à jour si elle s'écrivait déjà en direct. */
function poserEquipe(parts: MessagePart[], etapeId: string, maj: MajEquipe, provisoire: boolean): MessagePart[] {
  const i = parts.findIndex((p) => p.type === "atelier-equipe" && p.etapeId === etapeId);
  if (i === -1) return [...parts, { type: "atelier-equipe", etapeId, maj, ...(provisoire ? { provisoire } : {}) }];
  return parts.map((p, j) => {
    if (j !== i || p.type !== "atelier-equipe") return p;
    const { provisoire: _ancien, ...reste } = p;
    void _ancien;
    return { ...reste, maj, ...(provisoire ? { provisoire } : {}) };
  });
}

/** La carte interactive de cet appel : ajoutée, ou remplacée si elle s'écrivait déjà en direct. */
function poserCarte(parts: MessagePart[], etapeId: string, carte: Extract<MessagePart, { type: "carte" }>["carte"], provisoire: boolean): MessagePart[] {
  const i = parts.findIndex((p) => p.type === "carte" && p.etapeId === etapeId);
  const part: MessagePart = { type: "carte", etapeId, carte, ...(provisoire ? { provisoire } : {}) };
  return i === -1 ? [...parts, part] : parts.map((p, j) => (j === i ? part : p));
}

function finirEtape(parts: MessagePart[], id: string, ok: boolean): MessagePart[] {
  const statut = ok ? "fait" : "erreur";
  // Une carte ou des réponses refusées par l'app (prénom déjà pris…) ne restent pas dans le fil.
  const gardees = ok ? parts : parts.filter((p) => !((p.type === "proposition-agent" || p.type === "atelier-agent" || p.type === "atelier-equipe" || p.type === "carte" || p.type === "choix" || p.type === "coffre-demande") && p.etapeId === id));
  return gardees.map((p) => {
    // Lancé en arrière-plan : l'appel répond « lancé » tout de suite ; la passation attend le retour de l'agent (`tache-fond`).
    if (p.type === "passation" && p.etapeId === id) return p.fond && ok ? p : { ...p, statut };
    if (p.type === "etapes")
      return {
        ...p,
        etapes: p.etapes.map((e) => (e.id === id ? { ...e, statut } : e)),
      };
    return p;
  });
}

/** La liste de tâches envoyée par l'outil TodoWrite. */
function lireTaches(entree: Record<string, unknown>): TacheAgent[] | null {
  if (!Array.isArray(entree.todos)) return null;
  return entree.todos
    .map((t: { content?: unknown; status?: unknown }) => ({
      texte: typeof t.content === "string" ? t.content : "",
      statut: t.status === "completed" ? "fait" : t.status === "in_progress" ? "en-cours" : "a-faire",
    }))
    .filter((t): t is TacheAgent => !!t.texte);
}

/** Le texte d'un message, pour le contexte donné à un agent et les aperçus. */
export function texteDe(message: Message): string {
  return message.parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

/* Réponses simulées, dans un navigateur (sans l'app de bureau). */
const SIMULATED_REPLIES: Record<string, string> = {
  principal: "Bien reçu. Je regarde qui s’en occupe et je reviens vers toi ici.",
  dev: "Je m’en occupe. Je te montre le résultat sur l’aperçu dès que c’est prêt.",
  designer: "Ok, je te prépare la spec avec deux options et je la poste ici.",
  motion: "Je commence par le storyboard, je te le montre avant d’animer.",
  qa: "Envoie-moi le hash du commit et les points à vérifier, je contrôle.",
  commercial: "Je regarde la grille et je te prépare une proposition chiffrée.",
  stratege: "Je te fais un brief d’une page : cible, message, métrique.",
  growth: "J’écris l’expérience avant de lancer : hypothèse, seuil, budget.",
  redacteur: "Je te propose trois accroches, tu choisis, puis j’écris.",
  val: "Je trie et je te prépare le brouillon. Rien ne part sans ta validation.",
  "diego-discord-ops": "Je prépare le plan et un dry-run, je te montre avant d’appliquer.",
  prompty: "Je lis la doc du modèle et je te rends un prompt avec son critère de réussite.",
};

/** Les façons de refaire une réponse, depuis le menu sous le message. */
/** Options d'un fil : l'id imposé (créé depuis le téléphone) et la machine où il tourne (`null` : ce PC). */
export type OptionsFil = { id?: string; lieu?: string | null };

export type FaconReessai = "reessayer" | "details" | "concis" | "web";

export { DIRECT, idDirect };

/** Les fils d'un agent : `klyra-fil-…`, l'identifiant qu'on cite. */
export const FIL = "klyra-fil-";

/** Une conversation avec un agent : son chat principal ou un de ses fils. */
export function estConversationAgent(id: string | null | undefined): boolean {
  return !!id && (id.startsWith(DIRECT) || id.startsWith(FIL));
}

/** Titre d'un fil tant qu'il n'a pas de premier message. */
export const FIL_SANS_TITRE = "Nouveau fil";

/** Titre provisoire d'un chat : le début du premier message, en attendant celui de l'IA (`titrer`). */
function chatTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
}

/**
 * Une notification du système qui prévient à coup sûr (rappel à son heure,
 * rendez-vous, accord attendu). Le son : celui du système si le réglage
 * « Son » est actif, sinon celui de KLYRA ; jamais les deux.
 */
export function notifierRappel(titre: string, corps: string, encoreValide?: () => boolean) {
  void reglagesActuels().then(({ notifications: n }) => {
    if (encoreValide && !encoreValide()) return;
    const systeme = typeof Notification !== "undefined";
    if (systeme) new Notification(titre, { body: corps, silent: !n.son });
    if (!systeme || !n.son) jouer("notification");
  });
}

const VERSION_STOCKAGE = 1;

interface WorkspaceApi {
  state: WorkspaceState;
  /** Envoie un message ; sans destinataire, c'est le Principal (ou l'agent de la conversation directe) qui répond. */
  sendMessage: (chatId: string, text: string, to: RoleId | null, fichiers?: string[], citation?: Citation) => void;
  /** Ajoute ou retire ta réaction (un émoji) à un message. */
  reagir: (messageId: string, emoji: string) => void;
  /** Modèle et effort de la conversation (null : ceux de la fiche de l'agent). */
  choisirModele: (chatId: string, modele: string | null, effort: string | null) => void;
  /** Le compte Claude de la conversation (id d'un compte supplémentaire), ou null : le compte des agents. */
  choisirCompteClaude: (chatId: string, compte: string | null) => void;
  /** « Plus tard » sur le conseil de résumer : il revient quand la conversation dépasse `jusqua` jetons. */
  masquerConseilContexte: (chatId: string, jusqua: number) => void;
  choisirFournisseur: (chatId: string, moteur: string, modele: string | null, effort: string | null) => void;
  /** Le sélecteur de serveur : l'espace affiché (null : ce PC). Aucune conversation ne change de machine. */
  basculerMachine: (lieu: string | null) => void;
  /** Repart de zéro avec l'agent : les messages et sa mémoire de cette conversation sont effacés. */
  nouvelleConversation: (chatId: string) => void;
  /** L'agent oublie la conversation ; ses messages restent lisibles (cf. lib/contexte.ts). */
  repartir: (chatId: string) => void;
  /** Ouvre une conversation d'équipe dans un projet avec ce premier message ; renvoie son id (`id` : celui choisi sur le téléphone). */
  startChat: (projectId: string, text: string, to: RoleId | null, fichiers?: string[], id?: string) => string;
  reessayer: (chatId: string, messageId: string, facon: FaconReessai, modele?: string) => void;
  brancher: (chatId: string, messageId: string) => string | null;
  /** Arrête l'agent qui travaille dans cette conversation. */
  arreter: (chatId: string) => void;
  /** Ouvre un fil (une tâche) dans le chat de l'agent ; renvoie son id (`id` : celui choisi sur le téléphone). */
  /**
   * Ouvre un fil de l'agent. Son lieu : `options.lieu` s'il est donné (la conversation d'où il part),
   * sinon celui de la conversation qui l'a lancé, sinon la machine affichée.
   */
  creerFil: (roleId: RoleId, titre?: string, lancePar?: { roleId: RoleId; chatId: string } | null, ticket?: ChampsTicket, options?: OptionsFil) => string;
  /** Confie un rappel à un agent : un fil s'ouvre avec le rappel pour brief ; renvoie son id. */
  confierRappel: (rappel: RappelAConfier, roleId: RoleId, idImpose?: string) => string;
  /** Change le ticket d'un fil : étape (posée exprès), raison, priorité, échéance, projet. */
  majTicket: (chatId: string, patch: ChampsTicket & { etape?: EtapeTicket; raison?: string | null }) => void;
  renommerChat: (chatId: string, titre: string) => void;
  epinglerChat: (chatId: string, epingler: boolean) => void;
  /**
   * Supprime une conversation d'équipe et ses messages (cf. `suppression-conversation.ts`). Renvoie la raison
   * d'un refus (fil, conversation directe, agent au travail), ou null si elle est supprimée.
   */
  supprimerConversation: (chatId: string) => string | null;
  /** Ferme un fil : il s'arrête et part dans les archivés (« supprimé » : caché des archivés). Rien n'est effacé. */
  archiverFil: (chatId: string, supprime?: boolean) => void;
  rouvrirFil: (chatId: string) => void;
  retirerDeLaFile: (chatId: string, id: string) => void;
  marquerLu: (chatId: string) => void;
  /** Crée ou modifie une tâche planifiée. */
  enregistrerRoutine: (routine: Routine) => void;
  supprimerRoutine: (id: string) => void;
  /** Lance une tâche planifiée tout de suite, sans attendre son heure. */
  lancerRoutine: (id: string) => void;
  ajouterArtefact: (artefact: Omit<Artefact, "id" | "ajouteLe">) => void;
  modifierArtefact: (id: string, patch: Partial<Artefact>) => void;
  /** Lit la galerie claude.ai et met la liste à jour ; renvoie combien sont arrivés. */
  synchroniserArtefacts: () => Promise<{ total: number; nouveaux: number }>;
  /** Crée ou modifie un projet (le dossier reste où il est sur le disque). */
  enregistrerProjet: (project: Project) => void;
  /** Retire un projet de l'app ; son dossier et ses conversations restent. */
  retirerProjet: (id: string) => void;
  enregistrerProfil: (user: User) => void;
  /** Change une partie du profil de cet ordinateur ; le reste (photo…) ne bouge pas. */
  modifierProfil: (patch: Partial<User>) => void;
  /** Le compte d'équipe connecté (ou null) : posé par `CompteProvider`, gardé en mémoire seulement. */
  appliquerProfilCompte: (profil: ProfilCompte | null) => void;
  /** Les événements du compte (ou null en se déconnectant). En mémoire seulement. */
  poserEvenementsCompte: (evenements: Evenement[] | null) => void;
  /** Qui tu es dans l'app, selon les règles de `src/lib/identite.ts`. */
  moi: Identite;
  /** L'accès des agents d'un serveur (absent : ce PC). */
  choisirAcces: (acces: Acces, lieu?: string | null) => void;
  /** Où tournent les workflows d'un serveur : sur lui, dans cette app (serveur pas à jour), ou pas encore su. */
  moteurDuServeur: (lieu: string) => "serveur" | "app" | "inconnu";
  enregistrerTache: (tache: Tache) => void;
  supprimerTache: (id: string) => void;
  restaurerTaches: () => RappelSupprime[];
  oublierSuppressions: () => void;
  enregistrerEvenement: (evenement: Evenement) => void;
  supprimerEvenement: (id: string) => void;
  changerCategories: (categories: Categorie[]) => void;
  /** Ta réponse à une demande d'autorisation d'un agent. */
  repondreAutorisation: (messageId: string, demandeId: string, decision: "oui" | "toujours" | "non") => void;
  /** La carte de l'atelier d'un agent : la couleur choisie, l'épreuve, les ajouts, puis l'agent créé depuis elle. */
  marquerAtelier: (messageId: string, etapeId: string, patch: PatchAtelier | ((part: PartAtelier) => PatchAtelier)) => void;
  /** La carte de l'atelier d'une équipe : les couleurs, les membres laissés de côté, puis les agents créés depuis elle. */
  marquerEquipe: (messageId: string, etapeId: string, patch: PatchEquipe | ((part: PartEquipe) => PatchEquipe)) => void;
  /** Ce que la personne a envoyé depuis une carte interactive, noté sur la carte (le message part à côté). */
  repondreCarte: (messageId: string, etapeId: string, reponse: ReponseCarte) => void;
  /** La réponse de la personne à une demande de secret (carte du Coffre) : jamais la valeur. */
  repondreCoffre: (messageId: string, etapeId: string, etat: "rangee" | "permise" | "refusee") => void;
  supprimerArtefact: (id: string) => void;
  /** Retire un rendu d'agent de la liste et supprime la copie de l'app ; l'original reste où il est. */
  retirerRendu: (id: string) => void;
  /** Montrer (ou non) les artefacts claude.ai dans l'écran Artefacts. */
  choisirArtefactsClaude: (actif: boolean) => void;
  /** Crée ou modifie un workflow ; une version auto est gardée toutes les 5 min d'édition. */
  enregistrerWorkflow: (workflow: Workflow) => void;
  supprimerWorkflow: (id: string) => void;
  /** Lance un workflow (depuis un déclencheur, ou tout), ou une seule étape ; renvoie l'id de l'exécution. */
  lancerWorkflow: (
    id: string,
    options?: { declencheurId?: string | null; source?: SourceExecution; charge?: string; seule?: string },
  ) => string | null;
  arreterExecution: (id: string) => void;
  /** Ta décision sur une étape d'approbation. */
  deciderApprobation: (etapeId: string, approuver: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

function WorkspaceStore({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const { toutes: routinesLocales, actif: moteurRoutines } = useRoutines();
  const { roles, status: statutAgents, meta: metaAgents } = useAgents();
  const [state, dispatch] = useReducer(reducer, undefined, (): WorkspaceState => {
    const mock = createMockWorkspace();
    // App de bureau : de vraies conversations, lues sur le disque juste après.
    return bridge
      ? {
          ...mock,
          chats: [],
          messages: [],
          // Les projets et le profil de chacun sont sur son poste, lus juste après.
          projects: [],
          currentUser: { id: "moi", name: "", title: "", initial: "" },
          charge: false,
          travail: {},
          file: {},
          routines: [],
          artefacts: [],
          rendus: [],
          artefactsClaude: false,
          acces: "projet",
          accesParServeur: {},
          taches: [],
          rappelsSupprimes: [],
          evenements: [],
          categories: CATEGORIES_DE_DEPART,
          workflows: [],
          executions: [],
          profilCompte: null,
          evenementsCompte: null,
        }
      : {
          ...mock,
          charge: true,
          travail: {},
          file: {},
          routines: [],
          artefacts: [],
          rendus: [],
          artefactsClaude: false,
          acces: "projet",
          accesParServeur: {},
          taches: [],
          rappelsSupprimes: [],
          evenements: [],
          categories: CATEGORIES_DE_DEPART,
          workflows: [],
          executions: [],
          profilCompte: null,
          evenementsCompte: null,
        };
  });

  /** Qui tu es : le compte d'équipe connecté, sinon le profil de cet ordinateur. */
  const moi = useMemo(() => identiteAffichee(state.currentUser, state.profilCompte), [state.currentUser, state.profilCompte]);

  /* Les fonctions ci-dessous lisent toujours l'état le plus récent. */
  const stateRef = useRef(state);
  const ecritureRegroupee = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rolesRef = useRef(roles);
  const metaAgentsRef = useRef(metaAgents);
  /* Dès la fin du rendu, avant tout autre événement : un rendu fini juste avant un appel d'outil (IPC) ne
     doit pas écraser, en passant après lui, ce que cet appel vient d'y poser (la conversation d'un workflow). */
  useLayoutEffect(() => {
    stateRef.current = state;
    rolesRef.current = roles;
    metaAgentsRef.current = metaAgents;
  });
  const ecouteurs = useRef(new Map<string, (event: AgentEvent) => void>());
  /* Les outils des workflows pour les agents (cf. workflows/outils-agents.ts) : ils lisent l'état le plus
     récent ; le lancement est branché plus bas, une fois défini. */
  const lancerWorkflowRef = useRef<(id: string, o: { declencheurId?: string | null; source?: SourceExecution; charge?: string; lancePar?: { roleId: string; chatId: string } }) => string | null>(() => null);
  const outilsWorkflowsRef = useRef<ReturnType<typeof creerOutilsWorkflows> | null>(null);
  const outilsWorkflows = useCallback(
    () =>
      (outilsWorkflowsRef.current ??= creerOutilsWorkflows({
        /* Un agent ne voit que les workflows et les projets du serveur où il travaille. */
        etat: (a) => {
          const { chats, workflows, executions, projects } = stateRef.current;
          const lieu = lieuDeConversation(chats, a.chatId);
          const ici = workflows.filter((w) => dansEspace(w.lieu, lieu));
          const ids = new Set(ici.map((w) => w.id));
          return { workflows: ici, executions: executions.filter((e) => ids.has(e.workflowId)), projets: projects.filter((p) => dansEspace(p.lieu, lieu)) };
        },
        lieu: (a) => lieuDeConversation(stateRef.current.chats, a.chatId),
        agents: () => rolesRef.current.map((r) => ({ id: r.id, nom: r.name })),
        enregistrer: (workflow) => {
          dispatch({ type: "workflow/enregistrer", workflow });
          const { workflows } = stateRef.current;
          stateRef.current = {
            ...stateRef.current,
            workflows: workflows.some((w) => w.id === workflow.id) ? workflows.map((w) => (w.id === workflow.id ? workflow : w)) : [...workflows, workflow],
          };
        },
        lancer: (id, o) => lancerWorkflowRef.current(id, o),
      })),
    [],
  );
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const notifiesEquipe = useRef(new Set<string>());

  /* Lecture des conversations gardées sur le disque. */
  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    void bridge.conversations.read().then((reponse) => {
      if (!actif) return;
      if (!reponse.ok) { setErreurChargement(reponse.message); return; }
      const data = reponse.ok
        ? (reponse.data as {
            version?: number;
            chats?: Chat[];
            messages?: Message[];
            routines?: Routine[];
            artefacts?: Artefact[];
            rendus?: Rendu[];
            artefactsClaude?: boolean;
            projects?: Project[];
            currentUser?: User;
            acces?: Acces;
            accesParServeur?: Record<string, Acces>;
            taches?: Tache[];
            evenements?: Evenement[];
            listes?: string[];
            categories?: Categorie[];
            workflows?: Workflow[];
            executions?: ExecutionWorkflow[];
          } | null)
        : null;
      const valide = data?.version === VERSION_STOCKAGE;
      if (data !== null && !valide) { setErreurChargement("Le format des conversations n’est pas reconnu. Les données existantes sont conservées."); return; }
      const surUnVps = new Set((valide ? (data.chats ?? []) : []).filter((c) => c.lieu).map((c) => c.id));
      const messages = (valide ? (data.messages ?? []) : []).map((m) =>
        // Une réponse coupée par la fermeture de l'app ne reprendra pas, ni un essai de l'épreuve d'un agent.
        sansFondOrphelin(
          sansEssaisEnCours(
            m.statut === "en-cours"
              ? {
                  ...m,
                  statut: "erreur" as const,
                  erreur: "Interrompu : l’app a été fermée.",
                }
              : m,
          ),
          !surUnVps.has(m.chatId),
        ),
      );
      const artefactsCharges = valide ? (data.artefacts ?? []).filter((a) => a.id !== ANCIEN_ARTEFACT_DE_DEPART) : [];
      dispatch({
        type: "charger",
        chats: valide ? (data.chats ?? []) : [],
        messages,
        routines: valide ? (data.routines ?? []) : [],
        artefacts: artefactsCharges,
        rendus: valide ? (data.rendus ?? []) : [],
        // Avant ce choix : activés pour qui avait déjà des artefacts claude.ai.
        artefactsClaude: valide ? (data.artefactsClaude ?? artefactsCharges.length > 0) : false,
        projects: valide ? (data.projects ?? []) : [],
        currentUser: valide ? (data.currentUser ?? null) : null,
        acces: valide ? (data.acces ?? null) : null,
        accesParServeur: valide ? (data.accesParServeur ?? null) : null,
        taches: valide ? (data.taches ?? []) : [],
        evenements: valide ? (data.evenements ?? []) : [],
        categories: valide ? lireCategories(data.categories ?? data.listes) : null,
        workflows: valide ? (data.workflows ?? []) : [],
        // Une exécution coupée par la fermeture de l'app ne reprendra pas.
        executions: (valide ? (data.executions ?? []) : []).map((e) =>
          e.statut === "en-cours" || e.statut === "approbation"
            ? {
                ...e,
                statut: "arrete" as const,
                erreur: "Interrompue : l’app a été fermée.",
                etapes: e.etapes.map((x) =>
                  x.statut === "en-cours" || x.statut === "approbation" ? { ...x, statut: "arrete" as const } : x,
                ),
              }
            : e,
        ),
      });
      // Les conversations sont là (après le rendu) : les réponses des VPS arrivées pendant l'absence peuvent s'ouvrir.
      setTimeout(() => void bridge.serveur?.pret?.().catch(() => undefined), 1000);
    }).catch((error: unknown) => { if (actif) setErreurChargement(error instanceof Error ? error.message : String(error)); });
    return () => {
      actif = false;
    };
  }, [bridge]);

  /* Écriture sur le disque, regroupée, à chaque changement. */
  useEffect(() => {
    if (!bridge || !state.charge) return;
    const timer = setTimeout(() => {
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }, 400);
    ecritureRegroupee.current = timer;
    return () => clearTimeout(timer);
  }, [bridge, state.charge, state.chats, state.messages, state.routines, state.artefacts, state.rendus, state.artefactsClaude, state.projects, state.currentUser, state.acces, state.accesParServeur, state.taches, state.evenements, state.categories, state.workflows, state.executions]);

  /* Le planning, en clair pour les agents (~/.klyra/planning/planning.md), à chaque changement. */
  useEffect(() => {
    const ecrire = bridge?.planning?.ecrire;
    if (!ecrire || !state.charge) return;
    const timer = setTimeout(() => {
      const comptePret = state.profilCompte !== null && state.evenementsCompte !== null;
      void ecrire(
        planningPourAgents({
          evenements: comptePret ? [...state.evenements, ...(state.evenementsCompte ?? [])] : state.evenements,
          taches: state.taches,
          categories: state.categories,
          /* Ce fichier est lu par les agents de ce PC : les routines, projets, fils et livrables d'un VPS n'y figurent pas.
             Les rappels et le calendrier sont ceux de la personne : ils restent communs. */
          routines: routinesLocales.filter((r) => dansEspace(r.lieu, null)),
          projects: state.projects.filter((p) => dansEspace(p.lieu, null)),
          roles,
          chats: state.chats.filter((c) => dansEspace(c.lieu, null)),
          artefacts: state.artefacts,
          rendus: state.rendus.filter((r) => renduDansEspace(r.origine, null)),
          workflows: state.workflows.filter((w) => dansEspace(w.lieu, null)),
          personne: moi.name,
          sansEquipe: comptePret,
        }),
      );
    }, 1000);
    return () => clearTimeout(timer);
  }, [bridge, state.charge, state.evenements, state.evenementsCompte, state.profilCompte, state.taches, state.categories, routinesLocales, state.projects, roles, state.chats, state.artefacts, state.rendus, state.workflows, moi.name]);

  /* Fermeture de l'app : le dernier état part tout de suite, sans attendre le regroupement. */
  useEffect(() => {
    if (!bridge) return;
    return bridge.conversations.avantFermeture(() => {
      const etat = stateRef.current;
      if (!etat.charge) return;
      void bridge.conversations.write(conversationsAEnregistrer(etat));
    });
  }, [bridge]);

  /* Un seul abonnement aux événements des agents, distribués par demande. */
  useEffect(() => {
    if (!bridge) return;
    return bridge.claude.onEvent((requestId, event) => {
      const ecouteur = ecouteurs.current.get(requestId);
      if (ecouteur) return ecouteur(event);
      /* Ce qui tourne en fond se dit encore après la fin de la réponse qui l'a lancé. */
      if (event.type === "fond") poserFondParReponse(requestId, event);
    });
  }, [bridge]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  /** Ce que l'agent reçoit : le contexte au premier message, puis ce qui s'est dit depuis sa dernière réponse. */
  const construirePrompt = useCallback((chat: Chat, roleId: RoleId, messageUtilisateur: Message): string => {
    const { messages, projects } = stateRef.current;
    const personne = identiteAffichee(stateRef.current.currentUser, stateRef.current.profilCompte);
    const allRoles = rolesRef.current;
    const nom = (id: RoleId) => allRoles.find((r) => r.id === id)?.name ?? id;
    // « /compact » part tel quel : c'est une commande de Claude Code, pas un message à lui expliquer.
    if (estCommandeCompacter(texteDe(messageUtilisateur))) return texteDe(messageUtilisateur).trim();
    // Avant le dernier « Repartir à zéro » : lisible à l'écran, plus pour l'agent.
    const fil = messages.filter((m) => m.chatId === chat.id && m.id !== messageUtilisateur.id && !estAvantDepart(chat, m));
    // Ce que l'agent n'a pas vu avec ce moteur : depuis sa dernière réponse écrite avec lui (cf. fournisseurs.ts).
    const moteur = moteurDe(chat);
    const aVoir = aReprendre(fil, roleId, moteur);
    const jamaisRepondu = aVoir.length === fil.length;
    const lus = aVoir
      // Les résumés et leurs commandes ne sont pas des messages de la conversation.
      .filter((m) => m.statut !== "en-cours" && !m.compaction && !(m.author.kind === "user" && estCommandeCompacter(texteDe(m))))
      .map((m) => {
        const texte = texteDe(m);
        if (!texte) return null;
        // Sa propre réponse, écrite avec un autre fournisseur : il doit savoir que c'est la sienne.
        const auteur =
          m.author.kind === "user"
            ? personne.name
            : m.author.roleId === roleId && moteurDuMessage(m) !== moteur
              ? `${nom(m.author.roleId)} (toi, avec ${fournisseur(moteurDuMessage(m)).nom})`
              : nom(m.author.roleId);
        return `${auteur} : ${texte}`;
      })
      .filter((l): l is string => !!l);
    // Une session neuve reçoit la conversation : les plus anciens messages au-delà de la limite restent de côté.
    const depuis = chat.sessions[roleId] ? lus : limiterReprise(lus);

    const lignes: string[] = [];
    if (!chat.sessions[roleId]) {
      const project = projects.find((p) => p.id === chat.projectId);
      lignes.push(
        `[Contexte] Tu échanges avec ${personne.name} (${personne.title}) dans l’app de bureau KLYRA, comme dans une messagerie : réponds en français, court et direct, en Markdown simple.`,
      );
      if (chat.kind === "equipe" && project) {
        const autres = chat.roleIds.filter((id) => id !== roleId).map(nom);
        lignes.push(
          `Conversation d’équipe « ${chat.title} » du projet ${project.name} (${project.subtitle}). Tu travailles dans le dossier du projet : ${project.folder}. Si tu lances le serveur de dev, lance-le en arrière-plan et écris son adresse (par exemple localhost:3000) dans ta réponse : l’app l’ouvre dans l’aperçu.` +
            (autres.length ? ` Sont aussi dans la conversation : ${autres.join(", ")}.` : ""),
        );
      } else if (chat.fil) {
        const projetFil = chat.fil.projetId ? projects.find((p) => p.id === chat.fil!.projetId) : null;
        lignes.push(
          ...contexteFil({
            titre: chat.title,
            id: chat.id,
            par: chat.fil.lancePar ? nom(chat.fil.lancePar.roleId) : personne.name,
            retour: !!chat.fil.lancePar,
            projet: projetFil ? `${projetFil.name} (${projetFil.subtitle}), dossier ${projetFil.folder}` : null,
            echeance: chat.fil.echeance,
          }),
        );
      } else {
        lignes.push("Conversation en tête-à-tête, hors projet.");
      }
      if (chat.amorce) lignes.push(`[Conversation reprise jusqu’ici]\n${chat.amorce}`);
    }
    if (depuis.length) lignes.push(`${jamaisRepondu ? "[La conversation jusqu’ici]" : "[Depuis ta dernière réponse]"}\n${depuis.join("\n\n")}`);
    // Le retour d'un fil arrive au nom de l'agent qui l'a fait, pas de la personne.
    const de = messageUtilisateur.author.kind === "role" ? `Retour du fil, de ${nom(messageUtilisateur.author.roleId)}` : `Message de ${personne.name}`;
    // « Répondre » : l'agent sait à quel message on répond.
    const citation = messageUtilisateur.parts.find((p) => p.type === "citation");
    const enReponse = citation?.type === "citation" ? `[En réponse à ce message de ${nom(citation.roleId)}]\n> ${citation.extrait}\n\n` : "";
    lignes.push(`${lignes.length || messageUtilisateur.author.kind === "role" ? `[${de}]\n` : ""}${enReponse}${texteDe(messageUtilisateur)}`);
    const joints = messageUtilisateur.parts.find((p) => p.type === "fichiers");
    if (joints?.type === "fichiers" && joints.chemins.length) {
      lignes.push(`[Fichiers joints, à lire]\n${joints.chemins.map((c) => `- ${c}`).join("\n")}`);
    }
    return lignes.join("\n\n");
  }, []);

  /** `lancer`, pour ce qui est déclaré avant lui (retours des fils). */
  const lancerTot = useRef<(chatId: string, roleId: RoleId, message: Message) => void>(() => {});
  const envoyerRef = useRef<
    (chatId: string, text: string, to: RoleId | null, fichiers: string[], horsFile?: boolean, routineRun?: string, idImpose?: string, citation?: Citation) => void
  >(() => {});

  /** La suite de la file d'attente, quand l'agent a fini. */
  const suivant = useCallback((chatId: string) => {
    // Un fil a rapporté pendant que l'agent travaillait : son retour passe en premier.
    const retour = retours.current.get(chatId)?.shift();
    if (retour) {
      timers.current.push(setTimeout(() => lancerTot.current(chatId, retour.roleId, retour.message), 0));
      return;
    }
    const prochain = stateRef.current.file[chatId]?.[0];
    if (!prochain) return;
    dispatch({ type: "file/retirer", chatId, id: prochain.id });
    // L'état « travail » est libéré au rendu suivant : le message part juste après.
    timers.current.push(
      setTimeout(() => envoyerRef.current(chatId, prochain.text, prochain.to, prochain.fichiers, true, prochain.routineRun, undefined, prochain.citation), 0),
    );
  }, []);

  /** Suit une réponse d'agent au fil de l'eau, jusqu'à sa fin. */
  /** Les retours de fils en attente, par conversation de l'agent qui les a lancés. */
  const retours = useRef(new Map<string, { roleId: RoleId; message: Message }[]>());

  /* Un fil lancé par un agent a répondu : sa réponse revient à cet agent, dans sa conversation. */
  const rapporterFil = (chatId: string, messageId: string, ok: boolean) => {
    const { chats, messages, travail } = stateRef.current;
    const fil = chats.find((c) => c.id === chatId);
    const lancePar = fil?.fil?.lancePar;
    if (!fil?.fil?.retourAttendu || !lancePar || !chats.some((c) => c.id === lancePar.chatId)) return;
    dispatch({ type: "chat/update", id: chatId, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: false } } : c) });
    const reponse = messages.find((m) => m.id === messageId);
    const nom = rolesRef.current.find((r) => r.id === fil.fil!.roleId)?.name ?? fil.fil.roleId;
    const corps = reponse ? texteDe(reponse) : "";
    const message: Message = {
      id: crypto.randomUUID(),
      chatId: lancePar.chatId,
      author: { kind: "role", roleId: fil.fil.roleId },
      createdAt: new Date().toISOString(),
      parts: [
        {
          type: "text",
          text: texteRetourFil({ titre: fil.title, id: fil.id, agent: nom, ok, texte: corps || reponse?.erreur || "" }),
        },
      ],
    };
    dispatch({ type: "message/add", message });
    if (travail[lancePar.chatId]) {
      // L'agent qui a lancé le fil travaille encore : le retour attend son tour.
      retours.current.set(lancePar.chatId, [...(retours.current.get(lancePar.chatId) ?? []), { roleId: lancePar.roleId, message }]);
      return;
    }
    timers.current.push(setTimeout(() => lancerTot.current(lancePar.chatId, lancePar.roleId, message), 0));
  };

  /* Une réponse finie là où tu ne regardes pas (autre conversation, autre app) : le Mac te prévient.
     Renvoie vrai si une notification est demandée. */
  const prevenir = (chatId: string, roleId: RoleId, messageId: string, ok: boolean): boolean => {
    const notifier = getBridge()?.systeme.notifier;
    if (!notifier) return false;
    const ouverte = location.pathname === "/chat" && new URLSearchParams(location.search).get("id") === chatId;
    if (ouverte && document.hasFocus()) return false;
    const nom = rolesRef.current.find((r) => r.id === roleId)?.name ?? "L’agent";
    const message = stateRef.current.messages.find((m) => m.id === messageId);
    const extrait = message ? texteDe(message).replace(/[*`#>_]/g, "").replace(/\s+/g, " ").trim() : "";
    const titre = ok ? `${nom} a fini` : `${nom} s’est arrêté sur une erreur`;
    const corps = extrait || (ok ? "Sa réponse t’attend." : (message?.erreur ?? ""));
    void notifier(titre, corps, chatId, ok ? "agentFini" : "agentErreur");
    /* Le téléphone aussi, si la fenêtre n'a pas le focus (spec mobile § 8). */
    pousserAuTelephone(notificationDeFin(stateRef.current.chats.find((c) => c.id === chatId), { ok, titre, corps, lien: lienMessage(chatId, messageId) }));
    return true;
  };

  const suivreReponse = useCallback(
    (chatId: string, roleId: RoleId, messageId: string) => {
      const maj = (patch: (m: Message) => Message) => dispatch({ type: "message/update", id: messageId, patch });
      const terminer = () => {
        ecouteurs.current.delete(messageId);
        // Une réponse spontanée peut finir pendant qu'une autre est en cours : seule la sienne libère la conversation.
        const etaitLeTravail = stateRef.current.travail[chatId]?.messageId === messageId;
        dispatch({ type: "travail/fin", chatId, messageId });
        if (etaitLeTravail) suivant(chatId);
      };

    noterReponse(messageId, chatId, roleId);
    ecouteurs.current.set(messageId, (event) => {
      switch (event.type) {
        case "fond":
          poserFond(chatId, roleId, event);
          break;
        case "session":
          dispatch({
            type: "chat/update",
            id: chatId,
            patch: (c) => ({
              ...c,
              sessions: { ...c.sessions, [roleId]: event.sessionId },
            }),
          });
          break;
        case "texte":
          maj((m) => ({
            ...m,
            parts: ajouterTexte(m.parts, event.delta, event.nouveauBloc),
          }));
          break;
        case "etape": {
          const chemin = event.entree.file_path ?? event.entree.notebook_path;
          const etape: Etape = {
            id: event.id,
            outil: event.outil,
            libelle: libelleEtape(event.outil, event.entree, rolesRef.current),
            statut: "en-cours",
            parent: event.parent,
            ...(typeof chemin === "string" ? { chemin } : {}),
          };
          const taches = event.outil === "TodoWrite" ? lireTaches(event.entree) : null;
          if (taches)
            dispatch({
              type: "chat/update",
              id: chatId,
              patch: (c) => ({ ...c, taches }),
            });
          maj((m) => ({
            ...m,
            parts: ajouterEtape(m.parts, etape, rolesRef.current, event.entree),
          }));
          break;
        }
        case "jetons":
          dispatch({ type: "travail/jetons", chatId, total: event.total });
          break;
        case "contexte":
        case "compacte": {
          const mesure = event.type === "contexte" ? { jetons: event.jetons } : { resume: event.apres };
          const le = new Date().toISOString();
          dispatch({
            type: "chat/update",
            id: chatId,
            patch: (c) => ({
              ...c,
              contexte: { ...c.contexte, [roleId]: nouvelleMesure(c.contexte?.[roleId], c.sessions[roleId] ?? null, mesure, le) },
            }),
          });
          if (event.type === "compacte") {
            // `apres` ne compte que le résumé (sans consignes ni outils) : la mesure exacte revient au message suivant.
            const auto = stateRef.current.messages.find((m) => m.id === messageId)?.compactionAuto;
            const qui = auto === "pause" ? "Conversation résumée automatiquement pendant la pause, avant que le cache n’expire" : auto === "envoi" ? "Conversation résumée automatiquement avant ton message" : "Conversation résumée";
            const note = `_${qui} : elle relisait ${formaterJetons(event.avant)} jetons à chaque message, le résumé en garde ${formaterJetons(event.apres)}._`;
            maj((m) => ({ ...m, parts: ajouterTexte(m.parts, note, true) }));
          }
          break;
        }
        case "etape-partielle": {
          // La carte de l'atelier s'écrit pendant que l'assistant remplit l'outil.
          const enCours = event.outil === "mcp__klyra__proposer_agent" ? lireMajAtelier(event.entree) : null;
          if (enCours) maj((m) => ({ ...m, parts: poserAtelier(m.parts, event.id, enCours, true) }));
          // Une équipe qui se compose : ses cartes arrivent une à une.
          const equipe = event.outil === OUTIL_EQUIPE_CLAUDE ? lireMajEquipe(event.entree) : null;
          if (equipe) maj((m) => ({ ...m, parts: poserEquipe(m.parts, event.id, equipe, true) }));
          // Une carte interactive qui s'écrit : elle paraît dès qu'elle est lisible, sans être remplissable.
          const carte = event.outil === OUTIL_CARTE_CLAUDE ? lireCarte(event.entree) : null;
          if (carte && "carte" in carte) maj((m) => ({ ...m, parts: poserCarte(m.parts, event.id, carte.carte, true) }));
          // Un workflow qui se construit : la page Workflows montre chaque étape posée.
          if (event.outil === "mcp__klyra__construire_workflow") outilsWorkflows().apercu({ chatId, roleId }, event.id, event.entree);
          break;
        }
        case "tache-fond": {
          // L'agent lancé en arrière-plan est revenu : sa passation, dans un message plus ancien de la conversation.
          const porteur = stateRef.current.messages.findLast(
            (m) => m.chatId === chatId && m.parts.some((p) => p.type === "passation" && p.etapeId === event.id),
          );
          if (porteur) dispatch({ type: "message/update", id: porteur.id, patch: (m) => ({ ...m, parts: finTacheDeFond(m.parts, event.id, event.statut) }) });
          break;
        }
        case "etape-fin":
          maj((m) => ({
            ...m,
            parts: finirEtape(m.parts, event.id, event.ok),
          }));
          if (!event.ok) outilsWorkflows().abandonner({ chatId, roleId }, event.id);
          break;
        case "autorisation": {
          const e = event.entree;
          const detail = [e.command, e.file_path, e.notebook_path, e.url, e.pattern].find((v) => typeof v === "string");
          const libelle = libelleEtape(event.outil, event.entree, rolesRef.current);
          /* « Hugo demande ton accord » sur le téléphone, si la fenêtre n'a pas le focus (spec mobile § 8). */
          pousserAuTelephone({
            evenement: "accord",
            titre: `${rolesRef.current.find((r) => r.id === roleId)?.name ?? "L’agent"} demande ton accord`,
            corps: libelle,
            lien: lienMessage(chatId, messageId),
          });
          maj((m) => ({
            ...m,
            parts: [
              ...m.parts,
              {
                type: "autorisation",
                id: event.id,
                outil: event.outil,
                libelle,
                detail: typeof detail === "string" ? detail : "",
                description: event.description,
                statut: "attente",
              },
            ],
          }));
          break;
        }
        case "autorisation-fin":
          maj((m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.type === "autorisation" && p.id === event.id && p.statut === "attente"
                ? { ...p, statut: event.accepte ? "acceptee" : "refusee" }
                : p,
            ),
          }));
          break;
        case "fin":
          outilsWorkflows().abandonner({ chatId, roleId });
          maj((m) => {
            const aDuTexte = m.parts.some((p) => p.type === "text" && p.text.trim());
            // Une carte restée en cours d'écriture (réponse arrêtée avant la fin de l'outil) n'est pas gardée.
            const finies = m.parts.filter((p) => !((p.type === "atelier-agent" || p.type === "atelier-equipe" || p.type === "carte") && p.provisoire));
            const parts = !aDuTexte && event.texte ? ajouterTexte(finies, event.texte, true) : finies;
            return event.ok
              ? { ...m, parts, statut: "fait" }
              : { ...m, parts, statut: "erreur", erreur: event.erreur };
          });
          if (event.sessionId) {
            const sessionId = event.sessionId;
            dispatch({
              type: "chat/update",
              id: chatId,
              patch: (c) => ({
                ...c,
                sessions: { ...c.sessions, [roleId]: sessionId },
              }),
            });
          }
          terminer();
          // Un résumé n'est pas une réponse : ni notification, ni ticket, ni retour de fil.
          if (stateRef.current.messages.find((m) => m.id === messageId)?.compaction) break;
          // Un agent mis en sourdine (clic droit dans la barre) ne prévient plus de ses réponses ; ses erreurs, si.
          const sourdine = event.ok && !!metaAgentsRef.current[roleId]?.muet;
          if (event.erreur !== "Arrêté par toi." && !event.silencieux && !sourdine) {
            const notifiee = prevenir(chatId, roleId, messageId, event.ok);
            // Le son de l'app, sauf si la notification du système sonne déjà.
            if (!(notifiee && notificationSonore(event.ok ? "agentFini" : "agentErreur"))) jouer(event.ok ? "fin-de-tache" : "erreur");
          }
          // Le ticket du fil : à valider, ou bloqué sur l'erreur.
          dispatch({ type: "chat/update", id: chatId, patch: (c) => (c.fil ? { ...c, fil: apresReponse(c.fil, { ok: event.ok, erreur: event.erreur }) } : c) });
          // PC fermé à la fin de la réponse, le VPS l'a déjà rapportée au lanceur : pas une seconde fois.
          if (event.retourFil === "serveur") dispatch({ type: "chat/update", id: chatId, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: false } } : c) });
          else rapporterFil(chatId, messageId, event.ok);
          if (stateRef.current.chats.some((c) => c.id === chatId && c.fil)) {
            const pont = getBridge()?.superagent;
            if (pont) {
              void pont.message({
                filId: chatId,
                messageId,
                texte: "texte" in event && typeof event.texte === "string" ? event.texte : "",
                auteur: "role",
                roleId,
                ok: event.ok,
                erreur: event.erreur ?? null,
                projectId: stateRef.current.chats.find((c) => c.id === chatId)?.fil?.projetId ?? "hors-projet",
                compte: stateRef.current.currentUser.id || "local",
              });
              if (!event.ok) void pont.marquer(chatId, "blocked", null);
            }
          }
          break;
      }
    });
    },
    [suivant, outilsWorkflows],
  );

  /* Un agent d'un VPS a publié un livrable (publier_artefact, cf. serveur/rendus.mjs). Le fichier reste
     sur le serveur : on ne le copie pas dans ~/.klyra/rendus. Une copie déjà là, d'avant cette règle, est
     retirée à la publication suivante du même original. L'origine garde le serveur. */
  useEffect(() => {
    const onVps = bridge?.rendus?.onVps;
    if (!onVps) return;
    return onVps((lieu, r) => {
      const origine = `${lieu}#${r.chemin}`;
      const avant = renduDeLOrigine(stateRef.current.rendus, origine);
      if (avant?.chemin) void bridge?.rendus.supprimer(avant.chemin);
      const chat = stateRef.current.chats.find((c) => c.id === r.conversation);
      const maintenant = new Date().toISOString();
      dispatch({
        type: "rendu/publier",
        rendu: renduDepuisServeur(lieu, r, chat, maintenant, crypto.randomUUID()),
      });
    });
  }, [bridge]);

  /* L'agent reprend la parole de lui-même (un agent d'arrière-plan a fini, un serveur s'est arrêté) :
     sa réponse s'ouvre dans la conversation de cette session. */
  useEffect(() => {
    if (!bridge?.claude.onSpontane) return;
    return bridge.claude.onSpontane((requestId, sessionId, contexte) => {
      let chat = stateRef.current.chats.find((c) => Object.values(c.sessions).includes(sessionId));
      let roleId = chat && Object.entries(chat.sessions).find(([, s]) => s === sessionId)?.[0];
      // Une routine tenue par un VPS : sa réponse va dans sa conversation, créée à sa première exécution.
      if ((!chat || !roleId) && contexte && /^(routine|wf)-/.test(contexte.chatId)) {
        roleId = contexte.agentId;
        chat = stateRef.current.chats.find((c) => c.id === contexte.chatId);
        if (!chat) {
          chat = {
            id: contexte.chatId,
            kind: "equipe",
            projectId: null,
            title: contexte.chatId.startsWith("wf-") ? contexte.titre : `Routine « ${contexte.titre} »`,
            roleIds: [roleId],
            updatedAt: new Date().toISOString(),
            sessions: {},
            luJusqua: null,
            lieu: contexte.lieu,
          };
          dispatch({ type: "chat/add", chat });
          stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
        }
      }
      // Un fil que le VPS tient lui-même (ouvert par un de ses agents pendant que ce PC était fermé) : il prend sa place.
      if ((!chat || !roleId) && contexte?.fil && contexte.chatId.startsWith(FIL)) {
        roleId = contexte.agentId;
        chat = stateRef.current.chats.find((c) => c.id === contexte.chatId);
        if (!chat) {
          chat = {
            id: contexte.chatId,
            kind: "direct",
            projectId: null,
            title: contexte.titre,
            roleIds: [roleId],
            updatedAt: new Date().toISOString(),
            sessions: {},
            luJusqua: null,
            fil: contexte.fil,
            lieu: contexte.lieu,
          };
          dispatch({ type: "chat/add", chat });
          stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
        }
      }
      // La réponse d'un fil que le VPS rapporte à l'agent qui l'a lancé : le message du retour, puis sa réponse.
      const retour = contexte?.retour;
      if (retour) {
        chat = stateRef.current.chats.find((c) => c.id === contexte.chatId) ?? chat;
        roleId = contexte.agentId;
        if (chat && !stateRef.current.messages.some((m) => m.id === retour.messageId)) {
          dispatch({
            type: "message/add",
            message: { id: retour.messageId, chatId: chat.id, author: { kind: "role", roleId: retour.roleId }, createdAt: retour.creeLe, parts: [{ type: "text", text: retour.texte }] },
          });
        }
      }
      // Écrit sur le téléphone pendant que ce PC était fermé, envoyé au VPS : le message, puis sa réponse.
      const telephone = contexte?.telephone;
      if (telephone) {
        chat = stateRef.current.chats.find((c) => c.id === contexte.chatId) ?? chat;
        roleId = contexte.agentId;
        if (chat && contexte.choix) {
          const { fournisseur: moteur, modele, effort, compteClaude } = contexte.choix;
          chat = { ...changerDeMoteur(chat, moteur), modele, effort };
          /* Le compte Claude qui a répondu sur le VPS (absent d'un serveur ancien : celui de la conversation reste). */
          if (compteClaude !== undefined) {
            if (compteClaude) chat = { ...chat, compteClaude };
            else delete chat.compteClaude;
          }
          const suite = chat;
          dispatch({ type: "chat/update", id: chat.id, patch: () => suite });
          stateRef.current = { ...stateRef.current, chats: stateRef.current.chats.map((c) => c.id === suite.id ? suite : c) };
        }
        if (chat && !stateRef.current.messages.some((m) => m.id === telephone.messageId)) {
          dispatch({
            type: "message/add",
            message: { id: telephone.messageId, chatId: chat.id, author: { kind: "user" }, createdAt: telephone.creeLe, parts: [{ type: "text", text: telephone.texte }] },
          });
        }
      }
      if (!chat || !roleId) return;
      /* Rangée par le VPS pendant que ce PC était fermé : le journal rejoue la réponse complète, elle repart de zéro. */
      if (stateRef.current.messages.some((m) => m.id === requestId && m.ecritParServeur)) {
        stateRef.current = { ...stateRef.current, messages: stateRef.current.messages.filter((m) => m.id !== requestId) };
        dispatch({ type: "espace/fusion", etat: { chats: stateRef.current.chats, messages: stateRef.current.messages, projects: stateRef.current.projects, workflows: stateRef.current.workflows, executions: stateRef.current.executions, rendus: stateRef.current.rendus } });
      }
      if (!stateRef.current.messages.some((m) => m.id === requestId)) {
        dispatch({
          type: "message/add",
          message: { id: requestId, chatId: chat.id, author: { kind: "role", roleId }, createdAt: new Date().toISOString(), parts: [], statut: "en-cours", ...(moteurDe(chat) !== PAR_DEFAUT ? { moteur: moteurDe(chat) } : {}) },
        });
      }
      if (!stateRef.current.travail[chat.id]) {
        dispatch({ type: "travail/debut", chatId: chat.id, travail: { roleId, messageId: requestId, debut: Date.now() } });
      }
      suivreReponse(chat.id, roleId, requestId);
    });
  }, [bridge, suivreReponse]);

  /** Fait répondre un agent à un message. */
  const lancer = useCallback(
    (chatId: string, roleId: RoleId, messageUtilisateur: Message) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      if (!chat) return;
      const messageId = messageUtilisateur.routineRun ? `routine-answer-${messageUtilisateur.routineRun}` : crypto.randomUUID();
      const moteur = moteurDe(chat);
      const reponse: Message = {
        id: messageId,
        chatId,
        author: { kind: "role", roleId },
        createdAt: new Date().toISOString(),
        parts: [],
        statut: "en-cours",
        ...(messageUtilisateur.routineRun ? { routineRun: messageUtilisateur.routineRun } : {}),
        ...(moteur !== PAR_DEFAUT ? { moteur } : {}),
        ...(estCommandeCompacter(texteDe(messageUtilisateur)) ? { compaction: true } : {}),
        ...(messageUtilisateur.compactionAuto ? { compactionAuto: messageUtilisateur.compactionAuto } : {}),
      };
      dispatch({ type: "message/add", message: reponse });
      dispatch({
        type: "travail/debut",
        chatId,
        travail: { roleId, messageId, debut: Date.now() },
      });
      if (!chat.roleIds.includes(roleId)) {
        dispatch({
          type: "chat/update",
          id: chatId,
          patch: (c) => ({ ...c, roleIds: [...c.roleIds, roleId] }),
        });
      }

      const maj = (patch: (m: Message) => Message) => dispatch({ type: "message/update", id: messageId, patch });
      const terminer = () => {
        ecouteurs.current.delete(messageId);
        dispatch({ type: "travail/fin", chatId });
        suivant(chatId);
      };

      /* Navigateur : réponse simulée, écrite au fil de l'eau. */
      if (!bridge) {
        const texte = SIMULATED_REPLIES[roleId] ?? "Bien reçu, je m’en occupe et je te réponds ici.";
        const mots = texte.split(/(?<= )/);
        mots.forEach((mot, i) => {
          timers.current.push(
            setTimeout(
              () =>
                maj((m) => ({
                  ...m,
                  parts: ajouterTexte(m.parts, mot, false),
                })),
              1200 + i * 45,
            ),
          );
        });
        timers.current.push(
          setTimeout(
            () => {
              maj((m) => ({ ...m, statut: "fait" }));
              terminer();
            },
            1300 + mots.length * 45,
          ),
        );
        return;
      }

      suivreReponse(chatId, roleId, messageId);

      const project = stateRef.current.projects.find((p) => p.id === chat.projectId);
      // La consigne ET sa réponse sont durables avant le claim dans Electron.
      const demarrer = async () => {
        if (messageUtilisateur.routineRun) {
          const etat = stateRef.current;
          const messages = etat.messages.filter((m) => m.id !== messageUtilisateur.id && m.id !== reponse.id);
          stateRef.current = { ...etat, messages: [...messages, messageUtilisateur, reponse] };
          const sauvegarde = await bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
          if (!sauvegarde.ok) {
            void bridge.routines?.signaler(messageUtilisateur.routineRun, { state: "failed", chatId: null, messageId: null, error: sauvegarde.message });
            throw new Error(sauvegarde.message);
          }
        }
        return bridge.claude.stream(messageId, {
          ...(moteur !== PAR_DEFAUT ? { moteur } : {}),
          agent: roleId === "principal" ? null : roleId,
          prompt: construirePrompt(chat, roleId, messageUtilisateur),
          // `/<skill>` en tête du message de la personne : chargée par Claude Code, ou à lire d'abord pour Codex (cf. src/lib/skills.ts).
          ...(messageUtilisateur.author.kind === "user" && skillEnTete(texteDe(messageUtilisateur))
            ? { skill: skillEnTete(texteDe(messageUtilisateur)) }
            : {}),
          // Sur un VPS, le dossier du PC n'existe pas : l'agent travaille dans son atelier là-bas.
          dossier: chat.lieu ? null : chat.kind === "equipe" ? (project?.folder ?? null) : null,
          lieu: chat.lieu ?? null,
          dossierVps: chat.lieu && chat.kind === "equipe" && project?.lieu === chat.lieu ? project.folder : null,
          sessionId: chat.sessions[roleId] ?? null,
          ...(chat.sessionNeuve && !chat.sessions[roleId] ? { sessionNeuve: true } : {}),
          modele: stateRef.current.chats.find((c) => c.id === chatId)?.modele ?? null,
          effort: stateRef.current.chats.find((c) => c.id === chatId)?.effort ?? null,
          // Claude : le compte choisi pour la conversation (choix du modèle) ; absent : celui des agents.
          ...compteDe(stateRef.current.chats.find((c) => c.id === chatId), moteur),
          acces: accesDuServeur(stateRef.current, chat.lieu),
          fichiers: messageUtilisateur.parts.flatMap((p) => (p.type === "fichiers" ? p.chemins : [])),
          chatId,
          ...(messageUtilisateur.routineRun ? { routineRun: messageUtilisateur.routineRun } : {}),
        });
      };
      void demarrer().then((r) => {
          if (!r.ok)
            ecouteurs.current.get(messageId)?.({
              type: "fin",
              ok: false,
              texte: "",
              erreur: r.message,
            });
        }).catch((error: unknown) => ecouteurs.current.get(messageId)?.({
          type: "fin", ok: false, texte: "", erreur: error instanceof Error ? error.message : String(error),
        }));
    },
    [bridge, construirePrompt, suivant, suivreReponse],
  );
  const lancerRef = useRef(lancer);
  useEffect(() => {
    lancerRef.current = lancer;
    lancerTot.current = lancer;
  });

  /* La configuration KLYRA (résumé automatique), lue hors des rendus. */
  const configurationRef = useRef(CONFIGURATION_PAR_DEFAUT);
  useEffect(() => {
    void reglagesActuels().then((r) => (configurationRef.current = r.configuration));
    return surReglages((r) => (configurationRef.current = r.configuration));
  }, []);

  /** Un résumé lancé par l'app : sa commande reste hors du fil, seule la réponse « résumé » y paraît. */
  const compacterAuto = useCallback((chatId: string, roleId: RoleId, raison: "envoi" | "pause") => {
    const commande: Message = {
      id: `resume-auto-${crypto.randomUUID()}`,
      chatId,
      author: { kind: "user" },
      createdAt: new Date().toISOString(),
      parts: [{ type: "text", text: COMMANDE_RESUME_AUTO }],
      compactionAuto: raison,
    };
    lancerRef.current(chatId, roleId, commande);
  }, []);

  /* Résumé automatique pendant une pause (lib/contexte.ts) : une seule tentative par mesure, un à la fois,
     tant que la session et son cache sont chauds. Vérifié peu après l'ouverture, puis chaque minute. */
  const resumesTentes = useRef(new Set<string>());
  useEffect(() => {
    const verifier = () => {
      if (!configurationRef.current.resumeAuto) return;
      const { chats, travail, file } = stateRef.current;
      for (const chat of chats) {
        if (travail[chat.id] || file[chat.id]?.length) continue;
        const roleId = resumePause(chat, Date.now());
        if (!roleId) continue;
        const cle = `${chat.id}:${roleId}:${chat.contexte?.[roleId]?.le}`;
        if (resumesTentes.current.has(cle)) continue;
        resumesTentes.current.add(cle);
        compacterAuto(chat.id, roleId, "pause");
        return;
      }
    };
    const premiere = setTimeout(verifier, 5_000);
    const minuterie = setInterval(verifier, 60_000);
    return () => {
      clearTimeout(premiere);
      clearInterval(minuterie);
    };
  }, [compacterAuto]);

  /**
   * Le titre provisoire (début du texte) remplacé par la demande comprise, en
   * quelques mots, par l'IA. Un titre changé entre-temps (renommé) est gardé.
   */
  const titrer = useCallback(
    (chatId: string, texte: string) => {
      const titre = bridge?.claude.titre;
      if (!titre || !texte.trim()) return;
      const provisoire = chatTitle(texte);
      void titre(texte).then((r) => {
        if (!r.ok || !r.data) return;
        const propre = r.data;
        dispatch({ type: "chat/update", id: chatId, patch: (c) => (c.title === provisoire ? { ...c, title: propre } : c) });
      });
    },
    [bridge],
  );

  /** La conversation, créée si c'est la première fois qu'on s'adresse à cet agent en direct. */
  const assurerChat = useCallback((chatId: string): Chat | undefined => {
    let chat = stateRef.current.chats.find((c) => c.id === chatId);
    const direct = lireIdDirect(chatId);
    if (!chat && direct) {
      const { roleId } = direct;
      const role = rolesRef.current.find((r) => r.id === roleId);
      if (!role) return;
      chat = {
        id: chatId,
        kind: "direct",
        projectId: null,
        title: role.name,
        roleIds: [roleId],
        updatedAt: new Date().toISOString(),
        sessions: {},
        luJusqua: null,
        // L'id dit la machine : `dm-<agent>` ce PC, `dm-<agent>@<hôte>` un VPS.
        lieu: direct.hote ? lieuDeHote(direct.hote) : null,
        // Le fournisseur choisi pour l'agent dans Réglages › Agents.
        ...(role.fournisseur ? { fournisseur: role.fournisseur } : {}),
      };
      dispatch({ type: "chat/add", chat });
      stateRef.current = {
        ...stateRef.current,
        chats: [chat, ...stateRef.current.chats],
      };
    }
    return chat;
  }, []);

  /** `horsFile` : le message sort de la file, l'agent vient de finir (l'état n'est peut-être pas encore à jour). */
  const envoyer = useCallback(
    (chatId: string, text: string, to: RoleId | null, fichiers: string[], horsFile = false, routineRun?: string, idImpose?: string, citation?: Citation) => {
      const chat = assurerChat(chatId);
      if (!chat) return;

      // Une routine attend aussi si son agent travaille dans une autre conversation.
      const agentOccupe = routineRun && Object.values(stateRef.current.travail).some((t) => t.roleId === to);
      if ((stateRef.current.travail[chatId] && !horsFile) || agentOccupe) {
        const idFile = idImpose ?? crypto.randomUUID();
        dispatch({
          type: "file/ajouter",
          chatId,
          message: { id: idFile, text, to, fichiers, ...(routineRun ? { routineRun } : {}), ...(citation ? { citation } : {}) },
        });
        return idFile;
      }

      // Résumé automatique avant un message à une conversation très lourde : le résumé d'abord, le message attend son tour.
      const cible = chat.kind === "direct" ? chat.roleIds[0] : (to ?? (chat.roleIds.includes("principal") ? "principal" : chat.roleIds[0]));
      if (!horsFile && !routineRun && configurationRef.current.resumeAuto && !estCommandeCompacter(text) && resumeAvantEnvoi(chat, cible)) {
        const idFile = idImpose ?? crypto.randomUUID();
        dispatch({ type: "file/ajouter", chatId, message: { id: idFile, text, to, fichiers, ...(citation ? { citation } : {}) } });
        compacterAuto(chatId, cible, "envoi");
        return idFile;
      }

      // Un fil sans titre prend le début de son premier message, puis le titre que l'IA en tire.
      if (chat.fil && chat.title === FIL_SANS_TITRE && text.trim()) {
        dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, title: chatTitle(text) }) });
        titrer(chatId, text);
      }

      const message: Message = {
        id: idImpose ?? (routineRun ? `routine-user-${routineRun}` : crypto.randomUUID()),
        chatId,
        author: { kind: "user" },
        createdAt: new Date().toISOString(),
        parts: [
          ...(citation ? [{ type: "citation" as const, ...citation }] : []),
          { type: "text", text },
          ...(fichiers.length ? [{ type: "fichiers" as const, chemins: fichiers }] : []),
        ],
        ...(routineRun ? { routineRun } : {}),
      };
      dispatch({ type: "message/add", message });
      const parDefaut = chat.roleIds.includes("principal") ? "principal" : chat.roleIds[0];
      const roleId = chat.kind === "direct" ? chat.roleIds[0] : (to ?? parDefaut);
      // Le message est dans l'état au prochain rendu : l'agent part juste après.
      timers.current.push(setTimeout(() => lancerRef.current(chatId, roleId, message), 0));
      return message.id;
    },
    [assurerChat, titrer, compacterAuto],
  );
  useEffect(() => {
    envoyerRef.current = envoyer;
  });
  // Une routine qui attend un agent occupé ailleurs repart quand cet agent se libère.
  useEffect(() => {
    const ids = new Set(Object.values(state.travail).map((t) => t.roleId));
    for (const [chatId, file] of Object.entries(state.file)) {
      const prochain = file[0];
      if (!prochain?.routineRun || state.travail[chatId] || ids.has(prochain.to ?? "")) continue;
      ids.add(prochain.to ?? "");
      dispatch({ type: "file/retirer", chatId, id: prochain.id });
      timers.current.push(setTimeout(() => envoyerRef.current(chatId, prochain.text, prochain.to, prochain.fichiers, true, prochain.routineRun), 0));
    }
  }, [state.travail, state.file]);
  const sendMessage = useCallback(
    (chatId: string, text: string, to: RoleId | null, fichiers: string[] = [], citation?: Citation) =>
      envoyer(chatId, text, to, fichiers, false, undefined, undefined, citation),
    [envoyer],
  );

  const reagir = useCallback((messageId: string, emoji: string) => {
    dispatch({
      type: "message/update",
      id: messageId,
      patch: (m) => {
        const avant = m.reactions ?? [];
        const reactions = avant.includes(emoji) ? avant.filter((e) => e !== emoji) : [...avant, emoji];
        return { ...m, reactions: reactions.length ? reactions : undefined };
      },
    });
  }, []);

  const choisirModele = useCallback(
    (chatId: string, modele: string | null, effort: string | null) => {
      if (!assurerChat(chatId)) return;
      dispatch({
        type: "chat/update",
        id: chatId,
        patch: (c) => ({ ...c, modele, effort }),
      });
    },
    [assurerChat],
  );
  const choisirCompteClaude = useCallback(
    (chatId: string, compte: string | null) => {
      if (!assurerChat(chatId)) return;
      dispatch({
        type: "chat/update",
        id: chatId,
        patch: (c) => {
          const suite: Chat = { ...c, compteClaude: compte };
          if (!compte) delete suite.compteClaude;
          return suite;
        },
      });
    },
    [assurerChat],
  );
  const masquerConseilContexte = useCallback((chatId: string, jusqua: number) => {
    dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, contexteMasqueJusqua: jusqua }) });
  }, []);

  /** La conversation passe sur un autre fournisseur, avec le modèle et l'effort choisis chez lui. */
  const choisirFournisseur = useCallback(
    (chatId: string, moteur: string, modele: string | null, effort: string | null) => {
      if (!assurerChat(chatId)) return;
      dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...changerDeMoteur(c, moteur), modele, effort }) });
    },
    [assurerChat],
  );

  /* Comme le sélecteur de serveur d'OpenBot : on change d'espace, pas de conversation. Chaque agent a une
     conversation directe par serveur (`idDirect`) ; un travail en cours continue sur sa machine. */
  const basculerMachine = useCallback((lieu: string | null) => retenirLieu(lieu), []);

  /** Sous une réponse : la refaire, plus détaillée, plus concise, en cherchant sur le web, ou avec un autre modèle. */
  const reessayer = useCallback(
    (chatId: string, messageId: string, facon: FaconReessai, modele?: string) => {
      const { messages, chats } = stateRef.current;
      const message = messages.find((m) => m.id === messageId);
      const chat = chats.find((c) => c.id === chatId);
      if (!message || !chat || message.author.kind !== "role") return;
      const roleId = message.author.roleId;
      const fil = messages.filter((m) => m.chatId === chatId);
      const derniere = fil.findLast((m) => m.author.kind === "role" && m.author.roleId === roleId);
      const extrait = texteDe(message).replace(/\s+/g, " ").slice(0, 80);
      const laquelle = derniere?.id === messageId || !extrait ? "ta dernière réponse" : `ta réponse « ${extrait}… »`;
      if (modele) {
        const suite = { ...chat, modele };
        dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, modele }) });
        stateRef.current = { ...stateRef.current, chats: chats.map((c) => (c.id === chatId ? suite : c)) };
      }
      const consignes: Record<FaconReessai, string> = {
        reessayer: `Refais ${laquelle}, autrement.`,
        details: `Reprends ${laquelle} en plus détaillé.`,
        concis: `Reprends ${laquelle} en plus concis.`,
        web: `Refais ${laquelle} en cherchant d’abord sur le web.`,
      };
      envoyerRef.current(chatId, consignes[facon], roleId, []);
    },
    [],
  );

  /** Une nouvelle conversation qui reprend celle-ci jusqu'à ce message ; l'originale ne bouge pas. */
  const brancher = useCallback((chatId: string, messageId: string): string | null => {
    const { messages, chats } = stateRef.current;
    const personne = identiteAffichee(stateRef.current.currentUser, stateRef.current.profilCompte);
    const chat = chats.find((c) => c.id === chatId);
    const fil = messages.filter((m) => m.chatId === chatId);
    const fin = fil.findIndex((m) => m.id === messageId);
    if (!chat || fin < 0) return null;
    const allRoles = rolesRef.current;
    const nom = ({ author }: Message) => {
      if (author.kind === "user") return personne.name;
      return allRoles.find((r) => r.id === author.roleId)?.name ?? author.roleId;
    };
    const repris = fil.slice(0, fin + 1).filter((m) => m.statut !== "en-cours");
    const id = crypto.randomUUID();
    const branche: Chat = {
      id,
      kind: "equipe",
      projectId: chat.projectId,
      title: `${chat.title} · branche`,
      roleIds: chat.roleIds,
      updatedAt: new Date().toISOString(),
      sessions: {},
      luJusqua: null,
      modele: chat.modele,
      lieu: chat.lieu,
      effort: chat.effort,
      ...(chat.compteClaude ? { compteClaude: chat.compteClaude } : {}),
      ...(chat.fournisseur ? { fournisseur: chat.fournisseur } : {}),
      amorce: repris
        .map((m) => `${nom(m)} : ${texteDe(m)}`)
        .filter((l) => !l.endsWith(": "))
        .join("\n\n")
        .slice(-24000),
    };
    dispatch({ type: "chat/add", chat: branche });
    for (const m of repris) dispatch({ type: "message/add", message: { ...m, id: crypto.randomUUID(), chatId: id } });
    // Les messages repris gardent leur date : la branche, elle, remonte en tête des récentes.
    dispatch({ type: "chat/update", id, patch: (c) => ({ ...c, updatedAt: new Date().toISOString() }) });
    stateRef.current = { ...stateRef.current, chats: [branche, ...chats] };
    return id;
  }, []);

  const startChat = useCallback((projectId: string, text: string, to: RoleId | null, fichiers: string[] = [], idImpose?: string) => {
    const id = idImpose ?? crypto.randomUUID();
    const roleIds: RoleId[] = to && to !== "principal" ? ["principal", to] : ["principal"];
    const chat: Chat = {
      id,
      kind: "equipe",
      projectId,
      title: chatTitle(text),
      roleIds,
      updatedAt: new Date().toISOString(),
      sessions: {},
      luJusqua: null,
      // Un projet du VPS : ses conversations y tournent.
      lieu: stateRef.current.projects.find((p) => p.id === projectId)?.lieu ?? null,
    };
    dispatch({ type: "chat/add", chat });
    stateRef.current = {
      ...stateRef.current,
      chats: [chat, ...stateRef.current.chats],
    };
    envoyerRef.current(id, text, to, fichiers);
    titrer(id, text);
    return id;
  }, [titrer]);

  const arreter = useCallback(
    (chatId: string) => {
      const travail = stateRef.current.travail[chatId];
      if (travail && bridge) void bridge.claude.cancel(travail.messageId);
    },
    [bridge],
  );

  const creerFil = useCallback((roleId: RoleId, titre?: string, lancePar?: { roleId: RoleId; chatId: string } | null, ticket?: ChampsTicket, options: OptionsFil = {}) => {
    const maintenant = new Date().toISOString();
    // Le fil tourne sur la machine de la conversation d'où il part (un fil ouvert depuis un VPS reste sur ce VPS).
    const lieu =
      options.lieu !== undefined ? options.lieu : lancePar ? lieuDeConversation(stateRef.current.chats, lancePar.chatId) : lieuParDefaut();
    const chat: Chat = {
      id: options.id ?? `${FIL}${crypto.randomUUID().slice(0, 8)}`,
      kind: "direct",
      projectId: null,
      title: titre?.trim() ? chatTitle(titre) : FIL_SANS_TITRE,
      roleIds: [roleId],
      updatedAt: maintenant,
      sessions: {},
      luJusqua: null,
      fil: { roleId, statut: "ouvert", creeLe: maintenant, lancePar: lancePar ?? null, etape: "a-faire", ...ticket },
      ...(lieu ? { lieu } : {}),
    };
    // Le fil part avec le fournisseur de l'agent qui le reçoit.
    const fournisseurAgent = rolesRef.current.find((r) => r.id === roleId)?.fournisseur;
    if (fournisseurAgent) chat.fournisseur = fournisseurAgent;
    dispatch({ type: "chat/add", chat });
    stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
    return chat.id;
  }, []);

  const renommerChat = useCallback((chatId: string, titre: string) => {
    const propre = titre.replace(/\s+/g, " ").trim().slice(0, 80);
    if (propre) dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, title: propre }) });
  }, []);

  const epinglerChat = useCallback((chatId: string, epingler: boolean) => {
    const maintenant = new Date().toISOString();
    const chats = basculerEpingle(stateRef.current.chats, chatId, epingler, maintenant);
    if (chats === stateRef.current.chats) return;
    // La fermeture peut précéder le prochain rendu et l'écriture regroupée de 400 ms.
    stateRef.current = { ...stateRef.current, chats };
    dispatch({ type: "chat/update", id: chatId, patch: (c) => avecEpingle(c, epingler, maintenant) });
    // Fermer la dernière fenêtre peut détruire le renderer avant « avantFermeture ».
    // Le main attend déjà la fin des écritures IPC avant de quitter.
    if (bridge && stateRef.current.charge) {
      if (ecritureRegroupee.current) clearTimeout(ecritureRegroupee.current);
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }
  }, [bridge]);

  const supprimerConversation = useCallback((chatId: string) => {
    const etat = stateRef.current;
    const refus = refusSuppression(etat.chats.find((c) => c.id === chatId), !!etat.travail[chatId]);
    if (refus) return refus;
    stateRef.current = sansConversation(etat, chatId);
    dispatch({ type: "chat/supprimer", id: chatId });
    // Écrite tout de suite, comme l'épingle : la fenêtre peut se fermer avant l'écriture regroupée.
    if (bridge && stateRef.current.charge) {
      if (ecritureRegroupee.current) clearTimeout(ecritureRegroupee.current);
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }
    return null;
  }, [bridge]);

  const archiverFil = useCallback(
    (chatId: string, supprime = false, libererPlace = true) => {
      // Un fil archivé s'arrête : il ne travaille plus.
      const travail = stateRef.current.travail[chatId];
      if (travail && bridge) void bridge.claude.cancel(travail.messageId);
      // Sa place dans le journal se libère (sauf si `fermer_fil` l'a déjà clos). Un refus ne bloque pas l'archivage.
      if (libererPlace && stateRef.current.chats.some((c) => c.id === chatId && c.fil)) void libererPlaceFil(bridge?.superagent?.marquer, chatId);
      dispatch({
        type: "chat/update",
        id: chatId,
        patch: (c) => (c.fil ? { ...c, fil: ferme(c.fil, supprime, new Date()) } : c),
      });
    },
    [bridge],
  );

  const rouvrirFil = useCallback((chatId: string) => {
    const aReponse = stateRef.current.messages.some((m) => m.chatId === chatId && m.author.kind === "role" && m.statut !== "en-cours");
    dispatch({
      type: "chat/update",
      id: chatId,
      patch: (c) => (c.fil ? { ...c, fil: rouvert(c.fil, aReponse) } : c),
    });
  }, []);

  const confierRappel = useCallback(
    (rappel: RappelAConfier, roleId: RoleId, idImpose?: string) => {
      const id = creerFil(roleId, rappel.titre, null, { priorite: rappel.priorite, echeance: rappel.echeance, rappel: { source: rappel.source, id: rappel.id } }, idImpose ? { id: idImpose, lieu: null } : undefined);
      timers.current.push(setTimeout(() => envoyerRef.current(id, briefDuRappel(rappel), null, []), 0));
      return id;
    },
    [creerFil],
  );

  const majTicket = useCallback((chatId: string, patch: ChampsTicket & { etape?: EtapeTicket; raison?: string | null }) => {
    const { etape, raison, ...champs } = patch;
    dispatch({
      type: "chat/update",
      id: chatId,
      patch: (c) => {
        if (!c.fil) return c;
        const fil = { ...c.fil, ...champs };
        return { ...c, fil: etape ? poserEtape(fil, etape, raison) : fil };
      },
    });
  }, []);

  /* Chaque VPS garde son espace : relu au démarrage, tenu à jour à mesure (cf. useEspaceServeurs). */
  const fusionnerEspace = useCallback((etat: EtatEspace) => {
    stateRef.current = { ...stateRef.current, ...etat };
    dispatch({ type: "espace/fusion", etat });
  }, []);
  const moteurDuServeur = useEspaceServeurs(state, stateRef, fusionnerEspace, {
    execution: (execution) => {
      stateRef.current = { ...stateRef.current, executions: [execution, ...stateRef.current.executions.filter((x) => x.id !== execution.id)] };
      dispatch({ type: "execution/enregistrer", execution });
    },
    notification: (titre, texte, workflowId) => {
      notifierRappel(titre, texte);
      pousserAuTelephone({ evenement: "workflow", titre, corps: texte, lien: lienWorkflow(workflowId) });
    },
    /* Ses travaux sans personne (workflows planifiés) suivent l'accès choisi pour ce serveur. */
    serveurLu: (lieu) => void bridge?.agents.vps?.(lieu, "reglages-ecrire", { acces: accesDuServeur(stateRef.current, lieu) }),
  });
  const moteurRef = useRef(moteurDuServeur);
  useEffect(() => {
    moteurRef.current = moteurDuServeur;
  }, [moteurDuServeur]);

  /* Les outils des fils, appelés par les agents (serveur MCP de l'app, electron/ia.ts) : une tâche = un fil. */
  useEffect(() => {
    const outils = bridge?.outils;
    if (!outils) return;
    const executer = async (nom: string, args: Record<string, unknown>, appelant: { chatId: string; roleId: string }): Promise<string> => {
      const { chats: tousChats, messages, travail, projects: tousProjets } = stateRef.current;
      /* Un agent ne voit et ne touche que les fils et les projets du serveur où il travaille. */
      const lieuAppelant = lieuDeConversation(tousChats, appelant.chatId);
      const chats = tousChats.filter((c) => dansEspace(c.lieu, lieuAppelant));
      const projects = tousProjets.filter((p) => dansEspace(p.lieu, lieuAppelant));
      const roles = rolesRef.current;
      const nomDe = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
      const filDe = (id: unknown) => {
        const fil = chats.find((c) => c.id === String(id ?? "").trim() && c.fil);
        if (!fil?.fil) throw new Error(`Aucun fil « ${String(id)} ».`);
        return fil as Chat & { fil: NonNullable<Chat["fil"]> };
      };
      const resume = (c: Chat & { fil: NonNullable<Chat["fil"]> }, travaille = !!travail[c.id]) =>
        ligneTicket(c, {
          travaille,
          agent: nomDe(c.fil.roleId),
          projet: c.fil.projetId ? (projects.find((p) => p.id === c.fil.projetId)?.name ?? c.fil.projetId) : null,
          lancePar: c.fil.lancePar ? nomDe(c.fil.lancePar.roleId) : null,
        });

      switch (nom) {
        case "ouvrir_fil": {
          const agent = String(args.agent ?? "").trim();
          const titre = String(args.titre ?? "").trim();
          const brief = String(args.brief ?? "").trim();
          if (!roles.some((r) => r.id === agent)) {
            throw new Error(`« ${agent} » n’est pas dans Mes agents : il ne peut pas recevoir de fil. Agents disponibles : ${roles.map((r) => `${r.id} (${r.name})`).join(", ")}.`);
          }
          if (!brief) throw new Error("Le brief est vide : le fil ne voit pas ta conversation, il lui faut tout.");
          const projetId = typeof args.projet === "string" && args.projet.trim() ? args.projet.trim() : null;
          if (projetId && !projects.some((p) => p.id === projetId)) {
            throw new Error(`Aucun projet « ${projetId} ». Projets : ${projects.map((p) => `${p.id} (${p.name})`).join(", ") || "aucun"}.`);
          }
          const ticket: ChampsTicket = { priorite: lirePriorite(args.priorite) ?? 0, echeance: lireEcheance(args.echeance) ?? null, projetId };
          /* Le refus nomme les fils qui tiennent les places, avec leur titre à jour dans l'app. */
          let occupants: { titre: string; id: string }[] = [];
          const attente = () => texteAttente(occupants.map((o) => ({ titre: tousChats.find((c) => c.id === o.id)?.title ?? o.titre, id: o.id })));
          if (bridge?.superagent) {
            // Les fils ouverts de l'app, tous lieux : les places des fils supprimés ou fermés sont rendues avant de compter.
            const garde = await bridge.superagent.peutOuvrir(tousChats.filter((c) => c.fil?.statut === "ouvert").map((c) => c.id));
            if (garde.ok) occupants = garde.data.occupants ?? [];
            if (garde.ok && !garde.data.ok) throw new Error(attente());
          }
          const lanceur = chats.some((c) => c.id === appelant.chatId) ? { roleId: appelant.roleId, chatId: appelant.chatId } : null;
          const id = creerFil(agent, titre || brief, lanceur, ticket, { lieu: lieuAppelant });
          if (!titre) titrer(id, brief);
          if (lanceur) {
            dispatch({ type: "chat/update", id, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: true } } : c) });
          }
          const messageId = crypto.randomUUID();
          timers.current.push(setTimeout(() => envoyerRef.current(id, brief, null, [], false, undefined, messageId), 0));
          if (bridge?.superagent) {
            const note = await bridge.superagent.ouvrir({
              filId: id,
              roleId: agent,
              messageId,
              brief,
              titre: titre || brief.slice(0, 80),
              projectId: projetId ?? "hors-projet",
              compte: stateRef.current.currentUser.id || "local",
              priorite: ticket.priorite ?? 0,
              echeance: ticket.echeance,
            });
            if (note.ok && note.data.ok === false) {
              archiverFil(id);
              throw new Error(note.data.motif === "capacite_atteinte"
                ? attente()
                : `Travail non ouvert : ${note.data.motif ?? "refus"}.`);
            }
          }
          return texteFilOuvert(titre, id, nomDe(agent), !!lanceur);
        }
        case "lister_fils": {
          const agent = typeof args.agent === "string" && args.agent ? args.agent : null;
          const etatVoulu = args.etat === undefined || args.etat === null || args.etat === "" ? null : lireEtatOutil(args.etat);
          const ouverts = chats.filter((c): c is Chat & { fil: NonNullable<Chat["fil"]> } => !!c.fil && c.fil.statut === "ouvert" && (!agent || c.fil.roleId === agent));
          const choisis = trierTickets(ouverts, (id) => !!travail[id]).filter(
            (c) => !etatVoulu || (travail[c.id] ? "en-cours" : (c.fil.etape ?? "a-faire")) === etatVoulu,
          );
          return choisis.length ? choisis.map((c) => `- ${resume(c)}`).join("\n") : "Aucun fil ouvert.";
        }
        case "lire_fil": {
          const fil = filDe(args.id);
          const derniere = messages.findLast((m) => m.chatId === fil.id && m.author.kind === "role" && m.statut !== "en-cours");
          const texte = derniere ? texteDe(derniere) || derniere.erreur || "" : "";
          return `${resume(fil)}\n\n${texte ? `Dernière réponse :\n${texte.slice(-8000)}` : "Pas encore de réponse."}`;
        }
        case "ecrire_dans_fil": {
          const fil = filDe(args.id);
          const message = String(args.message ?? "").trim();
          if (!message) throw new Error("Le message est vide.");
          if (fil.fil.statut === "archive") throw new Error("Ce fil est fermé : demande à la personne de le rouvrir, ou ouvre-en un autre.");
          if (fil.fil.suspendu) throw new Error("Ce travail est suspendu ou clos : aucun nouveau départ.");
          if (bridge?.superagent) {
            const etat = await bridge.superagent.etat(fil.id);
            if (etat.ok && etat.data && (etat.data.status === "suspended" || etat.data.status === "cancelled" || etat.data.status === "done")) {
              throw new Error("Ce travail est suspendu ou clos : aucun nouveau départ.");
            }
          }
          if (fil.fil.lancePar?.chatId === appelant.chatId) {
            dispatch({ type: "chat/update", id: fil.id, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: true } } : c) });
          }
          const messageId = crypto.randomUUID();
          envoyerRef.current(fil.id, message, null, [], false, undefined, messageId);
          if (bridge?.superagent) {
            void bridge.superagent.message({
              filId: fil.id,
              messageId,
              texte: message,
              auteur: "user",
              projectId: fil.fil.projetId ?? "hors-projet",
              compte: stateRef.current.currentUser.id || "local",
            });
          }
          return travail[fil.id] ? "Ajouté : il le lira après sa réponse en cours." : "Envoyé : il s’y met.";
        }
        case "mettre_a_jour_fil": {
          const fil = filDe(args.id);
          if (fil.fil.statut === "archive") throw new Error("Ce fil est fermé : demande à la personne de le rouvrir.");
          if (!peutMettreAJour(fil.fil, appelant.roleId)) throw new Error("Seuls l’agent du fil et celui qui l’a lancé mettent son état à jour.");
          const etape = lireEtatOutil(args.etat);
          const raison = typeof args.raison === "string" ? args.raison.trim() : "";
          if (etape === "bloque" && !raison) throw new Error("Dis pourquoi c’est bloqué (raison) : c’est ce que la personne lira.");
          const suite = { ...fil, fil: poserEtape(fil.fil, etape, raison) };
          dispatch({ type: "chat/update", id: fil.id, patch: (c) => (c.fil ? { ...c, fil: poserEtape(c.fil, etape, raison) } : c) });
          if (etape === "bloque") void bridge?.superagent?.marquer(fil.id, "blocked", null);
          // L'étape posée, même si la réponse en cours la montre encore « en cours ».
          return `À jour : ${resume(suite, false)}`;
        }
        case "arreter_fil": {
          const fil = filDe(args.id);
          const tournait = !!travail[fil.id];
          if (tournait) arreter(fil.id);
          if (bridge?.superagent) {
            void bridge.superagent.marquer(fil.id, "suspended", null);
            return "Arrêté. Le fil reste ouvert. Aucun nouveau départ tant qu’il n’est pas repris après contrôle.";
          }
          if (!tournait) return "Il ne travaillait pas.";
          return "Arrêté. Le fil reste ouvert. Aucun nouveau départ tant qu’il n’est pas repris après contrôle.";
        }
        case "reprendre_fil": {
          const fil = filDe(args.id);
          const controle = typeof args.controle === "string" ? args.controle.trim() : "";
          if (!controle) throw new Error("La reprise demande la référence du contrôle.");
          // Arrêté sur le VPS pendant que ce PC était fermé : la reprise lève l'arrêt.
          if (fil.fil.suspendu) dispatch({ type: "chat/update", id: fil.id, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, suspendu: false } } : c) });
          if (!bridge?.superagent) throw new Error("Le journal des travaux est dans l’app de bureau.");
          const marque = await bridge.superagent.marquer(fil.id, "active", controle);
          if (!marque.ok) throw new Error(marque.message);
          if (marque.data.ok === false) {
            throw new Error(marque.data.motif === "travail_clos"
              ? "Ce travail est terminé ou annulé : il ne reprend pas."
              : `Reprise refusée : ${marque.data.motif ?? "refus"}.`);
          }
          return `Repris : ${resume(fil)}`;
        }
        case "fermer_fil": {
          const fil = filDe(args.id);
          if (!peutFermer(fil.fil, appelant.roleId)) {
            const par = fil.fil.lancePar ? nomDe(fil.fil.lancePar.roleId) : "la personne";
            throw new Error(`Ce fil a été ouvert par ${par} : c’est à ${par} de le valider et de le fermer. Mets-le « à valider » avec mettre_a_jour_fil.`);
          }
          if (bridge?.superagent) {
            const cloture = await bridge.superagent.marquer(fil.id, "done", null);
            if (cloture.ok && cloture.data.ok === false && cloture.data.motif !== undefined) {
              throw new Error(cloture.data.motif === "operations_a_verifier"
                ? "Des opérations sont encore à vérifier : le fil reste ouvert."
                : `Fermeture refusée : ${cloture.data.motif}.`);
            }
          }
          archiverFil(fil.id, false, false);
          return `Fil fermé et archivé : ${fil.title} (${fil.id}). Il peut être rouvert.`;
        }
        case "publier_artefact": {
          const publication = lirePublication(args);
          if (!bridge) throw new Error("La publication marche dans l’app de bureau.");
          const avant = renduDeLOrigine(stateRef.current.rendus, publication.chemin);
          // L'app garde sa copie dans l'espace de l'agent : le livrable survit au ménage de son dossier.
          const copie = await bridge.rendus.copier(publication.chemin, appelant.roleId, avant?.chemin ?? null);
          if (!copie.ok) throw new Error(copie.message);
          const chat = chats.find((c) => c.id === appelant.chatId);
          const maintenant = new Date().toISOString();
          dispatch({
            type: "rendu/publier",
            rendu: {
              id: crypto.randomUUID(),
              chemin: copie.data.chemin,
              origine: publication.chemin,
              taille: copie.data.taille,
              titre: publication.titre,
              description: publication.description,
              type: copie.data.dossier ? "page" : typeDeRendu(publication.chemin),
              roleId: appelant.roleId,
              chatId: chat?.id ?? null,
              projectId: chat?.projectId ?? null,
              ajouteLe: maintenant,
              misAJour: maintenant,
            },
          });
          return `Publié dans Artefacts : « ${publication.titre} ». L’app en garde une copie dans Mes artefacts de cet espace ; elle n’est pas partagée à l’équipe. Republier le même fichier remplace cette copie.`;
        }
        case "lister_workflows":
        case "lire_workflow":
        case "construire_workflow":
        case "lancer_workflow":
          // Les workflows vivent ici : les agents de ce PC et ceux d'un VPS (relayés) passent par le même chemin.
          return outilsWorkflows().executer(nom, args, appelant);
        case "proposer_agent":
        case "proposer_choix": {
          // Le même appel que sur un VPS (electron/atelier-agent.ts) : refus, carte suivie, ce que l'outil répond.
          const equipe = roles.map((r) => ({ id: r.id, noms: [r.name, r.tag] }));
          const r = appelAtelier(nom, args, atelierEnCours(messages.filter((m) => m.chatId === appelant.chatId)), equipe);
          if (r.erreur) throw new Error(r.texte);
          return r.texte;
        }
        case "proposer_equipe": {
          // Le même appel que sur un VPS (electron/atelier-equipe.ts).
          const equipe = roles.map((r) => ({ id: r.id, noms: [r.name, r.tag] }));
          const r = appelEquipe(args, equipeEnCours(messages.filter((m) => m.chatId === appelant.chatId)), equipe);
          if (r.erreur) throw new Error(r.texte);
          return r.texte;
        }
        default:
          throw new Error("Outil inconnu.");
      }
    };
    return outils.onAppel((id, nom, args, appelant) => {
      void (async () => {
        try {
          outils.repondre(id, true, await executer(nom, args, appelant));
        } catch (e) {
          outils.repondre(id, false, e instanceof Error ? e.message : String(e));
        }
      })();
    });
  }, [bridge, creerFil, archiverFil, arreter, titrer, outilsWorkflows]);

  const nouvelleConversation = useCallback((chatId: string) => {
    if (stateRef.current.travail[chatId]) return;
    dispatch({ type: "chat/vider", id: chatId, le: new Date().toISOString() });
  }, []);

  const repartir = useCallback((chatId: string) => {
    const { travail, chats, messages } = stateRef.current;
    const chat = chats.find((c) => c.id === chatId);
    if (!chat || travail[chatId] || !peutRepartir(chat, messages.filter((m) => m.chatId === chatId))) return;
    dispatch({ type: "chat/repartir", id: chatId, le: new Date().toISOString() });
  }, []);

  const retirerDeLaFile = useCallback(
    (chatId: string, id: string) => {
      // Une exécution de routine retirée de la file : le moteur l'annule, sinon l'agent resterait réservé.
      const routineRun = stateRef.current.file[chatId]?.find((m) => m.id === id)?.routineRun;
      if (routineRun) void bridge?.routines?.interrompre(routineRun);
      dispatch({ type: "file/retirer", chatId, id });
    },
    [bridge],
  );

  const marquerLu = useCallback((chatId: string) => {
    const dernier = stateRef.current.messages.findLast((m) => m.chatId === chatId);
    const chat = stateRef.current.chats.find((c) => c.id === chatId);
    if (!dernier || !chat || (chat.luJusqua && chat.luJusqua >= dernier.createdAt)) return;
    dispatch({
      type: "chat/update",
      id: chatId,
      patch: (c) => ({ ...c, luJusqua: dernier.createdAt }),
    });
  }, []);

  /* ─── Planning ─────────────────────────────────────────────── */

  /** Lance une routine : sa consigne part à son agent. Une routine en chaîne, ou
   *  rangée dans un projet, a sa conversation d'équipe, avec tous les agents de la chaîne. */
  const chatDeRoutine = useCallback(
    (routine: { id: string; nom: string; roleId: RoleId; projectId: string | null; relais?: RelaisRoutine[] }) => {
      const relais = routine.relais ?? [];
      if (!routine.projectId && relais.length === 0) return idDirect(routine.roleId, null, stateRef.current.chats);
      const chatId = `routine-${routine.id}`;
      const roleIds = [...new Set<RoleId>(["principal", routine.roleId, ...relais.flatMap((l) => [l.de, l.vers])])];
      const existant = stateRef.current.chats.find((c) => c.id === chatId);
      if (!existant) {
        const chat: Chat = {
          id: chatId,
          kind: "equipe",
          projectId: routine.projectId,
          title: routine.nom,
          roleIds,
          updatedAt: new Date().toISOString(),
          sessions: {},
          luJusqua: null,
        };
        dispatch({ type: "chat/add", chat });
        stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
      } else if (roleIds.some((id) => !existant.roleIds.includes(id))) {
        // Un agent ajouté à la chaîne entre dans la conversation.
        const patch = (c: Chat): Chat => ({ ...c, roleIds: [...new Set([...c.roleIds, ...roleIds])] });
        dispatch({ type: "chat/update", id: chatId, patch });
        stateRef.current = { ...stateRef.current, chats: stateRef.current.chats.map((c) => (c.id === chatId ? patch(c) : c)) };
      }
      return chatId;
    },
    [],
  );

  /* Le moteur du process principal (electron/routines/) : ses exécutions partent ici par le chemin
     habituel des messages. */
  useLivraisonRoutines({
    bridge: moteurRoutines ? bridge : null,
    // Les fiches des agents lues sur le disque : un agent pas encore chargé (ou une lecture
    // en erreur) n'est pas un agent introuvable. Les exécutions attendent.
    pret: state.charge && statutAgents === "disque",
    messages: state.messages,
    file: state.file,
    poster: (run, routine) => {
      if (!rolesRef.current.some((r) => r.id === run.agentId)) return null;
      const chatId = chatDeRoutine({
        id: run.routineId,
        nom: run.routineName,
        roleId: run.agentId,
        projectId: run.projectId,
        relais: routine?.relais,
      });
      envoyerRef.current(chatId, `Routine « ${run.routineName} »\n\n${run.instruction}`, run.agentId, [], false, run.id);
      return chatId;
    },
    lire: () => stateRef.current,
    retirerDeFile: (chatId, id) => dispatch({ type: "file/retirer", chatId, id }),
    texte: texteDe,
  });

  const enregistrerRoutine = useCallback((routine: Routine) => {
    dispatch({ type: "routine/enregistrer", routine });
  }, []);
  const supprimerRoutine = useCallback((id: string) => dispatch({ type: "routine/supprimer", id }), []);
  const lancerRoutine = useCallback(
    (id: string) => {
      void bridge?.routines?.executer(id);
    },
    [bridge],
  );

  const ajouterArtefact = useCallback((artefact: Omit<Artefact, "id" | "ajouteLe">) => {
    dispatch({
      type: "artefact/ajouter",
      artefact: { ...artefact, id: crypto.randomUUID(), ajouteLe: new Date().toISOString() },
    });
  }, []);
  const supprimerArtefact = useCallback((id: string) => dispatch({ type: "artefact/supprimer", id }), []);
  /* Retirer un livrable supprime la copie de l'app ; l'original de l'agent reste où il était. */
  const retirerRendu = useCallback((id: string) => {
    const rendu = stateRef.current.rendus.find((r) => r.id === id);
    if (rendu?.chemin) void bridge?.rendus.supprimer(rendu.chemin);
    dispatch({ type: "rendu/retirer", id });
  }, [bridge]);
  const choisirArtefactsClaude = useCallback((actif: boolean) => dispatch({ type: "artefacts-claude/choisir", actif }), []);
  const modifierArtefact = useCallback(
    (id: string, patch: Partial<Artefact>) => dispatch({ type: "artefact/modifier", id, patch }),
    [],
  );
  const synchroniserArtefacts = useCallback(async () => {
    if (!bridge) throw new Error("La synchronisation marche dans l’app de bureau.");
    const r = await bridge.artefacts.lister();
    if (!r.ok) throw new Error(r.message);
    const connus = new Set(stateRef.current.artefacts.map((a) => a.url.replace(/\/$/, "")));
    dispatch({ type: "artefact/synchroniser", liste: r.data });
    return { total: r.data.length, nouveaux: r.data.filter((a) => !connus.has(a.url.replace(/\/$/, ""))).length };
  }, [bridge]);

  const enregistrerProjet = useCallback((project: Project) => dispatch({ type: "projet/enregistrer", project }), []);
  const retirerProjet = useCallback((id: string) => dispatch({ type: "projet/supprimer", id }), []);
  const enregistrerProfil = useCallback((user: User) => dispatch({ type: "profil/enregistrer", user }), []);
  const modifierProfil = useCallback((patch: Partial<User>) => dispatch({ type: "profil/modifier", patch }), []);
  const appliquerProfilCompte = useCallback((profil: ProfilCompte | null) => dispatch({ type: "compte/profil", profil }), []);
  const poserEvenementsCompte = useCallback((evenements: Evenement[] | null) => dispatch({ type: "compte/evenements", evenements }), []);
  const choisirAcces = useCallback((acces: Acces, lieu: string | null = null) => {
    dispatch({ type: "acces/choisir", acces, lieu });
    if (lieu) void bridge?.agents.vps?.(lieu, "reglages-ecrire", { acces });
  }, [bridge]);
  /* Les actions de rappels sont visibles immédiatement par les notifications,
     le prochain clic (ou blur) et la fermeture, avant le prochain rendu React. */
  const agirRappel = useCallback((action: Extract<WorkspaceAction, { type: "tache/enregistrer" | "tache/supprimer" | "tache/restaurer" | "tache/oublierSuppressions" | "tache/notifiee" }>) => {
    stateRef.current = reducer(stateRef.current, action);
    dispatch(action);
  }, []);
  const enregistrerTache = useCallback((tache: Tache) => agirRappel({ type: "tache/enregistrer", tache }), [agirRappel]);
  const supprimerTache = useCallback((id: string) => agirRappel({ type: "tache/supprimer", id }), [agirRappel]);
  const oublierSuppressions = useCallback(() => agirRappel({ type: "tache/oublierSuppressions" }), [agirRappel]);
  const restaurerTaches = useCallback(() => {
    const avant = stateRef.current;
    const rendus = avant.rappelsSupprimes.filter(({ tache }) => !avant.taches.some((t) => t.id === tache.id));
    if (!avant.rappelsSupprimes.length) return [];
    agirRappel({ type: "tache/restaurer" });
    if (bridge && stateRef.current.charge) {
      if (ecritureRegroupee.current !== null) clearTimeout(ecritureRegroupee.current);
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }
    return rendus;
  }, [agirRappel, bridge]);
  const enregistrerEvenement = useCallback((evenement: Evenement) => dispatch({ type: "evenement/enregistrer", evenement }), []);
  const supprimerEvenement = useCallback((id: string) => dispatch({ type: "evenement/supprimer", id }), []);
  const changerCategories = useCallback(
    (categories: Categorie[]) => dispatch({ type: "categories/changer", categories }),
    [],
  );

  /* Rappels : une notification macOS à l'heure d'une tâche, et 10 min avant un événement.
     Vérifié toutes les 30 s tant que l'app est ouverte. */
  useEffect(() => {
    if (!state.charge || typeof Notification === "undefined") return;
    const verifier = () => {
      const maintenant = Date.now();
      for (const t of stateRef.current.taches) {
        if (t.faite || t.notifiee || !t.date || !t.heure) continue;
        if (new Date(`${t.date}T${t.heure}`).getTime() > maintenant) continue;
        const categorie = stateRef.current.categories.find((c) => c.id === t.liste)?.nom ?? "Rappel";
        notifierRappel(t.titre, t.notes || categorie, () => {
          // Les réglages sont lus de façon asynchrone : la personne a pu supprimer,
          // cocher ou reporter le rappel entre-temps. Jamais de recréation.
          const actuel = stateRef.current.taches.find((r) => r.id === t.id);
          if (!actuel || actuel.faite || actuel.notifiee || !actuel.date || !actuel.heure ||
              new Date(actuel.date + "T" + actuel.heure).getTime() > Date.now()) return false;
          agirRappel({ type: "tache/notifiee", id: t.id });
          return true;
        });
      }
      /* Les rendez-vous d'équipe : une notification par occurrence, retenue le temps de la session.
         L'horizon couvre le lendemain : un rendez-vous à 00:05 se signale dès 23:55. */
      const horizon = new Date(maintenant + 86_400_000);
      const fin = new Date(horizon.getFullYear(), horizon.getMonth(), horizon.getDate() + 1);
      const comptePret = stateRef.current.profilCompte !== null && stateRef.current.evenementsCompte !== null;
      for (const e of rendezVousEntre(comptePret, stateRef.current.evenementsCompte, new Date(maintenant), fin)) {
        if (!e.debut) continue;
        const debut = new Date(`${e.date}T${e.debut}`).getTime();
        if (notifiesEquipe.current.has(e.id) || debut - 10 * 60_000 > maintenant || debut < maintenant) continue;
        notifiesEquipe.current.add(e.id);
        notifierRappel(e.titre, `À ${e.debut} · ${e.notes}`);
      }
      for (const e of stateRef.current.evenements) {
        if (e.notifie || !e.debut) continue;
        const debut = new Date(`${e.date}T${e.debut}`).getTime();
        if (debut - 10 * 60_000 > maintenant || debut < maintenant - 60 * 60_000) continue;
        notifierRappel(e.titre, `À ${e.debut}${e.notes ? ` · ${e.notes}` : ""}`);
        dispatch({ type: "evenement/enregistrer", evenement: { ...e, notifie: true } });
      }
    };
    verifier();
    const id = setInterval(verifier, 30_000);
    return () => clearInterval(id);
  }, [state.charge, agirRappel]);

  const repondreAutorisation = useCallback(
    (messageId: string, demandeId: string, decision: "oui" | "toujours" | "non") => {
      if (!bridge) return;
      const accepte = decision !== "non";
      // L'accord donné à un agent : une validation qui s'entend.
      if (accepte) jouer("validation");
      dispatch({
        type: "message/update",
        id: messageId,
        patch: (m) => ({
          ...m,
          parts: m.parts.map((p) =>
            p.type === "autorisation" && p.id === demandeId ? { ...p, statut: accepte ? "acceptee" : "refusee" } : p,
          ),
        }),
      });
      void bridge.claude.autoriser(messageId, demandeId, decision);
    },
    [bridge],
  );

  const marquerAtelier = useCallback((messageId: string, etapeId: string, patch: PatchAtelier | ((part: PartAtelier) => PatchAtelier)) => {
    dispatch({
      type: "message/update",
      id: messageId,
      patch: (m) => ({
        ...m,
        parts: m.parts.map((p) => (p.type === "atelier-agent" && p.etapeId === etapeId ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)),
      }),
    });
  }, []);

  const marquerEquipe = useCallback((messageId: string, etapeId: string, patch: PatchEquipe | ((part: PartEquipe) => PatchEquipe)) => {
    dispatch({
      type: "message/update",
      id: messageId,
      patch: (m) => ({
        ...m,
        parts: m.parts.map((p) => (p.type === "atelier-equipe" && p.etapeId === etapeId ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)),
      }),
    });
  }, []);

  const repondreCarte = useCallback((messageId: string, etapeId: string, reponse: ReponseCarte) => {
    const le = new Date().toISOString();
    dispatch({
      type: "message/update",
      id: messageId,
      patch: (m) => ({
        ...m,
        parts: m.parts.map((p) => (p.type === "carte" && p.etapeId === etapeId ? { ...p, reponse: { ...reponseNette(p.carte, reponse), le } } : p)),
      }),
    });
  }, []);

  const repondreCoffre = useCallback((messageId: string, etapeId: string, etat: "rangee" | "permise" | "refusee") => {
    const le = new Date().toISOString();
    dispatch({
      type: "message/update",
      id: messageId,
      patch: (m) => ({ ...m, parts: m.parts.map((p) => (p.type === "coffre-demande" && p.etapeId === etapeId ? { ...p, reponse: { etat, le } } : p)) }),
    });
  }, []);

  /* Premier lancement : le profil part du nom de la session Mac. */
  useEffect(() => {
    if (!bridge || !state.charge || state.currentUser.name) return;
    let actif = true;
    void bridge.systeme.utilisateur().then((r) => {
      if (!actif || !r.ok) return;
      // Le prénom : le mot du nom complet qui correspond à l'identifiant de session
      // (« Bagcaci Pelin » + « pelin » → « Pelin »), sinon le premier mot.
      const mots = r.data.nom.split(/\s+/).filter(Boolean);
      const name =
        mots.find((m) => m.toLowerCase() === r.data.identifiant.toLowerCase()) ??
        mots[0] ??
        r.data.identifiant.charAt(0).toUpperCase() + r.data.identifiant.slice(1);
      dispatch({
        type: "profil/enregistrer",
        user: { id: r.data.identifiant, name, title: "KLYRA", initial: name.charAt(0).toUpperCase() },
      });
    });
    return () => {
      actif = false;
    };
  }, [bridge, state.charge, state.currentUser.name]);


  /* ─── Workflows ────────────────────────────────────────────── */

  const controleurs = useRef(new Map<string, AbortController>());
  const approbations = useRef(new Map<string, (ok: boolean) => void>());
  /* Les étapes Agent qui attendent la réponse de leur agent. */
  const attentesAgent = useRef<{ chatId: string; roleId: RoleId; depuis: string; resoudre: (r: Resultat) => void }[]>([]);
  useEffect(() => {
    if (!attentesAgent.current.length) return;
    attentesAgent.current = attentesAgent.current.filter((a) => {
      const reponse = state.messages.find(
        (m) =>
          m.chatId === a.chatId &&
          m.author.kind === "role" &&
          m.author.roleId === a.roleId &&
          m.createdAt >= a.depuis &&
          m.statut !== "en-cours",
      );
      if (!reponse) return true;
      a.resoudre(
        reponse.statut === "erreur"
          ? { ok: false, erreur: reponse.erreur ?? "L’agent s’est arrêté sur une erreur." }
          : { ok: true, texte: texteDe(reponse) },
      );
      return false;
    });
  }, [state.messages]);

  /** Un appel au modèle, sans conversation ni outil (étapes LLM et conditions). */
  const appelLibre = useCallback(
    (o: { prompt: string; systeme: string; modele: string | null; effort: string | null; signal: AbortSignal; lieu?: string | null }) =>
      new Promise<Resultat>((resoudre) => {
        if (!bridge) {
          setTimeout(() => resoudre({ ok: true, texte: "OUI. (Réponse simulée : l’app n’est pas ouverte sur le bureau.)" }), 800);
          return;
        }
        const id = crypto.randomUUID();
        let texte = "";
        ecouteurs.current.set(id, (event) => {
          if (event.type === "texte") texte += event.delta;
          // Pas d'outils ici : toute demande est refusée d'office.
          else if (event.type === "autorisation") void bridge.claude.autoriser(id, event.id, "non");
          else if (event.type === "fin") {
            ecouteurs.current.delete(id);
            resoudre(
              event.ok
                ? { ok: true, texte: (texte || event.texte).trim() }
                : { ok: false, erreur: event.erreur ?? "Le modèle n’a pas répondu." },
            );
          }
        });
        o.signal.addEventListener("abort", () => void bridge.claude.cancel(id));
        const prompt = o.systeme.trim() ? `[Consigne système]\n${o.systeme.trim()}\n\n[Demande]\n${o.prompt}` : o.prompt;
        void bridge.claude
          .stream(id, { agent: null, prompt, dossier: null, sessionId: null, modele: o.modele, effort: o.effort, acces: "demander", lieu: o.lieu ?? null })
          .then((r) => {
            if (r.ok) return;
            ecouteurs.current.delete(id);
            resoudre({ ok: false, erreur: r.message });
          });
      }),
    [bridge],
  );

  /** Ce que le moteur peut faire, pour un workflow : ses agents travaillent dans sa conversation. */
  const outilsPour = useCallback(
    (wf: Workflow): Outils => {
      const chatId = `wf-${wf.id}`;
      const assurerChat = (id: string, titre: string, roleIds: RoleId[]) => {
        const existant = stateRef.current.chats.find((c) => c.id === id);
        if (!existant) {
          const chat: Chat = {
            id,
            kind: "equipe",
            projectId: wf.projectId,
            title: titre,
            roleIds: [...new Set<RoleId>(["principal", ...roleIds])],
            updatedAt: new Date().toISOString(),
            sessions: {},
            luJusqua: null,
            /* Les agents d'un workflow travaillent sur son serveur. */
            ...(wf.lieu ? { lieu: wf.lieu } : {}),
          };
          dispatch({ type: "chat/add", chat });
          stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
        } else if (roleIds.some((r) => !existant.roleIds.includes(r))) {
          const patch = (c: Chat): Chat => ({ ...c, roleIds: [...new Set([...c.roleIds, ...roleIds])] });
          dispatch({ type: "chat/update", id, patch });
          stateRef.current = { ...stateRef.current, chats: stateRef.current.chats.map((c) => (c.id === id ? patch(c) : c)) };
        }
      };
      return {
        agent: ({ roleId, consigne, fichiers, signal }) =>
          new Promise<Resultat>((resoudre) => {
            assurerChat(chatId, `Workflow · ${wf.titre}`, [roleId]);
            attentesAgent.current.push({ chatId, roleId, depuis: new Date().toISOString(), resoudre });
            signal.addEventListener("abort", () => resoudre({ ok: false, erreur: "Arrêté." }));
            envoyerRef.current(chatId, `Workflow « ${wf.titre} »\n\n${consigne}`, roleId, fichiers);
          }),
        llm: (o) => appelLibre({ ...o, lieu: wf.lieu ?? null }),
        notifier: (titre, texte) => {
          pousserAuTelephone({ evenement: "workflow", titre, corps: texte, lien: lienWorkflow(wf.id) });
          // Les Réglages peuvent couper les notifications des workflows, ou leur son : alors celui de KLYRA.
          void reglagesActuels().then(({ notifications: n }) => {
            if (!n.actives || !n.workflow) return;
            const systeme = typeof Notification !== "undefined";
            if (systeme) new Notification(titre, { body: texte, silent: !n.son });
            if (!systeme || !n.son) jouer("notification");
          });
        },
        conversation: (titre, texte) => {
          const id = `wf-sortie-${wf.id}`;
          assurerChat(id, titre, []);
          dispatch({
            type: "message/add",
            message: {
              id: crypto.randomUUID(),
              chatId: id,
              author: { kind: "role", roleId: "principal" },
              createdAt: new Date().toISOString(),
              parts: [{ type: "text", text: texte || "(vide)" }],
              statut: "fait",
            },
          });
          return { ok: true, texte: `Publié dans la conversation « ${titre} ».` };
        },
        ecrireFichier: async (chemin, texte) => {
          const ecrire = bridge?.fichiers.ecrire;
          if (!ecrire) return { ok: false, erreur: "Relance l’app une fois pour qu’elle puisse écrire des fichiers." };
          /* Le fichier d'un workflow d'un VPS s'écrit sur ce VPS. */
          const r = await ecrire(chemin, texte, wf.lieu ?? null);
          return r.ok ? { ok: true, texte: `Écrit dans ${r.data}.` } : { ok: false, erreur: r.message };
        },
        approbation: (etapeId, signal) =>
          new Promise<boolean>((resoudre) => {
            approbations.current.set(etapeId, resoudre);
            signal.addEventListener("abort", () => resoudre(false));
            notifierRappel(`${wf.titre} attend ton accord`, "Ouvre le workflow pour approuver ou refuser.");
            pousserAuTelephone({ evenement: "accord", titre: `${wf.titre} attend ton accord`, corps: "Ouvre le workflow pour approuver ou refuser.", lien: lienWorkflow(wf.id) });
          }),
      };
    },
    [appelLibre, bridge],
  );

  /** Garde une version du graphe (au plus 50). */
  const avecVersion = (wf: Workflow, raison: VersionWorkflow["raison"]): Workflow => ({
    ...wf,
    versions: [{ id: crypto.randomUUID(), at: new Date().toISOString(), raison, graphe: wf.graphe }, ...wf.versions].slice(0, 50),
  });

  const enregistrerWorkflow = useCallback((workflow: Workflow) => {
    const avant = stateRef.current.workflows.find((w) => w.id === workflow.id);
    const derniere = workflow.versions[0]?.at;
    const auto =
      avant &&
      avant.graphe !== workflow.graphe &&
      (!derniere || Date.now() - new Date(derniere).getTime() > 5 * 60_000);
    const suite = { ...(auto ? avecVersion({ ...workflow, graphe: avant.graphe }, "auto") : workflow), graphe: workflow.graphe, majLe: new Date().toISOString() };
    dispatch({ type: "workflow/enregistrer", workflow: suite });
    stateRef.current = {
      ...stateRef.current,
      workflows: stateRef.current.workflows.some((w) => w.id === suite.id)
        ? stateRef.current.workflows.map((w) => (w.id === suite.id ? suite : w))
        : [...stateRef.current.workflows, suite],
    };
  }, []);
  const supprimerWorkflow = useCallback((id: string) => {
    for (const e of stateRef.current.executions) if (e.workflowId === id) controleurs.current.get(e.id)?.abort();
    dispatch({ type: "workflow/supprimer", id });
  }, []);

  const lancerWorkflow = useCallback(
    (
      id: string,
      options: { declencheurId?: string | null; source?: SourceExecution; charge?: string; seule?: string; lancePar?: { roleId: string; chatId: string } } = {},
    ) => {
      const trouve = stateRef.current.workflows.find((w) => w.id === id);
      if (!trouve) return null;
      const surServeur = trouve.lieu ? moteurRef.current(trouve.lieu) : "app";
      const wf = options.seule ? trouve : avecVersion(trouve, "execution");
      if (wf !== trouve) {
        dispatch({ type: "workflow/enregistrer", workflow: wf });
        stateRef.current = { ...stateRef.current, workflows: stateRef.current.workflows.map((w) => (w.id === id ? wf : w)) };
      }
      const precedentes = stateRef.current.executions.filter((e) => e.workflowId === id);
      /* Pour une étape seule : la dernière sortie de chaque nœud. */
      const sortiesConnues: Record<string, { texte: string; fichiers?: string[] }> = {};
      for (const e of [...precedentes].reverse())
        for (const x of e.etapes) if (x.statut === "fait") sortiesConnues[x.noeudId] = { texte: x.sortie ?? "", fichiers: x.fichiers };
      const exec: ExecutionWorkflow = {
        id: crypto.randomUUID(),
        workflowId: id,
        numero: Math.max(0, ...precedentes.map((e) => e.numero)) + 1,
        declencheurId: options.declencheurId ?? null,
        seule: options.seule,
        source: options.source ?? "manuel",
        statut: "en-cours",
        erreur: null,
        debut: new Date().toISOString(),
        fin: null,
        etapes: [],
        chatId: `wf-${id}`,
        ...(options.lancePar ? { lancePar: options.lancePar } : {}),
      };
      const maj = (e: ExecutionWorkflow) => {
        dispatch({ type: "execution/enregistrer", execution: e });
        stateRef.current = {
          ...stateRef.current,
          executions: [e, ...stateRef.current.executions.filter((x) => x.id !== e.id)],
        };
      };
      maj(exec);
      /* Ce serveur fait tourner ses workflows : il reçoit la demande, et annonce l'avancée (cf. useEspaceServeurs). */
      if (trouve.lieu && surServeur !== "app") {
        const lieu = trouve.lieu;
        const echec = (erreur: string) => maj({ ...exec, statut: "erreur", erreur, fin: new Date().toISOString() });
        const pont = bridge?.espace;
        if (!pont || surServeur === "inconnu") echec("Ce serveur ne répond pas : le workflow n’a pas pu partir.");
        else {
          void pont
            .workflows(lieu, "lancer", {
              workflow: wf,
              options: { id: exec.id, declencheurId: exec.declencheurId, source: exec.source, charge: options.charge, seule: options.seule, lancePar: options.lancePar, acces: accesDuServeur(stateRef.current, lieu) },
            })
            .then((r) => {
              if (!r.ok) echec(r.message);
            });
        }
        return exec.id;
      }
      const ctrl = new AbortController();
      controleurs.current.set(exec.id, ctrl);
      void executer(exec, { wf, outils: outilsPour(wf), maj, signal: ctrl.signal, charge: options.charge, sortiesConnues }).finally(() =>
        controleurs.current.delete(exec.id),
      );
      return exec.id;
    },
    [outilsPour, bridge],
  );
  useEffect(() => {
    lancerWorkflowRef.current = lancerWorkflow;
  }, [lancerWorkflow]);
  /** Le serveur qui fait tourner cette exécution, s'il y en a un. */
  const serveurDe = useCallback((e: ExecutionWorkflow | undefined) => {
    const lieu = e ? stateRef.current.workflows.find((w) => w.id === e.workflowId)?.lieu : null;
    return lieu && moteurRef.current(lieu) === "serveur" ? lieu : null;
  }, []);
  const arreterExecution = useCallback((id: string) => {
    const e = stateRef.current.executions.find((x) => x.id === id);
    const lieu = serveurDe(e);
    if (lieu) {
      void bridge?.espace?.workflows(lieu, "arreter", { id });
      return;
    }
    controleurs.current.get(id)?.abort();
    if (e?.chatId) arreter(e.chatId);
  }, [arreter, bridge, serveurDe]);
  const deciderApprobation = useCallback((etapeId: string, approuver: boolean) => {
    const lieu = serveurDe(stateRef.current.executions.find((e) => e.etapes.some((s) => s.id === etapeId)));
    if (lieu) {
      void bridge?.espace?.workflows(lieu, "decider", { etapeId, approuver });
      return;
    }
    approbations.current.get(etapeId)?.(approuver);
    approbations.current.delete(etapeId);
  }, [bridge, serveurDe]);

  /* Les déclencheurs planifiés : toutes les 30 s, ceux dont l'heure est passée partent. */
  useEffect(() => {
    if (!state.charge) return;
    const verifier = () => {
      const maintenant = new Date();
      for (const wf of stateRef.current.workflows) {
        /* Ceux d'un serveur partent de lui, même cet ordinateur éteint. */
        if (wf.lieu && moteurRef.current(wf.lieu) !== "app") continue;
        let prochaines = wf.prochaines ?? {};
        let change = false;
        for (const n of wf.graphe.noeuds) {
          if (n.type !== "declencheur" || n.champs.declencheur !== "planifie" || !n.frequence) continue;
          const due = prochaines[n.id];
          if (!due) {
            prochaines = { ...prochaines, [n.id]: prochainPassage(n.frequence, maintenant).toISOString() };
            change = true;
            continue;
          }
          if (new Date(due) > maintenant) continue;
          prochaines = { ...prochaines, [n.id]: prochainPassage(n.frequence, maintenant).toISOString() };
          change = true;
          lancerWorkflow(wf.id, { declencheurId: n.id, source: "planifie" });
        }
        if (change) {
          const suite = { ...(stateRef.current.workflows.find((w) => w.id === wf.id) ?? wf), prochaines };
          dispatch({ type: "workflow/enregistrer", workflow: suite });
          stateRef.current = { ...stateRef.current, workflows: stateRef.current.workflows.map((w) => (w.id === wf.id ? suite : w)) };
        }
      }
    };
    verifier();
    const id = setInterval(verifier, 30_000);
    return () => clearInterval(id);
  }, [state.charge, lancerWorkflow]);

  /* Les webhooks locaux : un appel sur l'adresse d'un déclencheur lance son workflow. */
  useEffect(() => {
    const ecouter = bridge?.webhooks?.onAppel;
    if (!ecouter) return;
    return ecouter((secret, corps) => {
      for (const wf of stateRef.current.workflows)
        for (const [noeudId, s] of Object.entries(wf.webhooks ?? {}))
          if (s === secret && (!wf.lieu || moteurRef.current(wf.lieu) === "app")) lancerWorkflow(wf.id, { declencheurId: noeudId, source: "webhook", charge: corps });
    });
  }, [bridge, lancerWorkflow]);

  const value = useMemo(
    () => ({
      state,
      sendMessage,
      choisirModele,
      choisirCompteClaude,
      masquerConseilContexte,
      choisirFournisseur,
      basculerMachine,
      nouvelleConversation,
      repartir,
      creerFil,
      majTicket,
      confierRappel,
      renommerChat,
      epinglerChat,
      supprimerConversation,
      archiverFil,
      rouvrirFil,
      startChat,
      reessayer,
      brancher,
      arreter,
      retirerDeLaFile,
      marquerLu,
      enregistrerRoutine,
      supprimerRoutine,
      lancerRoutine,
      ajouterArtefact,
      supprimerArtefact,
      retirerRendu,
      choisirArtefactsClaude,
      modifierArtefact,
      synchroniserArtefacts,
      enregistrerProjet,
      retirerProjet,
      enregistrerProfil,
      modifierProfil,
      appliquerProfilCompte,
      poserEvenementsCompte,
      moi,
      choisirAcces,
      moteurDuServeur,
      repondreAutorisation,
      marquerAtelier,
      marquerEquipe,
      repondreCarte,
      repondreCoffre,
      reagir,
      enregistrerTache,
      supprimerTache,
      restaurerTaches,
      oublierSuppressions,
      enregistrerEvenement,
      supprimerEvenement,
      changerCategories,
      enregistrerWorkflow,
      supprimerWorkflow,
      lancerWorkflow,
      arreterExecution,
      deciderApprobation,
    }),
    [
      state,
      moi,
      modifierProfil,
      appliquerProfilCompte,
      poserEvenementsCompte,
      sendMessage,
      choisirModele,
      choisirCompteClaude,
      masquerConseilContexte,
      choisirFournisseur,
      basculerMachine,
      nouvelleConversation,
      repartir,
      creerFil,
      majTicket,
      confierRappel,
      renommerChat,
      epinglerChat,
      supprimerConversation,
      archiverFil,
      rouvrirFil,
      startChat,
      reessayer,
      brancher,
      arreter,
      retirerDeLaFile,
      marquerLu,
      enregistrerRoutine,
      supprimerRoutine,
      lancerRoutine,
      ajouterArtefact,
      supprimerArtefact,
      retirerRendu,
      choisirArtefactsClaude,
      modifierArtefact,
      synchroniserArtefacts,
      enregistrerProjet,
      retirerProjet,
      enregistrerProfil,
      choisirAcces,
      moteurDuServeur,
      repondreAutorisation,
      marquerAtelier,
      marquerEquipe,
      repondreCarte,
      repondreCoffre,
      reagir,
      enregistrerTache,
      supprimerTache,
      restaurerTaches,
      oublierSuppressions,
      enregistrerEvenement,
      supprimerEvenement,
      changerCategories,
      enregistrerWorkflow,
      supprimerWorkflow,
      lancerWorkflow,
      arreterExecution,
      deciderApprobation,
    ],
  );
  return <WorkspaceContext.Provider value={value}>{erreurChargement ? <section role="alert" className="m-5 rounded-xl border border-bordure-forte bg-fond-surface p-5 text-texte-principal"><h1 className="text-h4 font-semibold">Les conversations n’ont pas pu être chargées</h1><p className="text-ui-s">{erreurChargement}</p><p className="text-ui-s">Aucune donnée n’a été remplacée. Les routines attendent que les conversations soient disponibles.</p><Bouton onClick={() => window.location.reload()}>Réessayer</Bouton></section> : children}</WorkspaceContext.Provider>;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return (
    <AgentsProvider>
      <WorkspaceStore>{children}</WorkspaceStore>
    </AgentsProvider>
  );
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace doit être utilisé dans <WorkspaceProvider>");
  return ctx;
}

/* ─── Sélecteurs ───────────────────────────────────────────────── */

/** Les agents, lus dans leurs fiches (cf. src/lib/agents.tsx). */
export function useRoles(): Role[] {
  return useAgents().roles;
}

/** Un agent par son id, même désactivé (ses conversations restent lisibles, sous son nom). S'il a été
 *  supprimé ou n'est pas sur ce poste, un agent de remplacement (les anciens messages restent lisibles). */
export function useRole(id: RoleId): Role {
  const { roles, tous } = useAgents();
  return (
    roles.find((r) => r.id === id) ??
    tous.find((a) => a.role.id === id)?.role ?? {
      ...PRINCIPAL,
      id,
      name: id,
      tag: "Introuvable",
      title: "Agent introuvable sur ce poste",
      initial: id.charAt(0).toUpperCase(),
      teinte: "ocre",
    }
  );
}

/** Les projets de l'espace affiché (le serveur choisi). */
export function useProjects(): Project[] {
  const { projects } = useWorkspace().state;
  const espace = useLieuActif();
  return useMemo(() => projects.filter((p) => dansEspace(p.lieu, espace)), [projects, espace]);
}

/** L'accès des agents d'un serveur. Un VPS où rien n'est choisi garde celui de ce PC. */
export function accesDuServeur(state: { acces: Acces; accesParServeur: Record<string, Acces> }, lieu: string | null | undefined): Acces {
  return lieu ? (state.accesParServeur[lieu] ?? state.acces) : state.acces;
}

/** L'accès des agents du serveur affiché. */
export function useAccesEspace(): Acces {
  const { state } = useWorkspace();
  return accesDuServeur(state, useLieuActif());
}

/** Toutes les conversations de l'espace affiché (le serveur choisi), fils compris : ce qu'on compte et qu'on range ne mélange pas les serveurs. */
export function useChatsEspace(): Chat[] {
  const { chats } = useWorkspace().state;
  const espace = useLieuActif();
  return useMemo(() => chats.filter((c) => dansEspace(c.lieu, espace)), [chats, espace]);
}

/** La conversation directe avec un agent dans l'espace affiché (cf. `idDirect`). */
export function useIdDirect(): (roleId: RoleId) => string {
  const { chats } = useWorkspace().state;
  const espace = useLieuActif();
  return useCallback((roleId: RoleId) => idDirect(roleId, espace, chats), [chats, espace]);
}

/** Une conversation par son id. Celle d'un agent (`dm-<agent>`, `dm-<agent>@<hôte>` sur un VPS) existe dès
 *  qu'on l'ouvre, même vide, y compris pour un agent hors de Mes agents (elle s'ouvre alors en lecture). */
export function useChat(id: string | null): Chat | undefined {
  const { chats } = useWorkspace().state;
  const { roles, tous } = useAgents();
  return useMemo(() => {
    const chat = chats.find((c) => c.id === id);
    const direct = id ? lireIdDirect(id) : null;
    if (chat || !id || !direct) return chat;
    const { roleId } = direct;
    const role = roles.find((r) => r.id === roleId) ?? tous.find((a) => a.role.id === roleId)?.role;
    if (!role) return undefined;
    return {
      id,
      kind: "direct",
      projectId: null,
      title: role.name,
      roleIds: [role.id],
      updatedAt: new Date(0).toISOString(),
      sessions: {},
      luJusqua: null,
      lieu: direct.hote ? lieuDeHote(direct.hote) : null,
    };
  }, [chats, roles, tous, id]);
}

export function useChatMessages(chatId: string): Message[] {
  const { messages } = useWorkspace().state;
  return useMemo(() => messages.filter((m) => m.chatId === chatId), [messages, chatId]);
}

/** L'agent au travail dans cette conversation, s'il y en a un. */
export function useTravail(chatId: string): Travail | null {
  return useWorkspace().state.travail[chatId] ?? null;
}

/** Messages en attente dans cette conversation. */
export function useFile(chatId: string): EnAttente[] {
  return useWorkspace().state.file[chatId] ?? AUCUN;
}
const AUCUN: EnAttente[] = [];

/** Vrai si cet agent travaille en ce moment, dans n'importe quelle conversation. */
export function useAgentOccupe(roleId: RoleId): boolean {
  const { travail } = useWorkspace().state;
  return Object.values(travail).some((t) => t.roleId === roleId);
}

/** Réponses d'agents arrivées depuis la dernière visite de la conversation. */
export function useNonLus(chatId: string): number {
  const { messages, chats } = useWorkspace().state;
  return useMemo(() => {
    const lu = chats.find((c) => c.id === chatId)?.luJusqua ?? "";
    return messages.filter(
      (m) => m.chatId === chatId && m.author.kind === "role" && m.statut !== "en-cours" && m.createdAt > lu,
    ).length;
  }, [messages, chats, chatId]);
}

/** Conversations d'équipe de l'espace affiché : épinglées en tête, puis les plus récentes. */
export function useRecentChats(limit?: number): Chat[] {
  const { chats } = useWorkspace().state;
  const espace = useLieuActif();
  return useMemo(() => {
    const sorted = trierConversations(chats.filter((c) => c.kind === "equipe" && dansEspace(c.lieu, espace)));
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }, [chats, limit, espace]);
}

export interface ChatPreview {
  /** Rôle à afficher en avatar : auteur du dernier message, ou le Principal. */
  roleId: RoleId;
  /** Le dernier message en texte seul, sur une ligne (Markdown retiré). */
  text: string;
  /** Le même, avec sa mise en forme en ligne (gras, italique, code…), pour la barre. */
  contenu: Inline[];
  /** Date du dernier message, null si la conversation est vide. */
  at: string | null;
}

/** Aperçu de la liste : « Hugo : c’est visible sur l’aperçu… ». */
export function useChatPreview(chatId: string): ChatPreview {
  const { messages } = useWorkspace().state;
  const roles = useRoles();
  return useMemo(() => {
    const direct = chatId.startsWith(DIRECT);
    const last = messages.findLast((m) => m.chatId === chatId && (m.statut !== "en-cours" || texteDe(m)));
    if (!last) return { roleId: "principal", text: "", contenu: [], at: null };
    const extrait = extraitMarkdown(texteDe(last));
    const vide = !texteBrut(extrait).trim();
    const contenu: Inline[] = vide ? [{ type: "texte", texte: last.statut === "erreur" ? "Arrêté sur une erreur" : "…" }] : extrait;
    // Conversation directe : pas besoin de répéter le prénom de l'agent.
    const roleId = last.author.kind === "user" ? "principal" : last.author.roleId;
    const prefixe = last.author.kind === "user" ? "Toi : " : direct ? "" : `${roles.find((r) => r.id === roleId)?.name ?? ""} : `;
    const avecPrefixe: Inline[] = prefixe ? [{ type: "texte", texte: prefixe }, ...contenu] : contenu;
    return { roleId, text: texteBrut(avecPrefixe), contenu: avecPrefixe, at: last.createdAt };
  }, [messages, roles, chatId]);
}

/** Un projet par son id, quel que soit son serveur. */
export function useProject(id: string | null): Project | undefined {
  return useWorkspace().state.projects.find((p) => p.id === id);
}

/** Fichiers modifiés par les agents dans les chats d'un projet, en chemins relatifs à son dossier. */
export function useModifiedFiles(projectId: string | null): Set<string> {
  const { chats, messages, projects } = useWorkspace().state;
  return useMemo(() => fichiersModifies({ chats, messages, projects }, projectId), [chats, messages, projects, projectId]);
}

/** Le calcul de `useModifiedFiles`, aussi fait par l'ordinateur pour le téléphone (`fichiers.arbre`). */
export function fichiersModifies({ chats, messages, projects }: Pick<WorkspaceState, "chats" | "messages" | "projects">, projectId: string | null): Set<string> {
  const dossier = projects.find((p) => p.id === projectId)?.folder.replace(/\/$/, "") ?? null;
  const chatIds = new Set(chats.filter((c) => c.projectId === projectId).map((c) => c.id));
  const paths = new Set<string>();
  for (const message of messages) {
    if (!chatIds.has(message.chatId)) continue;
    for (const part of message.parts) {
      if (part.type === "worklog") part.files.forEach((f) => paths.add(f.path));
      if (part.type === "etapes" && dossier) {
        for (const e of part.etapes) {
          if (e.chemin && e.statut === "fait" && /Write|Edit/.test(e.outil) && e.chemin.startsWith(`${dossier}/`)) {
            paths.add(e.chemin.slice(dossier.length + 1));
          }
        }
      }
    }
  }
  return paths;
}

/** Vrai si l'agent de cette conversation attend ton accord. */
export function useAttenteAccord(chatId: string): boolean {
  const { messages, travail } = useWorkspace().state;
  const t = travail[chatId];
  if (!t) return false;
  const m = messages.find((x) => x.id === t.messageId);
  return !!m?.parts.some((p) => p.type === "autorisation" && p.statut === "attente");
}
