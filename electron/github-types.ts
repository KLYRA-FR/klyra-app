/** Données publiques de la connexion GitHub : aucun identifiant secret. */
export interface EtatGithubProjet {
  compte: string | null;
  connexion: { code: string; url: string } | null;
  enCours: boolean;
  erreur: string | null;
}
export interface DepotGithubProjet { nom: string; prive: boolean; branche: string; archive: boolean }
