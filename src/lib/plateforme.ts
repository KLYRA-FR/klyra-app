/**
 * Le système du poste, pour les textes qui en dépendent : « ce Mac » ou
 * « ce PC », Finder ou Explorateur, ⌘ ou Ctrl. Lu dans l'userAgent (celui
 * d'Electron donne le système), donc seulement à l'ouverture de l'app : au
 * build, rien n'est rendu (cf. AppShell).
 */

export type Plateforme = "mac" | "windows" | "autre";

function lirePlateforme(): Plateforme {
  if (typeof navigator === "undefined") return "mac";
  if (navigator.userAgent.includes("Windows")) return "windows";
  if (navigator.userAgent.includes("Macintosh")) return "mac";
  return "autre";
}

export const PLATEFORME: Plateforme = lirePlateforme();

interface MotsDuPoste {
  /** « sur ce Mac » */
  ce: string;
  /** « un dossier de ton Mac » */
  ton: string;
  /** « façon Finder » */
  explorateur: string;
  /** « montrer dans le Finder » */
  dansExplorateur: string;
  /** Où rendre le micro à l'app. */
  reglagesMicro: string;
}

const MOTS: Record<Plateforme, MotsDuPoste> = {
  mac: {
    ce: "ce Mac",
    ton: "ton Mac",
    explorateur: "Finder",
    dansExplorateur: "dans le Finder",
    reglagesMicro: "Réglages Système > Confidentialité > Micro",
  },
  windows: {
    ce: "ce PC",
    ton: "ton PC",
    explorateur: "Explorateur",
    dansExplorateur: "dans l’Explorateur",
    reglagesMicro: "Paramètres > Confidentialité et sécurité > Microphone",
  },
  autre: {
    ce: "cet ordinateur",
    ton: "ton ordinateur",
    explorateur: "gestionnaire de fichiers",
    dansExplorateur: "dans le gestionnaire de fichiers",
    reglagesMicro: "les réglages du système",
  },
};

/** Les mots du système : `Projets sur ${poste.ce}`. */
export const poste = MOTS[PLATEFORME];

const MODIFICATEURS: [symbole: string, nom: string][] = [
  ["⌘", "Ctrl"],
  ["⌥", "Alt"],
  ["⇧", "Maj"],
];

/** Un raccourci écrit à la façon du Mac (« ⇧⌘Z »), dans celle du système
 *  (« Ctrl+Maj+Z » ailleurs). Les touches valent les mêmes : ⌘ ou Ctrl. */
export function raccourciDuSysteme(mac: string): string {
  if (PLATEFORME === "mac") return mac;
  const touche = mac.replace(/[⌘⌥⇧]/g, "").replace("⌫", "Suppr");
  return [...MODIFICATEURS.filter(([symbole]) => mac.includes(symbole)).map(([, nom]) => nom), touche].join("+");
}
