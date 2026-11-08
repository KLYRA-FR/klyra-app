/** Contrat partagé, sans dépendance à Electron ou à un fournisseur de modèle. */
export interface SourceCerveau { chatId: string; messageId: string; titre: string; extrait: string }
export interface NoteCerveau {
  id: string; titre: string; contenu: string; projetId: string | null; liens: string[];
  source: SourceCerveau | null; creeLe: string; modifieLe: string;
  revision?: number; agentId?: string | null; origine?: string | null;
}
export interface PorteeCerveau { projetId: string | null; agentId: string | null; proprietaire?: boolean }
export interface PointeurCerveau { id: string; noteId: string; titre: string; extrait: string; lignes: [number, number]; revision: number; agentId: string | null; projetId: string | null; origine: string | null; historique?: boolean }
export interface ResultatCerveau {
  elements: PointeurCerveau[]; tronque: boolean; budgetOctets: number; octets: number;
  jetonsEstimes: number; comptage: "estimation-octets-divises-par-3"; moteur: "index-lexical-local";
}
export interface EtatCerveau { notes: number; passages: number; octetsSources: number; dernierChangement: string | null }
export interface PageCerveau { notes: NoteCerveau[]; total: number; limite: number; suite: number | null; etat: EtatCerveau }
export type ActionCerveau = "lister" | "note" | "garder" | "oublier" | "chercher" | "lire" | "indexer-souvenirs";
export interface SourceDossier {
  id: string; nom: string; racine: string; etat: string; debut: string | null; fin: string | null; message: string;
  fichiers: number; indexes: number; inchanges: number; reperes: number; proteges: number; techniques: number;
  erreurs: number; octets: number; espaces: Record<string, number>;
}
