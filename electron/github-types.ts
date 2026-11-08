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
