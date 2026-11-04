import { SECTIONS, type IdSection, type SectionReglages } from "@/components/reglages/catalogue";
import type { Acces } from "@/lib/bridge";

/**
 * Les Réglages sur le téléphone (spec mobile T-22, § 7, M-13) : chaque ligne du catalogue dit d'où
 * elle se lit et se change. « Sur ton Mac » (P-8) porte toujours sa raison, mot pour mot.
 */

/** Les raisons du § 7, après « Sur ton Mac : ». */
export const RAISONS = {
  cles: "les clés ne quittent pas l’ordinateur.",
  dossierProjet: "le dossier d’un projet se choisit sur l’ordinateur.",
  montrer: "s’ouvre sur l’écran de l’ordinateur.",
  apercu: "l’aperçu est servi par ton ordinateur.",
  workflow: "le dessin d’un workflow se fait au pointeur.",
  toutAccepter: "ouvrir tous les accès se décide devant l’ordinateur.",
  computerUse: "piloter l’ordinateur s’autorise devant lui.",
  composio: "la connexion s’ouvre dans le navigateur de l’ordinateur.",
  dictee: "la dictée du téléphone passe par son clavier.",
  maj: "la relancer à distance couperait le lien avec ce téléphone.",
  ordinateur: "réglage de cet ordinateur.",
} as const;

/**
 * - `telephone` : propre au téléphone (Ce téléphone, version de l'app web) ;
 * - `compte` : lu et écrit en ligne, ordinateur fermé compris ;
 * - `poste` : lu et changé sur l'ordinateur ouvert (P-6, P-7 fermé) ;
 * - `lecture` : lu sur l'ordinateur ouvert, pas changé d'ici ;
 * - `ordinateur` : P-8, avec sa raison.
 * `elevation` : la partie qui élargit un pouvoir reste sur l'ordinateur (M-13), avec sa raison.
 */
export type EtatLigne =
  | { type: "telephone" }
  | { type: "compte" }
  | { type: "poste"; elevation?: string }
  | { type: "lecture"; elevation?: string }
  | { type: "ordinateur"; raison: string };

const T = { type: "telephone" } as const;
const C = { type: "compte" } as const;
const P = { type: "poste" } as const;
const L = { type: "lecture" } as const;
const sur = (raison: string): EtatLigne => ({ type: "ordinateur", raison });

