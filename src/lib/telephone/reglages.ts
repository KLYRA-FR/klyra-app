import type { IconName } from "@/components/icons/Icon";
import { chercher, SECTIONS, type IdSection, type SectionReglages } from "@/components/reglages/catalogue";
import type { Acces } from "@/lib/bridge";
import type { RoleTeinte } from "@/types/domain";

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
  "skills-par-agent": sur(RAISONS.ordinateur),
  acces: { type: "poste", elevation: RAISONS.toutAccepter },
  assistant: P,
  modeles: P,
  "dossier-agents": sur(RAISONS.montrer),
  /* Coffre : les secrets ne quittent pas l'ordinateur, et ne passent jamais par le compte. */
  "coffre-secrets": sur(RAISONS.cles),
  "coffre-connexions": sur(RAISONS.cles),
  "coffre-agents": L,
  "coffre-demander": L,
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
  "navigateur-moteur": sur(RAISONS.ordinateur),
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

/* ─── La liste des Réglages (lot 8, E8-15 à E8-18) ─────────────── */

export interface LigneCatalogue {
  id: IdSection;
  titre: string;
  icone: IconName;
  detail: (sur: string) => string;
}

const LIGNES_LISTE: Record<IdSection, { groupe: "compte" | "poste" | "restent"; detail: (sur: string) => string }> = {
  mobile: { groupe: "compte", detail: () => "Notifications, sons, déconnexion" },
  profil: { groupe: "compte", detail: () => "Ton nom, ton rôle, ta consommation" },
  equipe: { groupe: "compte", detail: () => "Membres, rôles et invitations" },
  claude: { groupe: "poste", detail: () => "Le compte de tes agents, et ce qu’il en reste" },
  agents: { groupe: "poste", detail: () => "Leur niveau d’accès et leur modèle" },
  notifications: { groupe: "poste", detail: (sur) => `Celles de ${sur}` },
  "computer-use": { groupe: "poste", detail: (sur) => `Laisser les agents piloter ${sur}` },
  "mises-a-jour": { groupe: "poste", detail: (sur) => `Où en est l’app de ${sur}` },
  general: { groupe: "restent", detail: () => "Démarrage, raccourcis, dossiers" },
  coffre: { groupe: "restent", detail: () => "Les clés ne quittent pas l’ordinateur" },
  "autres-ia": { groupe: "restent", detail: () => "Les clés ne quittent pas l’ordinateur" },
  voix: { groupe: "restent", detail: () => "La dictée passe par le clavier du téléphone" },
  navigateur: { groupe: "restent", detail: (sur) => `Les pages et les cookies restent sur ${sur}` },
  marketplace: { groupe: "restent", detail: (sur) => `La connexion s’ouvre dans le navigateur de ${sur}` },
};

/** Les trois groupes de la liste, par source : aucune section du catalogue n'est perdue, l'ordre du bureau est gardé. */
export function groupesReglages(): Record<"compte" | "poste" | "restent", LigneCatalogue[]> {
  const groupes: Record<"compte" | "poste" | "restent", LigneCatalogue[]> = { compte: [], poste: [], restent: [] };
  for (const s of sectionsTelephone()) {
    const { groupe, detail } = LIGNES_LISTE[s.id];
    groupes[groupe].push({ id: s.id, titre: s.titreTelephone, icone: s.icone, detail });
  }
  return groupes;
}

/** Les sons du téléphone sont dans Ce téléphone, même si le catalogue du bureau les range dans Notifications. */
const DANS_CE_TELEPHONE = new Set(["sons-actions", "volume-sons"]);

export interface ResultatReglage {
  cle: string;
  href: string;
  titre: string;
  icone: IconName;
  ligne2: string;
  /** La ligne reste sur l'ordinateur : l'étiquette « Sur ton Mac ». */
  surPoste: boolean;
}

/** La recherche du catalogue, dite pour le téléphone : la section, l'ordinateur si la ligne s'y lit, « Sur ton Mac » si elle y reste. */
export function resultatsTelephone(requete: string, sur: string): ResultatReglage[] {
  return chercher(requete).map(({ section, entree }) => {
    if (!entree) {
      return { cle: section.id, href: `/reglages?section=${section.id}`, titre: titreSection(section.id), icone: section.icone, ligne2: section.description, surPoste: false };
    }
    if (DANS_CE_TELEPHONE.has(entree.id)) {
      const mobile = SECTIONS.find((s) => s.id === "mobile")!;
      return { cle: entree.id, href: `/reglages?section=mobile&reglage=${entree.id}`, titre: entree.titre, icone: mobile.icone, ligne2: titreSection("mobile"), surPoste: false };
    }
    const etat = etatLigne(entree.id);
    const dernier = etat.type === "poste" || etat.type === "lecture" ? `${titreSection(section.id)} · ${sur}` : titreSection(section.id);
    return { cle: entree.id, href: `/reglages?section=${section.id}&reglage=${entree.id}`, titre: entree.titre, icone: section.icone, ligne2: dernier, surPoste: etat.type === "ordinateur" };
  });
}

/** Le titre d'une ligne sans sa précision (« Organisation Console : usage et coût réels »). */
export const titreCourt = (titre: string) => titre.split(" : ")[0];

/** L'icône d'une ligne qui reste sur l'ordinateur : le cadenas pour une clé, sinon celle de sa section. */
export function iconeLigne(id: string, section: IconName): IconName {
  const etat = etatLigne(id);
  if (etat.type === "ordinateur" && etat.raison === RAISONS.cles) return "lock-01";
  if (id === "modele-local") return "download-02";
  return section;
}

/* ─── Les sections qui restent sur l'ordinateur (E8-42) ────────── */

