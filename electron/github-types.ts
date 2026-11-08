/** Données publiques de la connexion GitHub : aucun identifiant secret. */
export interface EtatGithubProjet {
  compte: string | null;
  connexion: { code: string; url: string } | null;
  enCours: boolean;
  erreur: string | null;
}
export interface DepotGithubProjet {
  nom: string;
  prive: boolean;
  branche: string;
  archive: boolean;
  /** Ce que GitHub dit du dépôt, pour le reconnaître et nommer le projet sans rien demander.
   * Absents d'un serveur d'avant leur ajout : l'écran fait sans. */
  description?: string | null;
  /** Son site (« homepage »), seulement en http(s). */
  site?: string | null;
  langage?: string | null;
  /** Date du dernier envoi sur GitHub (ISO). */
  pousseLe?: string | null;
}

/** L'état des tests (GitHub Actions et autres vérifications) d'un commit. */
export interface ResumeTests {
  etat: "aucun" | "en-cours" | "echec" | "reussi";
  total: number;
  reussis: number;
  echecs: number;
  enCours: number;
  /** Les vérifications en échec, pour aller voir. */
  echouees: { nom: string; url: string | null }[];
}

export interface PullRequestResume {
  numero: number;
  titre: string;
  auteur: string;
  /** La branche proposée. */
  branche: string;
  brouillon: boolean;
  url: string;
  majLe: string | null;
}

export interface CommitResume {
  sha: string;
  message: string;
  auteur: string;
  date: string | null;
  url: string;
}

/** Ce que GitHub dit du dépôt d'un projet, lu avec la connexion de sa machine (jamais le jeton). */
export interface ActiviteGithub {
  depot: string;
  url: string;
  branche: string | null;
  /** null : GitHub n'a pas répondu pour cette partie (droits, réseau). */
  pullRequests: PullRequestResume[] | null;
  tests: ResumeTests | null;
  commits: CommitResume[] | null;
}

/** Une pull request en détail, pour un agent (outil `github_pull_request`). */
export interface PullRequestDetail extends PullRequestResume {
  etat: "ouverte" | "fermee" | "fusionnee";
  base: string;
  description: string;
  fusionnable: string | null;
  commentaires: number;
  ajouts: number;
  suppressions: number;
  fichiers: { chemin: string; statut: string; ajouts: number; suppressions: number }[];
  /** Le dernier avis de chaque relecteur. */
  avis: { auteur: string; etat: string }[];
  tests: ResumeTests | null;
}

/** Un fichier changé, avant (dernier commit) et après (sur le disque), pour le montrer ligne à ligne. */
export interface DiffFichierGit {
  chemin: string;
  /** null : il n'existait pas au dernier commit (nouveau). */
  avant: string | null;
  /** null : il n'existe plus (supprimé). */
  apres: string | null;
  /** Un fichier binaire (image, archive…) : pas de texte à comparer. */
  binaire: boolean;
  /** Trop gros d'un côté (plus de 512 Ko) : pas montré. */
  tropGros: boolean;
}
