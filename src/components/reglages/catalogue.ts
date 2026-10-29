import type { IconName } from "@/components/icons/Icon";

/**
 * Le plan des Réglages : les sections de la barre latérale, et chaque réglage
 * avec les mots qui le trouvent. La recherche lit ce catalogue ; chaque `id`
 * est l'ancre d'une `Ligne` de la section (cf. ui.tsx).
 */

export type IdSection = "general" | "profil" | "claude" | "agents" | "autres-ia" | "notifications" | "voix" | "computer-use" | "mises-a-jour";

export interface EntreeReglage {
  id: string;
  titre: string;
  /** Synonymes, sans accents ni majuscules nécessaires. */
  mots?: string;
}

export interface SectionReglages {
  id: IdSection;
  titre: string;
  icone: IconName;
  description: string;
  entrees: EntreeReglage[];
}

export const SECTIONS: SectionReglages[] = [
  {
    id: "general",
    titre: "Général",
    icone: "settings",
    description: "L’app sur cet ordinateur : son lancement, ses raccourcis, ses dossiers.",
    entrees: [
      { id: "lancement", titre: "Ouvrir KLYRA au démarrage", mots: "login session ouverture automatique demarrer" },
      { id: "raccourcis", titre: "Raccourcis clavier", mots: "touches clavier commande cmd ctrl" },
      { id: "dossier-donnees", titre: "Dossier des données de l’app", mots: "conversations stockage sauvegarde finder" },
      { id: "dossier-klyra", titre: "Dossier ~/.klyra", mots: "atelier planning whisper modele stockage" },
      { id: "version", titre: "Version de l’app", mots: "a propos electron systeme" },
    ],
  },
  {
    id: "profil",
    titre: "Profil",
    icone: "user-profile-01",
    description: "Qui tu es sur ce poste, et ce que tu as consommé avec tes agents.",
    entrees: [
      { id: "photo", titre: "Photo", mots: "avatar image recadrer modifier le profil" },
      { id: "nom", titre: "Prénom et rôle", mots: "nom titre identite modifier le profil" },
      { id: "chiffres", titre: "Jetons, messages et séries", mots: "consommation tokens record jour serie statistiques" },
      { id: "activite", titre: "Activité sur cet ordinateur", mots: "jours actifs calendrier chaleur annee" },
      { id: "apercu", titre: "Aperçu : fournisseur, modèle, coût estimé", mots: "facturation depense dollars prix cout consommation" },
      { id: "coequipiers", titre: "Coéquipiers les plus actifs", mots: "agents jetons classement" },
      { id: "modeles-utilisation", titre: "Utilisation des modèles", mots: "opus sonnet haiku gpt part pourcentage" },
      { id: "compte-profil", titre: "Compte", mots: "claude abonnement email" },
    ],
  },
  {
    id: "claude",
    titre: "Claude",
    icone: "stars",
    description: "Le compte par lequel tes agents travaillent, et ce qu’il en reste.",
    entrees: [
      { id: "compte-claude", titre: "Compte Claude", mots: "connexion deconnexion abonnement anthropic email organisation claude code" },
      { id: "utilisation", titre: "Utilisation", mots: "quota limite session 5 h semaine consommation" },
    ],
  },
  {
    id: "agents",
    titre: "Agents",
    icone: "users-profiles-01",
    description: "Ce que les agents peuvent faire seuls, et le modèle de chacun.",
    entrees: [
      { id: "acces", titre: "Accès des agents", mots: "permissions autorisations autonomie demander tout accepter" },
      { id: "modeles", titre: "Modèle de chaque agent", mots: "opus sonnet haiku role equipe fiche" },
      { id: "dossier-agents", titre: "Dossier des fiches", mots: "claude agents md fichiers" },
    ],
  },
  {
    id: "autres-ia",
    titre: "Autres IA",
    icone: "layers-01",
    description: "D’autres IA que Claude, que tes agents peuvent consulter. Leurs clés restent dans le trousseau du système.",
    entrees: [{ id: "autres-ia", titre: "IA ajoutées et clés", mots: "chatgpt openai gemini mistral cle api trousseau" }],
  },
  {
    id: "notifications",
    titre: "Notifications",
    icone: "bell-01",
    description: "Quand et comment l’app te prévient, si tu regardes ailleurs.",
    entrees: [
      { id: "notifications-systeme", titre: "Notifications du système", mots: "alertes bannieres activer couper" },
      { id: "pastille", titre: "Pastille sur l’icône", mots: "dock badge barre des taches clignoter" },
      { id: "son", titre: "Son", mots: "silencieux bruit" },
      { id: "evenements", titre: "Par événement", mots: "agent fini erreur workflow mise a jour" },
      { id: "essai-notification", titre: "Essayer", mots: "test" },
    ],
  },
  {
    id: "voix",
    titre: "Voix",
    icone: "microphone-01",
    description: "La dictée : tu parles, le texte s’écrit dans le message.",
    entrees: [
      { id: "moteur", titre: "Moteur de dictée", mots: "whisper local transcription elevenlabs" },
      { id: "langue-dictee", titre: "Langue de la dictée", mots: "francais transcription" },
      { id: "micro", titre: "Micro", mots: "microphone autorisation acces" },
      { id: "test-micro", titre: "Tester le micro", mots: "niveau son essai" },
    ],
  },
  {
    id: "computer-use",
    titre: "Computer Use",
    icone: "cursor-01",
    description: "Laisser tes agents piloter l’ordinateur : captures, clics et clavier, avec ton accord.",
    entrees: [
      { id: "computer-use-actif", titre: "Laisser les agents piloter l’ordinateur", mots: "activer desactiver interrupteur ecran souris clavier" },
      { id: "autorisation-accessibilite", titre: "Autorisation Accessibilité", mots: "macos permission systeme clic clavier" },
      { id: "autorisation-ecran", titre: "Autorisation Enregistrement de l’écran", mots: "macos permission capture" },
    ],
  },
  {
    id: "mises-a-jour",
    titre: "Mises à jour",
    icone: "refresh-01",
    description: "L’app se met à jour toute seule. Ici, tu vois où elle en est.",
    entrees: [
      { id: "version-installee", titre: "Version installée", mots: "numero" },
      { id: "version-disponible", titre: "Dernière version disponible", mots: "nouvelle publiee" },
      { id: "derniere-verification", titre: "Dernière vérification", mots: "date heure" },
      { id: "rechercher-maj", titre: "Rechercher une mise à jour", mots: "verifier maintenant nouvelle version" },
      { id: "installer-maj", titre: "Installer et relancer", mots: "redemarrer" },
      { id: "depot-versions", titre: "Toutes les versions", mots: "github releases klyra-app-versions telecharger" },
    ],
  },
];

