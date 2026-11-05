import { LIMITES, preparerPublication } from "../../../convex/model/definitions";
import { getField, parseAgentFile, serializeAgentFile, setFields } from "@/lib/agent-file";
import type { AgentLocal, useAgents } from "@/lib/agents";
import type { DefinitionComplete, EtatBibliotheque, PublicationEnvoyee } from "@/lib/bibliotheque";
import { clesDe, libelleInitial, nomLibre, teinteDefinition } from "@/lib/bibliotheque-ui";
import { BridgeError, type OrigineAgent } from "@/lib/bridge";
import type { Lien } from "@/lib/lien-bibliotheque";
import { consigne as consigneLou, lireProposition } from "@/lib/lou";
import { comparerAuModele, fusionnerAvecModele, remplacerParModele, type Choix } from "@/lib/maj-modele";
import { erreurNomAssistant, nomDejaPris, nomPropre } from "@/lib/noms-agents";
import { booleen, chaine, chaineOuNull, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import { ROLE_TEINTES, type Role, type RoleTeinte } from "@/types/domain";
import { ID_ASSISTANT, MEMOIRES_FICHE, MODELES_FICHE, type EtatsAgentsPoste } from "./agents";

/**
 * Les gestes « agents » que l'ordinateur fait pour le téléphone (spec mobile T-08, T-09), écrits
 * sans React : `useGestesAgents` (`src/lib/poste/gestes/agents.ts`) leur donne l'état de l'app.
 * Les arguments viennent du téléphone : identifiants vérifiés, champs bornés, en-tête de la fiche
 * jamais écrit tel quel depuis le téléphone (seuls « Quand l'appeler », le corps, le modèle et la
 * mémoire changent, comme dans l'éditeur du bureau), et une fiche changée depuis sa lecture n'est
 * jamais écrasée (empreinte).
 */

type ApiAgents = ReturnType<typeof useAgents>;

/** Une fiche telle qu'elle est sur le disque, relue au moment du geste. */
export interface FicheDisque {
  name: string;
  path: string;
  content: string;
  modifiedAt: number;
  empreinte: string;
}

export interface ChiffresEquipe {
  agents: number;
  chats: number;
  chatsAujourdhui: number;
  projetsActifs: number;
  projets: number;
  tachesEnCours: number;
  tachesFaites: number;
}

export interface DepsAgents {
  /** « ton Mac » : l'ordinateur se nomme lui-même dans ses réponses. */
  ton: string;
  agents: Pick<
    ApiAgents,
    | "roles"
    | "tous"
    | "mes"
    | "meta"
    | "canEdit"
    | "dir"
    | "save"
    | "saveReglage"
    | "preferer"
    | "changerModele"
    | "create"
    | "activer"
    | "ajouter"
    | "nommerAssistant"
    | "changerOrigine"
    | "installer"
    | "identifiantLibre"
    | "history"
    | "readVersion"
  >;
  /** Les fiches relues sur le disque (jamais l'état gardé en mémoire, qui peut retarder). */
  fiches: () => Promise<FicheDisque[]>;
  /** Le lien de chaque agent avec la bibliothèque, pour la session du compte (lu au moment du geste). */
  liens: () => Promise<(agent: AgentLocal) => Lien>;
  bibliotheque: {
    etat: EtatBibliotheque;
    moiId: string | null;
    lire: (definitionId: string) => Promise<DefinitionComplete | null>;
    publier: (p: PublicationEnvoyee) => Promise<string>;
    mettreAJour: (definitionId: string, versionAttendue: number, p: PublicationEnvoyee) => Promise<number>;
    retirer: (definitionId: string) => Promise<void>;
  };
  modeles: { name: string; content: string; role: Role }[];
  /** Arrête la réponse en cours de cet agent, dans toutes ses conversations. */
  arreter: (agentId: string) => void;
  enCours: (agentId: string) => boolean;
  routinesDe: (agentId: string) => Promise<number>;
  chiffres: () => ChiffresEquipe;
  /**
   * Lectures bornées au contexte de la conversation directe (lot 5, E5-35–38).
   * Absentes : le téléphone dit que la lecture n'existe pas, il n'affiche pas un vide.
   */
  lectures?: LecturesAgents;
  lou: {
    /** Ce qui empêche Lou de travailler sur ce poste, ou null. */
    blocage: () => Promise<string | null>;
    lancer: (requestId: string, prompt: string) => Promise<{ ok: boolean; text: string; error?: string }>;
    annuler: (requestId: string) => void;
  };
}

/* ─── Ce que le téléphone reçoit ──────────────────────────────── */

export type FicheLue =
  | { type: "assistant"; id: string; nom: string; teinte: string }
  | {
      type: "agent";
      id: string;
      contenu: string;
      modifiedAt: number;
      empreinte: string;
      /** Le chemin du fichier, la maison abrégée en « ~ ». */
      chemin: string;
      reglage: { tag?: string; teinte?: string; nom?: string };
      statut: "actif" | "desactive" | "disponible";
      desactiveLe: number | null;
      lien: Lien;
      /** Reçu de la bibliothèque : changer sa consigne en fait une copie privée. */
      lie: boolean;
      modeleKlyra: string | null;
      manquantes: string[];
      /** Partager avec l'équipe : null si possible, sinon la raison ; absent si sans objet. */
      partage: { raison: string | null } | null;
      routines: number;
      enCours: boolean;
    };

export type EtatLou =
  | { etat: "travail" }
  | { etat: "proposition"; resume: string; avant: string; apres: string }
  | { etat: "erreur"; message: string };

/** Un souvenir listé : la référence sert à l'ouvrir, elle ne s'affiche pas. */
export interface SouvenirListe {
  ref: string;
  titre: string;
  extrait: string;
  toujours: boolean;
  modifieLe: number;
}

export interface SouvenirsLus {
  /** La liste a été coupée par la source : le téléphone le dit. */
  coupee: boolean;
  souvenirs: SouvenirListe[];
}

export interface CompetenceLue {
  nom: string;
  resume: string;
  /** Préchargée par la fiche. Les autres sont disponibles au besoin. */
  prechargee: boolean;
  /** D'où elle vient, tel que la source le dit : fiche, projet, poste, plugin. */
  origine: "fiche" | "projet" | "poste" | "plugin";
}

export interface UtilisationLue {
  entrees: {
    at: number;
    modele: string;
    fournisseur: string;
    entree: number;
    sortie: number;
    cacheLu: number;
    cacheEcrit: number;
    /** Null : le journal n'a pas de coût. Jamais remplacé par zéro. */
    coutUsd: number | null;
  }[];
}

export interface LecturesAgents {
  /** Null : l'agent n'a pas de mémoire, source lue. */
  souvenirs: (id: string) => Promise<SouvenirsLus | null>;
  souvenir: (id: string, ref: string) => Promise<{ titre: string; contenu: string; modifieLe: number }>;
  competences: (id: string) => Promise<CompetenceLue[]>;
  utilisation: (id: string) => Promise<UtilisationLue>;
}

export interface ApercuPartage {
  titre: string;
  contenu: string;
  dependances: { cle: string; libelle: string }[];
  /** Ce qui empêche de publier, ou null. */
  blocage: string | null;
  secrets: number;
}

/* ─── Règles ──────────────────────────────────────────────────── */

const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const VERSION_VALIDE = /^[\w.:-]{1,200}$/;
const CORPS_MAX = 200_000;

function identifiant(args: Record<string, unknown>, cle = "id"): string {
  const id = chaine(args, cle, 64);
  if (id !== ID_ASSISTANT && !NOM_VALIDE.test(id)) throw new ErreurPoste("arguments", "Demande illisible.");
  return id;
}

function teinte(args: Record<string, unknown>): RoleTeinte {
  const valeur = chaine(args, "teinte", 40);
  if (!(ROLE_TEINTES as string[]).includes(valeur)) throw new ErreurPoste("arguments", "Demande illisible.");
  return valeur as RoleTeinte;
}

/** Les erreurs du pont dites au téléphone ; une fiche changée sur le disque devient « conflit ». */
function traduire(e: unknown, ton: string): never {
  if (e instanceof ErreurPoste) throw e;
  if (e instanceof BridgeError && (e.code === "conflit" || e.code === "modifie-localement")) {
    throw new ErreurPoste("conflit", `La fiche a changé sur ${ton} depuis son ouverture`);
  }
  if (e instanceof BridgeError && e.code === "existe-deja") throw new ErreurPoste("existe-deja", e.message);
  /* Sans phrase, le téléphone dit lui-même qui n'a pas pu le faire (`texteErreurPoste`). */
  throw new ErreurPoste("erreur", (e instanceof Error ? e.message : String(e)).slice(0, 300));
}

const abreger = (chemin: string) => chemin.replace(/^(?:\/(?:Users|home)\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)/, "~");

function definitionDe(origine: OrigineAgent | undefined): string | null {
  if (!origine) return null;
  if (origine.type === "bibliotheque" || origine.type === "copie") return origine.definitionId;
  if (origine.type === "local") return origine.publie?.definitionId ?? null;
  return null;
}

/* Le travail de Lou dure une à deux minutes : il tient en mémoire sur l'ordinateur, le téléphone le suit. */
interface TravailLou {
  id: string;
  requestId: string;
  debut: number;
  avant: string;
  empreinte: string;
  etat: EtatLou & { fiche?: string };
}
const travauxLou = new Map<string, TravailLou>();
const DUREE_TRAVAIL_LOU_MS = 30 * 60_000;

/* ─── Les gestes ──────────────────────────────────────────────── */

export function gestesAgents(d: DepsAgents): Gestes {
  const { agents: a, ton } = d;

  const exigerEcriture = () => {
    if (!a.canEdit) throw new ErreurPoste("indisponible", `Les fiches ne se lisent pas sur ${ton} pour l’instant.`);
  };

  /** La fiche relue sur le disque, et ce que l'app en sait. */
  const relire = async (id: string) => {
    const fiche = (await d.fiches()).find((f) => f.name === id);
    if (!fiche) throw new ErreurPoste("introuvable", `Cette fiche n’existe plus sur ${ton}.`);
    return { fiche, local: a.tous.find((x) => x.role.id === id) ?? null };
  };

  /** Une écriture ne part que sur la version que le téléphone a lue. */
  const verifierEmpreinte = (fiche: FicheDisque, attendue: string) => {
    if (fiche.empreinte !== attendue) throw new ErreurPoste("conflit", `La fiche a changé sur ${ton} depuis son ouverture`);
  };

  const localExistant = (id: string) => {
    const local = a.tous.find((x) => x.role.id === id);
    if (!local) throw new ErreurPoste("introuvable", `Cette fiche n’existe plus sur ${ton}.`);
    return local;
  };

  const partageDe = (local: AgentLocal, lien: Lien): { raison: string | null } | null => {
    const partageable = (lien.type === "aucun" || lien.type === "copie") && local.entree?.origine.type !== "modele" && local.statut === "actif";
    if (!partageable) return null;
    const etat = d.bibliotheque.etat;
    const raison =
      etat === "indisponible" || etat === "deconnecte" || etat === "chargement"
        ? `Connecte KLYRA à ton compte d’équipe sur ${ton} pour partager.`
        : etat === "retire"
          ? "Ce compte ne fait plus partie de l’équipe."
          : etat === "hors-ligne"
            ? "Hors ligne."
            : null;
    return { raison };
  };

  /** Ce qui partirait dans la bibliothèque : le même calcul que la fenêtre « Partager » du bureau. */
  const preparer = async (local: AgentLocal, contenu: string, mode: "partager" | "mettre-a-jour") => {
    const lien = (await d.liens())(local);
    const origine = local.entree?.origine;
    const publie = mode === "mettre-a-jour" && lien.type === "publie" ? lien : null;
    const base = preparerPublication(contenu);
    const chemins = [...new Map(base.chemins.map((c) => [c.cle, c.chemin])).entries()];
    const restants = clesDe(base.contenu).filter((cle) => !base.dependances.some((dep) => dep.cle === cle));
    const publiee = publie ? await d.bibliotheque.lire(publie.definitionId) : null;
    const publies = Object.fromEntries((publiee?.dependances ?? []).map((dep) => [dep.cle, dep.libelle]));
    const libelles: Record<string, string> = {
      ...Object.fromEntries(chemins.map(([cle, chemin]) => [cle, publies[cle] ?? libelleInitial(chemin)])),
      ...Object.fromEntries(restants.map((cle) => [cle, publies[cle] ?? `Dossier « ${cle} »`])),
    };
    const pub = preparerPublication(contenu, libelles);
    const dependances = [...pub.dependances, ...restants.map((cle) => ({ cle, libelle: libelles[cle].slice(0, LIMITES.libelle) }))];
    const etat = d.bibliotheque.etat;
    let blocage: string | null = null;
    if (mode === "partager" && (origine?.type === "modele" || origine?.type === "bibliotheque")) {
      blocage = "Un modèle KLYRA ou un agent reçu de la bibliothèque y est déjà : il ne se partage pas.";
    } else if (mode === "partager" && lien.type === "publie") blocage = "Tu l’as déjà partagé : publie plutôt une mise à jour.";
    else if (etat !== "pret" || !d.bibliotheque.moiId) blocage = etat === "hors-ligne" ? "Hors ligne." : `Connecte KLYRA à ton compte d’équipe sur ${ton} pour partager.`;
    else if (mode === "mettre-a-jour" && !publie) blocage = "Seul son auteur peut publier une mise à jour, depuis le compte qui l’a partagé.";
    else if (mode === "mettre-a-jour" && publiee === null) blocage = "Cette définition n’est plus dans la bibliothèque.";
    else if (publie && publiee && publiee.contenu === pub.contenu && publiee.role === local.role.tag) {
      blocage = `Rien n’a changé depuis la version ${publie.version} publiée : il n’y a rien à publier.`;
    } else if (pub.secrets.length) blocage = "La fiche contient ce qui ressemble à un secret : retire-le sur l’ordinateur avant de partager.";
    const titre = publie
      ? `Publier la version ${publie.version + 1} de ${local.role.name} ?`
      : mode === "mettre-a-jour"
        ? `Publier une mise à jour de ${local.role.name} ?`
        : `Partager ${local.role.name} avec l’équipe ?`;
    return { pub, dependances, blocage, publie, titre };
  };

  return {
    /** Ce que T-08 ne peut pas lire dans les cartes : désactivé ou jamais ajouté, origine dans la bibliothèque. */
    "agents.etats": async (): Promise<EtatsAgentsPoste> => {
      const assistant = a.roles[0];
      return {
        assistant: { nom: assistant.name, teinte: assistant.teinte },
        agents: a.tous.map((x) => {
          const reglage = a.meta[x.role.id] ?? {};
          return {
            id: x.role.id,
            statut: x.statut,
            desactiveLe: x.entree?.desactiveLe ?? null,
            definitionId: definitionDe(x.entree?.origine),
            modele: x.entree?.origine.type === "modele" ? x.entree.origine.modele : null,
            masque: reglage.masque === true,
            muet: reglage.muet === true,
            epingle: !!reglage.epingleLe,
            enCours: d.enCours(x.role.id),
          };
        }),
      };
    },

    "agents.chiffres": async () => d.chiffres(),

    "agents.fiche": async (args): Promise<FicheLue> => {
      const id = identifiant(objet(args));
      if (id === ID_ASSISTANT) {
        const assistant = a.roles[0];
        return { type: "assistant", id, nom: assistant.name, teinte: assistant.teinte };
      }
      const { fiche, local } = await relire(id);
      const lien: Lien = local ? (await d.liens())(local) : { type: "aucun" };
      const origine = local?.entree?.origine;
      return {
        type: "agent",
        id,
        contenu: fiche.content,
        modifiedAt: fiche.modifiedAt,
        empreinte: fiche.empreinte,
        chemin: abreger(fiche.path),
        reglage: a.meta[id] ?? {},
        statut: local?.statut ?? "disponible",
        desactiveLe: local?.entree?.desactiveLe ?? null,
        lien,
        lie: origine?.type === "bibliotheque",
        modeleKlyra: origine?.type === "modele" ? origine.modele : null,
        manquantes: local?.manquantes ?? [],
        partage: local ? partageDe(local, lien) : null,
        routines: await d.routinesDe(id),
        enCours: d.enCours(id),
      };
    },

    /** L'éditeur du téléphone : « Quand l'appeler », la fiche, le modèle, la mémoire, le rôle court et la couleur. */
    "agents.enregistrer": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      if (id === ID_ASSISTANT) throw new ErreurPoste("arguments", "Demande illisible.");
      const empreinte = chaine(o, "empreinte", 200);
      const description = chaine(o, "description", LIMITES.description * 4).trim();
      const corps = chaine(o, "corps", CORPS_MAX);
      const modele = chaine(o, "modele", 40);
      const memoire = chaine(o, "memoire", 40);
      const tag = chaine(o, "tag", 40).trim();
      const couleur = teinte(o);
      if (!description) throw new ErreurPoste("invalide", "Écris quand l’appeler : c’est ce que Claude lit pour choisir l’agent.");
      if (!corps.trim()) throw new ErreurPoste("invalide", "La fiche ne peut pas être vide.");
      if (!tag) throw new ErreurPoste("invalide", "Donne-lui un rôle court, affiché à côté de son nom.");

      const { fiche, local } = await relire(id);
      verifierEmpreinte(fiche, empreinte);
      const parsed = parseAgentFile(fiche.content);
      const modeleActuel = getField(parsed.frontmatter, "model") ?? "";
      const memoireActuelle = getField(parsed.frontmatter, "memory") ?? "";
      if (modele !== modeleActuel && !MODELES_FICHE.some((m) => m.value === modele)) throw new ErreurPoste("arguments", "Demande illisible.");
      if (memoire !== memoireActuelle && !MEMOIRES_FICHE.some((m) => m.value === memoire)) throw new ErreurPoste("arguments", "Demande illisible.");

      const lie = local?.entree?.origine.type === "bibliotheque";
      const description1 = description.replace(/\s*\n\s*/g, " ");
      const contenu = serializeAgentFile({
        frontmatter: setFields(parsed.frontmatter, { description: description1, model: modele, memory: lie ? undefined : memoire }),
        body: corps,
      });
      const reglage = { tag, teinte: couleur };
      const consigneChangee = description1 !== (getField(parsed.frontmatter, "description") ?? "") || corps.trim() !== parsed.body.trim();
      try {
        if (lie) {
          /* Agent reçu : rôle court, couleur et modèle sont des préférences ; sa consigne changée en fait une copie privée. */
          await a.saveReglage(id, reglage);
          if (consigneChangee) await a.save(id, contenu, reglage, fiche.modifiedAt);
          else if (modele !== modeleActuel) await a.changerModele(id, modele);
        } else {
          await a.save(id, contenu, reglage, fiche.modifiedAt);
        }
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    "agents.creer": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const nom = nomPropre(chaine(o, "nom", 80));
      const id = chaine(o, "id", 64);
      const tag = chaine(o, "tag", 40).trim();
      const couleur = teinte(o);
      const description = chaine(o, "description", LIMITES.description * 4).trim();
      const corps = chaine(o, "corps", CORPS_MAX);
      const modele = chaine(o, "modele", 40);
      const memoire = chaine(o, "memoire", 40);
      if (!nom) throw new ErreurPoste("invalide", "Donne-lui un nom.");
      const pris = nomDejaPris(nom, a.roles);
      if (pris) throw new ErreurPoste("invalide", `Tu as déjà un agent qui s’appelle ${pris.name}. Choisis un autre nom pour les distinguer dans les chats.`);
      if (!NOM_VALIDE.test(id)) throw new ErreurPoste("invalide", "Minuscules, chiffres et tirets seulement, sans espace ni accent.");
      if (a.identifiantLibre(id) !== id) throw new ErreurPoste("invalide", `« ${id} » existe déjà sur ${ton} : choisis-en un autre, rien ne sera écrasé.`);
      if (!tag) throw new ErreurPoste("invalide", "Donne-lui un rôle court, affiché à côté de son nom.");
      if (!description) throw new ErreurPoste("invalide", "Écris quand l’appeler : c’est ce que Claude lit pour choisir l’agent.");
      if (!corps.trim()) throw new ErreurPoste("invalide", "La fiche ne peut pas être vide.");
      if (!MODELES_FICHE.some((m) => m.value === modele) || !MEMOIRES_FICHE.some((m) => m.value === memoire)) {
        throw new ErreurPoste("arguments", "Demande illisible.");
      }
      const contenu = serializeAgentFile({
        frontmatter: setFields(parseAgentFile("").frontmatter, {
          name: id,
          displayName: nom,
          description: description.replace(/\s*\n\s*/g, " "),
          model: modele,
          memory: memoire,
        }),
        body: corps,
      });
      try {
        await a.create(id, contenu, { tag, teinte: couleur });
      } catch (e) {
        traduire(e, ton);
      }
      return { id };
    },

    /** « Personnaliser » : nom affiché, rôle court et couleur. La fiche ne change pas. */
    "agents.personnaliser": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const nom = nomPropre(chaine(o, "nom", 80));
      const couleur = teinte(o);
      try {
        if (id === ID_ASSISTANT) {
          const erreur = erreurNomAssistant(nom, a.roles);
          if (erreur) throw new ErreurPoste("invalide", erreur);
          await a.nommerAssistant(nom, couleur);
          return { ok: true };
        }
        const local = localExistant(id);
        const tag = chaine(o, "tag", 40).trim();
        if (!nom) throw new ErreurPoste("invalide", "Donne-lui un nom.");
        if (!tag) throw new ErreurPoste("invalide", "Donne-lui un rôle court, affiché à côté de son nom.");
        const pris = nomDejaPris(nom, a.roles, id);
        if (pris) throw new ErreurPoste("invalide", `Tu as déjà un agent qui s’appelle ${pris.name}. Choisis un autre nom pour les distinguer dans les chats.`);
        const nomFiche = getField(parseAgentFile(local.role.file?.content ?? "").frontmatter, "displayName") ?? id;
        await a.saveReglage(id, { tag, teinte: couleur, nom: nom !== nomFiche ? nom : "" });
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    /** Désactiver (sa réponse en cours s'arrête), réactiver, ou ajouter une fiche trouvée sur l'ordinateur. */
    "agents.activer": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const actif = booleen(o, "actif");
      if (id === ID_ASSISTANT) throw new ErreurPoste("arguments", "Demande illisible.");
      const local = localExistant(id);
      try {
        if (!actif) {
          if (local.statut !== "actif") return { ok: true };
          d.arreter(id);
          await a.activer(id, false);
        } else if (local.statut === "desactive") await a.activer(id, true);
        else if (local.statut === "disponible") await a.ajouter(id);
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    "agents.historique": async (args) => {
      const id = identifiant(objet(args));
      localExistant(id);
      try {
        return (await a.history(id)).map((v) => ({ id: v.id, savedAt: v.savedAt }));
      } catch (e) {
        traduire(e, ton);
      }
    },

    "agents.version": async (args) => {
      const o = objet(args);
      const id = identifiant(o);
      const versionId = chaine(o, "versionId", 200);
      if (!VERSION_VALIDE.test(versionId)) throw new ErreurPoste("arguments", "Demande illisible.");
      const { fiche } = await relire(id);
      try {
        return { contenu: await a.readVersion(id, versionId), actuel: fiche.content, empreinte: fiche.empreinte };
      } catch (e) {
        traduire(e, ton);
      }
    },

    "agents.restaurer": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const versionId = chaine(o, "versionId", 200);
      if (!VERSION_VALIDE.test(versionId)) throw new ErreurPoste("arguments", "Demande illisible.");
      const { fiche } = await relire(id);
      verifierEmpreinte(fiche, chaine(o, "empreinte", 200));
      try {
        const contenu = await a.readVersion(id, versionId);
        await a.save(id, contenu, {}, fiche.modifiedAt);
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    /* ─── Lou ─── */

    /** Lance Lou sur la fiche (ou sur sa proposition précédente, `depuis`) ; le téléphone suit avec `agents.louEtat`. */
    "agents.lou": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const demande = chaine(o, "demande", 4000).trim();
      const depuis = chaineOuNull(o, "depuis", 100);
      if (!demande || id === ID_ASSISTANT) throw new ErreurPoste("arguments", "Demande illisible.");
      const blocage = await d.lou.blocage();
      if (blocage) throw new ErreurPoste("lou", blocage);
      const { fiche, local } = await relire(id);
      const precedent = depuis ? travauxLou.get(depuis) : undefined;
      if (depuis && (!precedent || precedent.id !== id || precedent.etat.etat !== "proposition")) throw new ErreurPoste("arguments", "Demande illisible.");
      for (const [cle, t] of travauxLou) if (Date.now() - t.debut > DUREE_TRAVAIL_LOU_MS) travauxLou.delete(cle);

      const role = { id, name: local?.role.name ?? id } as Role;
      const tache = crypto.randomUUID();
      const travail: TravailLou = {
        id,
        requestId: crypto.randomUUID(),
        debut: Date.now(),
        avant: precedent?.avant ?? fiche.content,
        empreinte: precedent?.empreinte ?? fiche.empreinte,
        etat: { etat: "travail" },
      };
      const base = precedent?.etat.fiche ?? fiche.content;
      travauxLou.set(tache, travail);
      void d.lou
        .lancer(travail.requestId, consigneLou(role, base, demande))
        .then((r) => {
          if (!r.ok) throw new Error(r.error ?? "Lou n’a pas pu répondre.");
          const { resume, fiche: apres } = lireProposition(r.text, role);
          travail.etat = { etat: "proposition", resume, avant: travail.avant, apres, fiche: apres };
        })
        .catch((e: unknown) => {
          travail.etat = { etat: "erreur", message: e instanceof Error ? e.message : String(e) };
        });
      return { tache };
    },

    "agents.louEtat": async (args): Promise<EtatLou> => {
      const travail = travauxLou.get(chaine(objet(args), "tache", 100));
      if (!travail) throw new ErreurPoste("introuvable", "Cette demande à Lou n’existe plus sur l’ordinateur. Relance-la.");
      const { etat } = travail;
      return etat.etat === "proposition" ? { etat: "proposition", resume: etat.resume, avant: etat.avant, apres: etat.apres } : etat;
    },

    "agents.louAppliquer": async (args) => {
      exigerEcriture();
      const tache = chaine(objet(args), "tache", 100);
      const travail = travauxLou.get(tache);
      if (!travail || travail.etat.etat !== "proposition" || !travail.etat.fiche) throw new ErreurPoste("introuvable", "Cette proposition de Lou n’existe plus sur l’ordinateur. Relance la demande.");
      const { fiche } = await relire(travail.id);
      if (fiche.empreinte !== travail.empreinte) {
        throw new ErreurPoste("conflit", `La fiche a changé sur ${ton} pendant que Lou travaillait. Relance la demande sur la nouvelle version.`);
      }
      try {
        await a.save(travail.id, travail.etat.fiche, {}, fiche.modifiedAt);
      } catch (e) {
        traduire(e, ton);
      }
      travauxLou.delete(tache);
      return { ok: true };
    },

    "agents.louAbandonner": async (args) => {
      const tache = chaine(objet(args), "tache", 100);
      const travail = travauxLou.get(tache);
      if (travail?.etat.etat === "travail") d.lou.annuler(travail.requestId);
      travauxLou.delete(tache);
      return { ok: true };
    },

    /* ─── Bibliothèque ─── */

    /** « Ajouter » : un modèle KLYRA ou une définition partagée. Les dossiers à choisir restent « À configurer ». */
    "agents.ajouterDefinition": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const type = chaine(o, "type", 20);
      const pris = (n: string) => !!nomDejaPris(n, a.roles);
      try {
        if (type === "modele") {
          const nomModele = chaine(o, "nom", 64);
          const modele = d.modeles.find((m) => m.name === nomModele);
          if (!modele) throw new ErreurPoste("introuvable", "Ce modèle KLYRA n’existe pas dans cette version de l’app.");
          const local = a.tous.find((x) => x.role.id === modele.name);
          if (local?.statut === "actif") return { id: modele.name, nom: local.role.name, aConfigurer: [] };
          if (local?.statut === "desactive") {
            await a.activer(local.role.id, true);
            return { id: local.role.id, nom: local.role.name, aConfigurer: [] };
          }
          if (local) {
            /* Déjà sur l'ordinateur : remise dans Mes agents telle quelle. */
            await a.ajouter(modele.name);
            await a.changerOrigine(modele.name, { type: "modele", modele: modele.name });
            return { id: modele.name, nom: local.role.name, aConfigurer: [] };
          }
          const nom = nomLibre(modele.role.name, pris);
          await a.installer(
            { _id: `klyra:${modele.name}`, slug: modele.name, contenu: modele.content, version: 1, auteur: { nom: "KLYRA" } },
            { id: modele.name, origine: { type: "modele", modele: modele.name } },
          );
          if (nom !== modele.role.name) await a.saveReglage(modele.name, { nom });
          return { id: modele.name, nom, aConfigurer: [] };
        }
        if (type !== "partage") throw new ErreurPoste("arguments", "Demande illisible.");
        const definitionId = chaine(o, "definitionId", 100);
        const moiId = d.bibliotheque.moiId;
        if (!moiId) throw new ErreurPoste("bibliotheque", `Connecte KLYRA à ton compte d’équipe sur ${ton} pour ajouter un agent partagé.`);
        const local = a.tous.find((x) => definitionDe(x.entree?.origine) === definitionId);
        if (local) {
          if (local.statut === "desactive") await a.activer(local.role.id, true);
          return { id: local.role.id, nom: local.role.name, aConfigurer: [] };
        }
        const def = await d.bibliotheque.lire(definitionId);
        if (!def) throw new ErreurPoste("introuvable", "Cette définition n’est plus dans la bibliothèque.");
        const id = a.identifiantLibre(def.slug);
        const nom = nomLibre(def.nom, pris);
        await a.installer(def, {
          id,
          origine: { type: "bibliotheque", definitionId: def._id, version: def.version, auteur: def.auteur.nom, compte: moiId, valeurs: {}, ignoree: null },
          valeurs: {},
        });
        await a.saveReglage(id, { tag: def.role, teinte: teinteDefinition(def.slug, false), nom: nom !== def.nom ? nom : undefined });
        return { id, nom, aConfigurer: clesDe(def.contenu) };
      } catch (e) {
        traduire(e, ton);
      }
    },

    /** « Ajouter toute la collection » : ce qui sera ajouté, ce qui ne le sera pas et pourquoi. */
    "agents.planCollection": async () => planCollection(d),

    "agents.ajouterCollection": async () => {
      exigerEcriture();
      const { retenus } = planCollection(d);
      let faits = 0;
      for (const p of retenus) {
        const modele = d.modeles.find((m) => m.name === p.id)!;
        try {
          if (a.tous.some((x) => x.role.id === p.id)) {
            await a.ajouter(p.id);
            await a.changerOrigine(p.id, { type: "modele", modele: p.id });
          } else {
            await a.installer(
              { _id: `klyra:${p.id}`, slug: p.id, contenu: modele.content, version: 1, auteur: { nom: "KLYRA" } },
              { id: p.id, origine: { type: "modele", modele: p.id } },
            );
          }
          faits++;
        } catch (e) {
          const raison = e instanceof Error ? e.message : String(e);
          return { faits, message: `L’ajout s’est arrêté à ${p.nom} : ${raison}. ${faits ? `${faits} ${faits > 1 ? "modèles ont été ajoutés" : "modèle a été ajouté"} avant.` : "Rien n’a été ajouté."}` };
        }
      }
      return { faits, message: null };
    },

    /* ─── Modèle KLYRA ─── */

    /** Comparer au modèle : mettre à jour (avec les choix des parties en conflit), remplacer, garder sa version, copier en privé. */
    "agents.majModele": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const action = chaine(o, "action", 20);
      const { fiche, local } = await relire(id);
      verifierEmpreinte(fiche, chaine(o, "empreinte", 200));
      const origine = local?.entree?.origine;
      if (origine?.type !== "modele") throw new ErreurPoste("arguments", "Cet agent ne vient pas d’un modèle KLYRA.");
      const nom = origine.modele;
      const comparaison = comparerAuModele(nom, fiche.content);
      if (!comparaison) throw new ErreurPoste("introuvable", "Ce modèle KLYRA n’existe plus dans cette version de l’app.");
      const choixBrut = o.choix ?? {};
      if (typeof choixBrut !== "object" || choixBrut === null || Array.isArray(choixBrut)) throw new ErreurPoste("arguments", "Demande illisible.");
      const choix: Record<string, Choix> = {};
      for (const [cle, v] of Object.entries(choixBrut as Record<string, unknown>)) {
        if (cle.length > 300 || (v !== "mienne" && v !== "modele")) throw new ErreurPoste("arguments", "Demande illisible.");
        choix[cle] = v;
      }
      try {
        if (action === "mettreAJour" || action === "remplacer") {
          const contenu = action === "mettreAJour" ? fusionnerAvecModele(nom, id, fiche.content, choix)?.contenu : remplacerParModele(nom, id, fiche.content);
          if (!contenu) throw new ErreurPoste("introuvable", "Ce modèle KLYRA n’existe plus dans cette version de l’app.");
          await a.save(id, contenu, {}, fiche.modifiedAt);
          if (origine.ignoree !== undefined) await a.changerOrigine(id, { type: "modele", modele: nom });
        } else if (action === "garder") {
          await a.changerOrigine(id, { type: "modele", modele: nom, ignoree: comparaison.version });
        } else if (action === "copier") {
          await a.changerOrigine(id, { type: "local" });
        } else throw new ErreurPoste("arguments", "Demande illisible.");
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    /* ─── Partager ─── */

    "agents.apercuPartage": async (args): Promise<ApercuPartage> => {
      const o = objet(args);
      const id = identifiant(o);
      const mode = chaine(o, "mode", 20) === "mettre-a-jour" ? "mettre-a-jour" : "partager";
      const { fiche, local } = await relire(id);
      if (!local) throw new ErreurPoste("introuvable", `Cette fiche n’existe plus sur ${ton}.`);
      const { pub, dependances, blocage, titre } = await preparer(local, fiche.content, mode);
      return { titre, contenu: pub.contenu, dependances, blocage, secrets: pub.secrets.length };
    },

    "agents.partager": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const mode = chaine(o, "mode", 20) === "mettre-a-jour" ? "mettre-a-jour" : "partager";
      const { fiche, local } = await relire(id);
      verifierEmpreinte(fiche, chaine(o, "empreinte", 200));
      if (!local) throw new ErreurPoste("introuvable", `Cette fiche n’existe plus sur ${ton}.`);
      const { pub, dependances, blocage, publie } = await preparer(local, fiche.content, mode);
      const moiId = d.bibliotheque.moiId;
      if (blocage || !moiId) throw new ErreurPoste("bibliotheque", blocage ?? `Connecte KLYRA à ton compte d’équipe sur ${ton} pour partager.`);
      const publication = { contenu: pub.contenu, role: local.role.tag, dependances };
      let definitionId: string;
      let version: number;
      try {
        if (publie) {
          definitionId = publie.definitionId;
          version = await d.bibliotheque.mettreAJour(definitionId, publie.version, publication);
        } else {
          definitionId = await d.bibliotheque.publier(publication);
          version = 1;
        }
        await a.changerOrigine(id, { type: "local", publie: { definitionId, version, compte: moiId } });
      } catch (e) {
        traduire(e, ton);
      }
      return { version };
    },

    "agents.retirerPartage": async (args) => {
      exigerEcriture();
      const id = identifiant(objet(args));
      const local = localExistant(id);
      const lien = (await d.liens())(local);
      if (lien.type !== "publie") throw new ErreurPoste("arguments", "Seul son auteur peut le retirer de la bibliothèque.");
      try {
        await d.bibliotheque.retirer(lien.definitionId);
        if (local.entree?.origine.type === "local") await a.changerOrigine(id, { type: "local" }).catch(() => undefined);
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    /**
     * Épingler, sourdine, masquer : les mêmes préférences que le menu du bureau (`preferer`).
     * L'écriture attend le disque. L'assistant ne se masque pas et ne s'épingle pas.
     */
    "agents.preference": async (args) => {
      exigerEcriture();
      const o = objet(args);
      const id = identifiant(o);
      const masque = o.masque === undefined ? undefined : booleen(o, "masque");
      const muet = o.muet === undefined ? undefined : booleen(o, "muet");
      const epingle = o.epingle === undefined ? undefined : booleen(o, "epingle");
      if (masque === undefined && muet === undefined && epingle === undefined) throw new ErreurPoste("arguments", "Demande illisible.");
      if (id === ID_ASSISTANT && (masque !== undefined || epingle !== undefined)) {
        throw new ErreurPoste("arguments", "L’assistant reste dans la liste.");
      }
      if (id !== ID_ASSISTANT) localExistant(id);
      try {
        await a.preferer(id, {
          ...(masque !== undefined ? { masque } : {}),
          ...(muet !== undefined ? { muet } : {}),
          ...(epingle !== undefined ? { epingle } : {}),
        });
      } catch (e) {
        traduire(e, ton);
      }
      return { ok: true };
    },

    /** Arrête le travail en cours de cet agent. Le téléphone ne le dit réussi qu'après ce retour. */
    "agents.arreter": async (args) => {
      const id = identifiant(objet(args));
      if (id !== ID_ASSISTANT) localExistant(id);
      d.arreter(id);
      return { ok: true };
    },

    "agents.souvenirs": async (args): Promise<SouvenirsLus> => {
      const id = identifiant(objet(args));
      const lu = await lireOuIndisponible(d, () => d.lectures!.souvenirs(id));
      return lu ?? { coupee: false, souvenirs: [] };
    },

    "agents.souvenir": async (args) => {
      const o = objet(args);
      const id = identifiant(o);
      const ref = chaine(o, "ref", 300);
      if (ref.includes("..") || ref.startsWith("/") || ref.startsWith("\\") || ref.includes("\\")) {
        throw new ErreurPoste("arguments", "Demande illisible.");
      }
      const liste = await lireOuIndisponible(d, () => d.lectures!.souvenirs(id));
      const ligne = liste?.souvenirs.find((s) => s.ref === ref);
      if (!ligne) throw new ErreurPoste("introuvable", "Ce souvenir n’est pas dans la liste.");
      const lu = await lireOuIndisponible(d, () => d.lectures!.souvenir(id, ref));
      return { ...lu, titre: ligne.titre };
    },

    "agents.competences": async (args) => {
      const id = identifiant(objet(args));
      const competences = await lireOuIndisponible(d, () => d.lectures!.competences(id));
      return { competences };
    },

    "agents.utilisation": async (args): Promise<UtilisationLue> => {
      const id = identifiant(objet(args));
      return lireOuIndisponible(d, () => d.lectures!.utilisation(id));
    },
  };
}

async function lireOuIndisponible<T>(d: DepsAgents, lire: () => Promise<T>): Promise<T> {
  if (!d.lectures) throw new ErreurPoste("indisponible", `Cette lecture se fait sur ${d.ton}.`);
  try {
    return await lire();
  } catch (e) {
    const message = e instanceof Error && e.message ? e.message : `Cette lecture se fait sur ${d.ton}.`;
    throw new ErreurPoste("indisponible", message);
  }
}

/** Le plan de « Ajouter toute la collection », comme au bureau. */
function planCollection(d: DepsAgents): { retenus: { id: string; nom: string; tag: string }[]; ecartes: { id: string; nom: string; raison: string }[] } {
  const retenus: { id: string; nom: string; tag: string }[] = [];
  const ecartes: { id: string; nom: string; raison: string }[] = [];
  for (const modele of [...d.modeles].sort((x, y) => x.role.name.localeCompare(y.role.name, "fr"))) {
    const local = d.agents.tous.find((x) => x.role.id === modele.name) ?? null;
    const nom = (local ?? modele).role.name;
    const raison =
      local?.statut === "actif"
        ? "déjà dans tes agents"
        : local?.statut === "desactive"
          ? "désactivé : réactive-le depuis sa ligne"
          : nomDejaPris(nom, d.agents.roles)
            ? "nom déjà pris : ajoute-le seul"
            : null;
    if (raison) ecartes.push({ id: modele.name, nom, raison });
    else retenus.push({ id: modele.name, nom, tag: modele.role.tag });
  }
  return { retenus, ecartes };
}
