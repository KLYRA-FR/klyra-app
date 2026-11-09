import type { Acces, AutorisationsComputerUse, CompteClaude, EtatMaj, PreferencesNotifications, Reglages, Utilisation } from "@/lib/bridge";
import { booleen, chaine, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import { MODELES_FICHE } from "./agents";
import { accesPermis, computerUsePermis, estAcces, RAISONS } from "./reglages";

/**
 * Les gestes « reglages » que l'ordinateur fait pour le téléphone (spec mobile T-22), écrits sans
 * React : `useGestesReglages` leur donne l'état de l'app. Ce qui élargit un pouvoir des agents
 * (« Tout accepter », activer Computer Use) est refusé ici, quoi que le téléphone demande (M-13) ;
 * le réduire est permis.
 */

export interface ResumeConsommation {
  vue: "tout" | "klyra";
  jetons: number | null;
  messages: number;
  joursActifs: number;
  serieActuelle: number;
  plusLongueSerie: number;
  coutUsd: number | null;
  modeles: { nom: string; jetons: number }[];
  depuis: number | null;
}

export interface AgentsReglages {
  acces: Acces;
  assistant: { nom: string; teinte: string };
  agents: { id: string; nom: string; tag: string; teinte: string; modele: string }[];
}

export interface DepsReglages {
  /** « ton Mac » : l'ordinateur se nomme lui-même dans ses refus. */
  ton: string;
  acces: () => Acces;
  choisirAcces: (acces: Acces) => void;
  /** Les réglages enregistrés sur l'ordinateur, relus. */
  reglages: () => Promise<Reglages>;
  changerNotification: (cle: keyof PreferencesNotifications, valeur: boolean) => Promise<void>;
  changerComputerUse: (actif: boolean) => Promise<void>;
  changerSonFinTache: (actif: boolean) => Promise<void>;
  essaiNotification: () => Promise<void>;
  autorisations: () => Promise<AutorisationsComputerUse | null>;
  maj: () => Promise<EtatMaj | null>;
  verifierMaj: () => Promise<EtatMaj | null>;
  claude: () => Promise<{ compte: CompteClaude | null; utilisation: Utilisation | null }>;
  consommation: (vue: "tout" | "klyra") => Promise<ResumeConsommation | null>;
  agents: () => AgentsReglages;
  changerModele: (id: string, modele: string) => Promise<void>;
}

const NOTIFICATIONS: (keyof PreferencesNotifications)[] = ["actives", "pastille", "son", "agentFini", "agentErreur", "workflow", "majPrete", "mcpDefaut"];

/** Un changement enregistré se relit : ce qui n'a pas pris est dit au téléphone, pas tu. */
function verifier(ok: boolean) {
  if (!ok) throw new ErreurPoste("erreur", "Le réglage n’a pas pu changer sur l’ordinateur.");
}

export function gestesReglages(d: DepsReglages): Gestes {
  return {
    /* ─── Lectures ─── */
    "reglages.agents": async () => d.agents(),
    "reglages.notifications": async () => {
      const r = await d.reglages();
      return { notifications: r.notifications, finDeTache: r.sons.finDeTache };
    },
    "reglages.etatComputerUse": async () => ({ actif: (await d.reglages()).computerUse.actif, autorisations: await d.autorisations() }),
    "reglages.majs": async () => d.maj(),
    "reglages.claude": async () => d.claude(),
    "reglages.consommation": async (args) => d.consommation(chaine(objet(args), "vue", 10) === "klyra" ? "klyra" : "tout"),

    /* ─── Changements ─── */

    /** Le niveau d'accès ne fait que descendre depuis le téléphone ; « Tout accepter » est refusé ici. */
    "reglages.acces": async (args) => {
      const demande = objet(args).acces;
      if (!estAcces(demande)) throw new ErreurPoste("arguments", "Demande illisible.");
      if (!accesPermis(d.acces(), demande)) {
        throw new ErreurPoste("ordinateur", demande === "tout" ? `Sur ${d.ton} : ${RAISONS.toutAccepter}` : `Sur ${d.ton} : donner plus d’accès aux agents se décide devant l’ordinateur.`);
      }
      d.choisirAcces(demande);
      return { acces: demande };
    },

    /** Computer Use se coupe depuis le téléphone ; l'activer est refusé ici. */
    "reglages.computerUse": async (args) => {
      const actif = booleen(objet(args), "actif");
      if (!computerUsePermis(actif)) throw new ErreurPoste("ordinateur", `Sur ${d.ton} : ${RAISONS.computerUse}`);
      await d.changerComputerUse(false);
      verifier((await d.reglages()).computerUse.actif === false);
      return { actif: false };
    },

    "reglages.notification": async (args) => {
      const o = objet(args);
      const cle = chaine(o, "cle", 40) as keyof PreferencesNotifications;
      if (!NOTIFICATIONS.includes(cle)) throw new ErreurPoste("arguments", "Demande illisible.");
      const valeur = booleen(o, "valeur");
      await d.changerNotification(cle, valeur);
      verifier((await d.reglages()).notifications[cle] === valeur);
      return { cle, valeur };
    },

    "reglages.sonFinTache": async (args) => {
      const actif = booleen(objet(args), "actif");
      await d.changerSonFinTache(actif);
      verifier((await d.reglages()).sons.finDeTache === actif);
      return { actif };
    },

    "reglages.essaiNotification": async () => {
      await d.essaiNotification();
      return { ok: true };
    },

    "reglages.verifierMaj": async () => d.verifierMaj(),

    /** Le modèle d'un agent actif, parmi ceux qu'une fiche peut demander. */
    "reglages.modele": async (args) => {
      const o = objet(args);
      const id = chaine(o, "id", 64);
      const modele = chaine(o, "modele", 40);
      if (!d.agents().agents.some((x) => x.id === id)) throw new ErreurPoste("introuvable", `Cet agent n’est plus dans tes agents sur ${d.ton}.`);
      if (!MODELES_FICHE.some((m) => m.value === modele)) throw new ErreurPoste("arguments", "Demande illisible.");
      try {
        await d.changerModele(id, modele);
      } catch (e) {
        throw new ErreurPoste("erreur", (e instanceof Error ? e.message : String(e)).slice(0, 300));
      }
      return { id, modele };
    },

    /** Installer une mise à jour relancerait l'app : jamais depuis le téléphone. */
    "reglages.installerMaj": async () => {
      throw new ErreurPoste("ordinateur", `Sur ${d.ton} : ${RAISONS.maj}`);
    },
  };
}