/** Minuscules sans accents : « général » se trouve en tapant « general ». */
export function normaliser(texte: string): string {
  return texte.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export interface Resultat {
  section: SectionReglages;
  entree: EntreeReglage | null;
}

/**
 * Points d'un mot tapé dans un texte : mot identique, puis début de mot, puis
 * simple morceau. 0 : absent.
 */
function points(mot: string, texte: string, poids: number): number {
  const mots = normaliser(texte).split(/[^\p{L}\p{N}]+/u);
  if (mots.includes(mot)) return 3 * poids;
  if (mots.some((m) => m.startsWith(mot))) return 2 * poids;
  return normaliser(texte).includes(mot) ? poids * 0.5 : 0;
}

/**
 * Les réglages qui contiennent tous les mots tapés, les plus proches d'abord :
 * le titre compte plus que les synonymes, un mot entier plus qu'un morceau
 * (« son » donne « Son » avant « Sonnet »).
 */
export function chercher(requete: string): Resultat[] {
  const tapes = normaliser(requete).split(/\s+/).filter(Boolean);
  if (!tapes.length) return [];
  const notes: (Resultat & { note: number })[] = [];
  const noter = (r: Resultat, champs: [string, number][]) => {
    let note = 0;
    for (const mot of tapes) {
      const meilleur = Math.max(...champs.map(([texte, poids]) => points(mot, texte, poids)));
      if (!meilleur) return;
      note += meilleur;
    }
    notes.push({ ...r, note });
  };
  for (const section of SECTIONS) {
    noter({ section, entree: null }, [[section.titre, 4]]);
    for (const entree of section.entrees) {
      noter({ section, entree }, [
        [entree.titre, 4],
        [entree.mots ?? "", 2],
        [section.titre, 1],
      ]);
    }
  }
  return notes.sort((a, b) => b.note - a.note);
}

export const estSection = (id: string | null | undefined): id is IdSection => SECTIONS.some((s) => s.id === id);