const SECTIONS_AU_POSTE: Partial<Record<IdSection, { titre: (sur: string) => string; raison: (sur: string) => string }>> = {
  voix: { titre: (sur) => `La voix se règle sur ${sur}`, raison: () => "Sur ce téléphone, dicte avec le micro de son clavier : KLYRA n’a rien à régler." },
  "autres-ia": { titre: (sur) => `Les autres IA se règlent sur ${sur}`, raison: () => "Leurs clés ne quittent pas l’ordinateur." },
  navigateur: { titre: (sur) => `Le navigateur se règle sur ${sur}`, raison: (sur) => `Ses pages et ses cookies restent sur ${sur}.` },
  marketplace: { titre: (sur) => `Le Marketplace s’utilise sur ${sur}`, raison: () => "Connecter une app ouvre sa page de connexion dans le navigateur de l’ordinateur, et ses clés y restent." },
  coffre: { titre: (sur) => `Le coffre reste sur ${sur}`, raison: () => "Les clés ne quittent pas l’ordinateur. Tes agents s’en servent sans jamais les voir." },
};

/** L'état « sur le poste » d'une section entière, ou null si elle se lit d'ici. */
export function sectionAuPoste(id: IdSection, sur: string): { titre: string; raison: string } | null {
  const s = SECTIONS_AU_POSTE[id];
  return s ? { titre: s.titre(sur), raison: s.raison(sur) } : null;
}

/* ─── Agents : réduire un accès, choisir un modèle (E8-32 à E8-35) ── */

/** Le détail d'un niveau sur le téléphone : la phrase du bureau, raccourcie à ce qu'une ligne peut porter. */
export function detailAcces(id: Acces): string {
  if (id === "projet") return "Il modifie les fichiers et lance les commandes sans risque seul ; il te demande pour ce qui pourrait casser.";
  if (id === "tout") return "Rien ne t’est demandé : chaque commande est acceptée d’office.";
  return "L’agent lit seul. Pour modifier un fichier ou lancer une commande, il te demande.";
}

/** La confirmation d'une réduction : elle dit qu'on ne remonte pas d'ici (M-13). */
export function confirmationAcces(demande: { id: Acces; nom: string }, sur: string): { titre: string; texte: string; confirmer: string } {
  const effet = demande.id === "demander" ? "Tes agents te demanderont avant de modifier un fichier ou de lancer une commande" : "Tes agents te demanderont pour ce qui pourrait casser ou sortir du projet";
  return { titre: `Passer à « ${demande.nom} » ?`, texte: `${effet}, dès leurs prochaines réponses. Revenir au niveau actuel se fera devant ${sur}.`, confirmer: "Réduire l’accès" };
}

const COURTS: Record<string, string> = { opus: "Opus", sonnet: "Sonnet", haiku: "Haiku", inherit: "Session" };

/** Le modèle d'un agent, sur sa ligne : jamais un identifiant de modèle. */
export const libelleModele = (modele: string) => COURTS[modele] ?? "Autre modèle";

/** Des libellés de maquette (E8-35), pas un conseil de tarif. */
export const DETAILS_MODELES: Record<string, string> = {
  opus: "Le plus capable, le plus coûteux",
  sonnet: "Rapide et solide au quotidien",
  haiku: "Le plus léger",
  inherit: "Celui choisi dans la conversation",
};

/* ─── Dates et couleurs ────────────────────────────────────────── */

const deux = (n: number) => String(n).padStart(2, "0");
const heure = (d: Date) => `${deux(d.getHours())}:${deux(d.getMinutes())}`;
const debutJour = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** « remise à zéro à 16:00 », « … demain à 09:00 », « … lundi à 09:00 », « … le 12 nov. à 09:00 » (E8-31). */
export function remiseAZero(ms: number, maintenant: number): string {
  const d = new Date(ms);
  const ecart = Math.round((debutJour(d) - debutJour(new Date(maintenant))) / 86_400_000);
  if (ecart === 0) return `remise à zéro à ${heure(d)}`;
  if (ecart === 1) return `remise à zéro demain à ${heure(d)}`;
  if (ecart > 1 && ecart < 7) return `remise à zéro ${JOURS[d.getDay()]} à ${heure(d)}`;
  return `remise à zéro le ${d.getDate()} ${MOIS[d.getMonth()]} à ${heure(d)}`;
}

/** « aujourd’hui, 13:40 », « hier, 18:02 », « le 2 nov., 09:00 » : la dernière vérification (E8-41). */
export function dateCourte(ms: number, maintenant: number): string {
  const d = new Date(ms);
  const ecart = Math.round((debutJour(d) - debutJour(new Date(maintenant))) / 86_400_000);
  if (ecart === 0) return `aujourd’hui, ${heure(d)}`;
  if (ecart === -1) return `hier, ${heure(d)}`;
  return `le ${d.getDate()} ${MOIS[d.getMonth()]}, ${heure(d)}`;
}

/** Le nom lisible d'une couleur d'équipe, jamais son token (spec lot 8 § 6, C-2f). */
export const NOMS_TEINTES: Record<RoleTeinte, string> = {
  "bleu-k1": "Bleu",
  "bleu-k2": "Bleu ciel",
  "bleu-k3": "Turquoise",
  violet: "Violet",
  rose: "Rose",
  rouge: "Rouge",
  orange: "Corail",
  "orange-k2": "Orange",
  jaune: "Jaune",
  ocre: "Ocre",
  vert: "Vert",
  "vert-k2": "Vert tendre",
};

export const initialesDe = (nom: string) =>
  nom
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((m) => m.charAt(0).toUpperCase())
    .join("") || "?";
