/** Contrat public du pont Composio : aucune clé, URL d'authentification ni donnée d'identification fournisseur. */
export interface VueCompteComposio {
  id: string;
  service: string;
  nom: string;
  alias: string | null;
  statut: string;
  desactive: boolean;
}

export interface VueServiceComposio {
  slug: string;
  nom: string;
  description: string;
  configurations: { id: string; nom: string; methode: string; active: boolean }[];
}

export interface EtatComposio {
  contexte: string;
  profil: { nom: string; type: "local" | "equipe" };
  configure: boolean;
  coffreDisponible: boolean;
  services: VueServiceComposio[];
  comptes: VueCompteComposio[];
  selections: Record<string, string>;
  enAttente: { compteId: string; service: string; expireLe: string | null }[];
  verifieLe: number | null;
  erreur: { code: string; message: string } | null;
}