/** Une entrée par ligne du catalogue (`catalogue.ts`), d'après le tableau T-22. */
export const ETATS_LIGNES: Record<string, EtatLigne> = {
  /* Général : la version de l'app web se lit ici ; le reste règle l'ordinateur. */
  lancement: sur(RAISONS.ordinateur),
  raccourcis: sur(RAISONS.ordinateur),
  "dossier-donnees": sur(RAISONS.ordinateur),
  "dossier-klyra": sur(RAISONS.ordinateur),
  version: T,
  /* Profil : nom et rôle en ligne, photo sur l'ordinateur, consommation lue sur l'ordinateur. */
  photo: sur(RAISONS.ordinateur),
  nom: C,
  "vue-consommation": L,
  chiffres: L,
  limites: L,
  "non-compte": L,
  activite: L,
  apercu: L,
  coequipiers: L,
  "modeles-utilisation": L,
  "compte-profil": L,
  /* Équipe : tout en ligne. */
  "compte-equipe": C,
  "profil-equipe": C,
  membres: C,
  inviter: C,
  invitations: C,
  /* Mobile : la page « Ce téléphone ». */
  "mobile-chemin": T,
  "mobile-telephones": T,
  "mobile-relier": T,
  "mobile-vps": T,
  /* Claude */
  "compte-claude": L,
  utilisation: L,
  "cle-admin": sur(RAISONS.cles),
  /* Agents : descendre le niveau d'accès, oui ; « Tout accepter », devant l'ordinateur. */
  /* La configuration KLYRA : se change d'ici, sur l'ordinateur ouvert ; le texte des consignes, devant lui. */
  "configuration-klyra": P,
  "memoire-agents": P,
  "consignes-klyra": sur(RAISONS.ordinateur),
  "resume-auto": P,
  "diagnostic-poste": sur(RAISONS.ordinateur),
  acces: { type: "poste", elevation: RAISONS.toutAccepter },
  assistant: P,
  modeles: P,
  "dossier-agents": sur(RAISONS.montrer),
  /* Autres IA */
  "autres-ia": sur(RAISONS.cles),
  /* Notifications de l'ordinateur ; ses sons d'interface restent les siens (ceux du téléphone sont dans Ce téléphone). */
  "notifications-systeme": P,
  pastille: P,
  son: P,
  evenements: P,
  "essai-notification": P,
  "son-fin-tache": P,
  "sons-actions": sur(RAISONS.ordinateur),
  "volume-sons": sur(RAISONS.ordinateur),
  /* Voix */
  moteur: sur(RAISONS.dictee),
  "cle-elevenlabs": sur(RAISONS.cles),
  "modele-local": sur(RAISONS.dictee),
  "langue-dictee": sur(RAISONS.dictee),
  micro: sur(RAISONS.dictee),
  "test-micro": sur(RAISONS.dictee),
  /* Computer Use : le couper, oui ; l'activer et les autorisations du système, devant l'ordinateur. */
  "computer-use-actif": { type: "poste", elevation: RAISONS.computerUse },
  "autorisation-accessibilite": { type: "lecture", elevation: RAISONS.computerUse },
  "autorisation-ecran": { type: "lecture", elevation: RAISONS.computerUse },
  /* Navigateur : le couper, oui ; l'allumer élargit ce que font les agents, devant l'ordinateur. Ses données sont sur l'ordinateur. */
  "navigateur-agents": { type: "poste", elevation: RAISONS.computerUse },
  "navigateur-donnees": sur(RAISONS.ordinateur),
  "navigateur-telechargements": L,
  "navigateur-coffre": sur(RAISONS.cles),
  /* Marketplace : les connexions et les clés des apps restent sur l'ordinateur. */
  composio: sur(RAISONS.composio),
  "apps-directes": sur(RAISONS.cles),
  /* Mises à jour : l'état se lit, l'installation reste devant l'ordinateur ; les liens publics s'ouvrent d'ici. */
  "version-installee": L,
  "version-disponible": L,
  "derniere-verification": L,
  "rechercher-maj": P,
  "installer-maj": sur(RAISONS.maj),
  changelog: T,
  "depot-versions": T,
};

/** L'état d'une ligne ; une ligne inconnue reste sur l'ordinateur plutôt que d'être offerte au téléphone. */
export function etatLigne(id: string): EtatLigne {
  return ETATS_LIGNES[id] ?? sur(RAISONS.ordinateur);
}

/** Les sections du téléphone : « Ce téléphone » (la section Mobile) en tête, puis l'ordre du bureau. */
export function sectionsTelephone(): (SectionReglages & { titreTelephone: string })[] {
  const avecTitre = SECTIONS.map((s) => ({ ...s, titreTelephone: s.id === "mobile" ? "Ce téléphone" : s.titre }));
  return [...avecTitre.filter((s) => s.id === "mobile"), ...avecTitre.filter((s) => s.id !== "mobile")];
}

export const titreSection = (id: IdSection) => (id === "mobile" ? "Ce téléphone" : (SECTIONS.find((s) => s.id === id)?.titre ?? "Réglages"));

/* ─── Pouvoirs des agents (M-13) ───────────────────────────────── */

const RANG_ACCES: Record<Acces, number> = { demander: 0, projet: 1, tout: 2 };

export const estAcces = (valeur: unknown): valeur is Acces => typeof valeur === "string" && valeur in RANG_ACCES;

/** Du téléphone, le niveau d'accès ne fait que descendre ; « Tout accepter » se décide devant l'ordinateur. */
export function accesPermis(actuel: Acces, demande: Acces): boolean {
  return demande !== "tout" && RANG_ACCES[demande] <= RANG_ACCES[actuel];
}

/** Du téléphone, Computer Use se coupe, il ne s'active pas. */
export function computerUsePermis(actif: boolean): boolean {
  return actif === false;
}
