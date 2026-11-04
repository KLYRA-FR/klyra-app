import type { IconName } from "@/components/icons/Icon";

/**
 * Le plan des Réglages : les sections de la barre latérale, et chaque réglage
 * avec les mots qui le trouvent. La recherche lit ce catalogue ; chaque `id`
 * est l'ancre d'une `Ligne` de la section (cf. ui.tsx).
 */

export type IdSection = "general" | "profil" | "equipe" | "mobile" | "claude" | "agents" | "coffre" | "autres-ia" | "notifications" | "voix" | "computer-use" | "navigateur" | "marketplace" | "mises-a-jour";

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
      { id: "vue-consommation", titre: "Tout Claude Code ou seulement KLYRA", mots: "terminal ide global consommation" },
      { id: "chiffres", titre: "Jetons, messages et séries", mots: "consommation tokens record jour serie statistiques" },
      { id: "limites", titre: "Limites de l’abonnement", mots: "session 5 h semaine quota remise a zero pourcentage" },
      { id: "non-compte", titre: "Ce qui ne peut pas être compté", mots: "claude.ai web mobile autres ordinateurs synchronisation" },
      { id: "activite", titre: "Activité sur cet ordinateur", mots: "jours actifs calendrier chaleur annee" },
      { id: "apercu", titre: "Aperçu : fournisseur, modèle, coût estimé", mots: "facturation depense dollars prix cout consommation" },
      { id: "coequipiers", titre: "Coéquipiers les plus actifs", mots: "agents jetons classement" },
      { id: "modeles-utilisation", titre: "Utilisation des modèles", mots: "opus sonnet haiku gpt part pourcentage" },
      { id: "compte-profil", titre: "Compte", mots: "claude abonnement email" },
    ],
  },
  {
    id: "equipe",
    titre: "Équipe",
    icone: "users-profiles-plus",
    description: "Ton compte d’équipe, en ligne : les membres, leurs rôles et les invitations.",
    entrees: [
      { id: "compte-equipe", titre: "Compte d’équipe", mots: "connexion deconnexion lien magique e-mail adresse session" },
      { id: "profil-equipe", titre: "Ton profil d’équipe", mots: "nom intitule couleur" },
      { id: "membres", titre: "Membres de l’équipe", mots: "equipe role admin retirer personnes membres" },
      { id: "inviter", titre: "Inviter quelqu’un", mots: "invitation ajouter adresse admin membre" },
      { id: "invitations", titre: "Invitations en attente", mots: "annuler invitation" },
    ],
  },
  {
    id: "mobile",
    titre: "Mobile",
    icone: "iphone-02",
    description: "Ton téléphone : par où il passe, comment le relier, et les téléphones connectés à ton compte.",
    entrees: [
      { id: "mobile-chemin", titre: "Par où passe ton téléphone", mots: "iphone android telephone chemin relais pc mac ouvert ferme postes ordinateurs presence vps hote" },
      { id: "mobile-telephones", titre: "Téléphones connectés", mots: "appareils sessions deconnecter revoquer perdu vole navigateur" },
      { id: "mobile-relier", titre: "Relier un téléphone", mots: "qr code scanner installer ecran d accueil adresse lien connexion ajouter" },
      { id: "mobile-vps", titre: "Le VPS et ton téléphone", mots: "serveur klyra-vps tailscale routines agents" },
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
      { id: "cle-admin", titre: "Organisation Console : usage et coût réels", mots: "cle admin api anthropic facturation cout reel console organisation" },
    ],
  },
  {
    id: "agents",
    titre: "Agents",
    icone: "users-profiles-01",
    description: "Ce que les agents peuvent faire seuls, et le modèle de chacun.",
    entrees: [
      { id: "configuration-klyra", titre: "Configuration KLYRA recommandée", mots: "jetons economie consommation cout tokens sobriete" },
      { id: "memoire-agents", titre: "Mémoire des agents", mots: "memory souvenirs jetons economie" },
      { id: "consignes-klyra", titre: "Consignes KLYRA", mots: "instructions claude.md agents.md jetons economie regles" },
      { id: "resume-auto", titre: "Résumé automatique des conversations", mots: "compact compacter resumer contexte jetons economie" },
      { id: "diagnostic-poste", titre: "Ce que ton poste ajoute", mots: "claude.md plugins skills mcp configuration personnelle jetons diagnostic" },
      { id: "acces", titre: "Accès des agents", mots: "permissions autorisations autonomie demander tout accepter" },
      { id: "assistant", titre: "Ton assistant", mots: "assistant principal nom renommer couleur" },
      { id: "modeles", titre: "Modèle de chaque agent", mots: "opus sonnet haiku role equipe fiche fournisseur chatgpt claude codex par defaut" },
      { id: "skills-par-agent", titre: "Skills de chaque agent", mots: "competences skill interrupteur couper allumer iris jetons importer dossier" },
      { id: "dossier-agents", titre: "Dossier des fiches", mots: "claude agents md fichiers" },
    ],
  },
  {
    id: "coffre",
    titre: "Coffre",
    icone: "lock-01",
    description: "Tes mots de passe et tes clés API, chiffrés par le trousseau de ton ordinateur. Tes agents s’en servent sans jamais les voir.",
    entrees: [
      { id: "coffre-secrets", titre: "Clés et mots de passe", mots: "vault coffre-fort secrets cle api token jeton mot de passe password copier ajouter remplacer env trousseau" },
      { id: "coffre-connexions", titre: "Connexions de sites", mots: "navigateur identifiants login mot de passe remplir site" },
      { id: "coffre-agents", titre: "Ce que tes agents en font", mots: "agents demander carte securisee coller env gitignore fichier" },
      { id: "coffre-demander", titre: "Donner une clé à un agent", mots: "coller cle api agent conversation securise" },
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
    description: "Quand et comment l’app te prévient, si tu regardes ailleurs, et ses sons.",
    entrees: [
      { id: "notifications-systeme", titre: "Notifications du système", mots: "alertes bannieres activer couper" },
      { id: "pastille", titre: "Pastille sur l’icône", mots: "dock badge barre des taches clignoter" },
      { id: "son", titre: "Son", mots: "silencieux bruit" },
      { id: "evenements", titre: "Par événement", mots: "agent fini erreur workflow mise a jour" },
      { id: "essai-notification", titre: "Essayer", mots: "test" },
      { id: "son-fin-tache", titre: "Émettre un son à la fin d’une tâche", mots: "sons agent fini termine" },
      { id: "sons-actions", titre: "Sons des actions", mots: "theme desactive silence chaleureux mecanique petillant clavier verre bois clics loquets gouttes bulles touches envoi interface clic menu fenetre onglet microinteractions" },
      { id: "volume-sons", titre: "Volume des sons", mots: "fort faible niveau" },
    ],
  },
  {
    id: "voix",
    titre: "Voix",
    icone: "microphone-01",
    description: "La dictée : tu parles, le texte s’écrit dans le message.",
    entrees: [
      { id: "moteur", titre: "Moteur de dictée", mots: "whisper local transcription elevenlabs scribe en ligne" },
      { id: "cle-elevenlabs", titre: "Clé ElevenLabs", mots: "api scribe trousseau dictee rapide en direct" },
      { id: "modele-local", titre: "Modèle de la dictée locale", mots: "whisper rapide precis small turbo telecharger hors ligne" },
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
    id: "navigateur",
    titre: "Navigateur",
    icone: "computer",
    description: "Le navigateur de KLYRA : les pages que tes agents utilisent pour toi, sous tes yeux, dans le panneau de chaque conversation.",
    entrees: [
      { id: "navigateur-agents", titre: "Laisser les agents utiliser le navigateur", mots: "web site page onglets computer use pilotage formulaire clic internet chrome" },
      { id: "navigateur-donnees", titre: "Connexions et cookies", mots: "effacer donnees navigation session cache vider deconnecter" },
      { id: "navigateur-telechargements", titre: "Téléchargements", mots: "fichiers telecharges dossier downloads" },
      { id: "navigateur-coffre", titre: "Mots de passe du navigateur", mots: "coffre identifiants connexion login mot de passe remplir trousseau" },
    ],
  },
  {
    id: "marketplace",
    titre: "Marketplace",
    icone: "boutique-01",
    description: "Les apps que tes agents peuvent utiliser.",
    entrees: [
      { id: "composio", titre: "Composio", mots: "apps connexion gmail slack notion google drive outils integrations" },
      { id: "apps-directes", titre: "Apps branchées en direct", mots: "mcp github linear supabase neon stripe serveur" },
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
      { id: "changelog", titre: "Nouveautés", mots: "changelog notes versions nouveautes site" },
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
  return chercherDans(SECTIONS, requete);
}

/** La même recherche, dans d'autres sections (les Réglages du serveur) ; chaque résultat garde sa note. */
export function chercherDans<S extends { titre: string; entrees: EntreeReglage[] }>(sections: S[], requete: string): { section: S; entree: EntreeReglage | null; note: number }[] {
  const tapes = normaliser(requete).split(/\s+/).filter(Boolean);
  if (!tapes.length) return [];
  type R = { section: S; entree: EntreeReglage | null };
  const notes: (R & { note: number })[] = [];
  const noter = (r: R, champs: [string, number][]) => {
    let note = 0;
    for (const mot of tapes) {
      const meilleur = Math.max(...champs.map(([texte, poids]) => points(mot, texte, poids)));
      if (!meilleur) return;
      note += meilleur;
    }
    notes.push({ ...r, note });
  };
  for (const section of sections) {
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
