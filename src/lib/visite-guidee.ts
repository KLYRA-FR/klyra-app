/** La visite ne déclenche que des navigations, jamais une action métier. */
export const ETAPES_VISITE = [
  { id: "accueil", href: "/", cible: '[data-visite="/"]', titre: "Accueil", texte: "C’est ton point de départ. Écris ce dont tu as besoin à ton assistant, ou pars d’une suggestion pour préparer ta demande.", repere: "La zone de saisie sert à commencer un échange." },
  { id: "chats", href: "/chats", cible: '[data-visite="/chats"]', titre: "Chats", texte: "Retrouve tes échanges avec ton assistant et tes agents. Chaque conversation garde son contexte : tu peux y revenir pour poursuivre le travail.", repere: "Choisis un agent dans la colonne de gauche pour lui parler." },
  { id: "agents", href: "/equipe", cible: 'a[href="/equipe"]', titre: "Mes agents", texte: "Tes spécialistes sont réunis ici, avec leur rôle et leurs consignes. Tu peux consulter leurs fiches et construire une équipe adaptée à tes besoins.", repere: "Tu peux aussi demander à ton assistant de t’aider à créer un agent." },
  { id: "tickets", href: "/tickets", cible: '[data-visite="/tickets"]', titre: "Tickets et fils", texte: "Un fil suit une tâche dans un onglet de conversation. Les tickets te montrent ce qui avance, ce qui est bloqué et ce qui attend ta validation.", repere: "Ouvre un ticket pour préciser la demande ou examiner le résultat avant de le valider." },
  { id: "planning", href: "/planning", cible: '[data-visite="/planning"]', titre: "Planning", texte: "Retrouve tes rappels et tes rendez-vous pour organiser ta journée et ta semaine.", repere: "Choisis une date pour consulter ce qui est prévu et ajouter un élément." },
  { id: "automatisations", href: "/routines", cible: '[data-visite="/routines"]', titre: "Automatisations", texte: "Prépare les tâches qui reviennent et les suites d’actions à confier aux agents. Tu retrouves ici leurs réglages et leur suivi.", repere: "Vérifie les actions et le déclenchement avant d’activer une automatisation." },
  { id: "artefacts", href: "/artefacts", cible: '[data-visite="/artefacts"]', titre: "Artefacts", texte: "Les documents, images et autres livrables produits pour toi se retrouvent ici. Tu peux les ouvrir sans rechercher le message qui les accompagnait.", repere: "Pour faire évoluer un résultat, retourne dans le fil qui l’a produit." },
  { id: "projets", href: "/projets", cible: '[data-visite="/projets"]', titre: "Projets", texte: "Rassemble les fichiers et les conversations d’un même sujet ou client. Un projet donne un espace commun au travail qui lui appartient.", repere: "Ouvre un projet pour retrouver ses documents et poursuivre ses échanges." },
  { id: "connexions", href: "/reglages?section=marketplace", cible: '#titre-composio', titre: "Connexions aux apps", texte: "La Marketplace des réglages permet de relier tes outils aux agents. Choisis une app, puis suis son parcours d’autorisation lorsque tu en as besoin.", repere: "La visite ne connecte aucun compte. Vérifie toujours l’espace concerné : ton ordinateur ou un serveur." },
  { id: "serveurs", href: "/serveurs", cible: 'main h1', titre: "Serveurs", texte: "Cet écran te permet de rejoindre et de retrouver des espaces de travail distants. Un serveur possède ses propres agents, fichiers et connexions.", repere: "Vérifie l’espace actif avant de lancer une tâche : les fichiers de ton ordinateur ne sont pas ceux du serveur." },
  { id: "reglages", href: "/reglages?section=general", cible: '#revoir-visite-guidee', titre: "Réglages et aide", texte: "Personnalise ton profil, tes accès et le fonctionnement de KLYRA depuis les réglages, accessibles par ton avatar.", repere: "Dans Général → Aide et découverte, tu peux revoir ce tutoriel à tout moment." },
] as const;

export const CLE_VISITE = "klyra:visite-guidee:v1";
export type ProgressionVisite = { version: 1; statut: "en-cours" | "pause" | "terminee" | "passee"; etape: number };

export function lireProgressionVisite(valeur: string | null): ProgressionVisite | null {
  try {
    const v = JSON.parse(valeur ?? "null");
    if (!v || v.version !== 1 || !["en-cours", "pause", "terminee", "passee"].includes(v.statut) || !Number.isInteger(v.etape) || v.etape < 0 || v.etape >= ETAPES_VISITE.length) return null;
    // Une fermeture de l’app ne doit pas imposer la visite au prochain lancement.
    return { version: 1, statut: v.statut === "en-cours" ? "pause" : v.statut, etape: v.etape };
  } catch { return null; }
}
