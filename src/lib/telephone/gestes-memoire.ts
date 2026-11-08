import { chaine, chaineOuNull, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";

/**
 * Les gestes « mémoire » que l'ordinateur fait pour le téléphone : chercher dans le second cerveau et dans le
 * graphe des souvenirs, lire un passage ou un souvenir, lister les souvenirs récents. Lecture seule : écrire,
 * oublier, entretenir restent sur l'ordinateur. L'ordinateur lit l'espace que le téléphone a choisi (ce PC, ou
 * un VPS par le pont habituel) ; jamais un chemin du disque dans la réponse (les origines sont déjà lisibles :
 * « DIGITAL-OS/… », « document importé », « conversation »…).
 */

export interface NoteTrouvee { id: string; titre: string; extrait: string; origine: string | null; historique: boolean }
export interface SouvenirLu { id: string; nom: string; agent: string | null; nomAgent: string | null; type: string | null; resume: string; date: string | null; projet: string | null }
export interface ResultatsMemoire {
  requete: string;
  notes: NoteTrouvee[];
  souvenirs: (SouvenirLu & { trouveDans: string; extrait: string })[];
  /** Ce qu'une source n'a pas pu lire (serveur d'avant, mémoire indisponible) : jamais un faux « rien ». */
  manques: string[];
}
export interface SouvenirsRecents { souvenirs: (SouvenirLu & { liens: number })[]; total: number; tronque: boolean }
export interface PassageLu { titre: string; texte: string; origine: string | null; lignes: [number, number] }
export interface SouvenirOuvert { souvenir: SouvenirLu; texte: string; tronque: boolean; voisins: { relation: string; id?: string; nom?: string; projet?: string; nomAgent?: string | null }[] }

export interface DepsMemoire {
  /** `appelerCerveau` du bureau : ce PC (lieu null) ou un VPS. */
  appeler: <T>(lieu: string | null, action: string, args: Record<string, unknown>) => Promise<T>;
  nomAgent: (id: string) => string | null;
}

const BUDGET = 16384;
type PointeurBrut = { id: string; titre: string; extrait: string; origine: string | null; historique?: boolean; lignes: [number, number] };
type LigneGraphe = { id: string; nom: string; agent: string | null; type: string | null; resume: string; date: string | null; projet: string | null; liens?: number; trouveDans?: string; extrait?: string };

function messageServeur(e: unknown, lieu: string | null): string {
  const m = e instanceof Error ? e.message : "Lecture impossible.";
  return lieu && /inconnue/.test(m) ? "Ce serveur doit être mis à jour pour lire le graphe des souvenirs (relancer son installation)." : m;
}

export function gestesMemoire(d: DepsMemoire): Gestes {
  const souvenir = (l: LigneGraphe): SouvenirLu => ({ id: l.id, nom: l.nom, agent: l.agent, nomAgent: l.agent ? d.nomAgent(l.agent) : null, type: l.type, resume: l.resume, date: l.date, projet: l.projet ?? null });
  return {
    "memoire.chercher": async (args): Promise<ResultatsMemoire> => {
      const a = objet(args), lieu = chaineOuNull(a, "lieu", 500), requete = chaine(a, "requete", 300).trim();
      if (requete.length < 2) throw new ErreurPoste("arguments", "Écris au moins deux lettres.");
      const [notes, graphe] = await Promise.allSettled([
        d.appeler<{ elements: PointeurBrut[] }>(lieu, "chercher", { requete, budgetOctets: BUDGET }),
        d.appeler<{ resultats?: LigneGraphe[] }>(lieu, "graphe-lire", { requete, budgetOctets: BUDGET }),
      ]);
      const manques: string[] = [];
      if (notes.status === "rejected") manques.push(`Notes et sources : ${messageServeur(notes.reason, lieu)}`);
      if (graphe.status === "rejected") manques.push(`Souvenirs des agents : ${messageServeur(graphe.reason, lieu)}`);
      return {
        requete,
        notes: notes.status === "fulfilled" ? notes.value.elements.map((p) => ({ id: p.id, titre: p.titre, extrait: p.extrait, origine: p.origine, historique: p.historique === true })) : [],
        souvenirs: graphe.status === "fulfilled" ? (graphe.value.resultats ?? []).map((l) => ({ ...souvenir(l), trouveDans: l.trouveDans ?? "nom", extrait: l.extrait ?? l.resume })) : [],
        manques,
      };
    },
    "memoire.souvenirs": async (args): Promise<SouvenirsRecents> => {
      const a = objet(args), lieu = chaineOuNull(a, "lieu", 500), agent = chaineOuNull(a, "agent", 64);
      try {
        const r = await d.appeler<{ souvenirs: LigneGraphe[]; total: number; tronque: boolean }>(lieu, "graphe-lire", { ...(agent ? { agent } : {}), budgetOctets: BUDGET });
        return { souvenirs: r.souvenirs.map((l) => ({ ...souvenir(l), liens: l.liens ?? 0 })), total: r.total, tronque: r.tronque };
      } catch (e) {
        throw new ErreurPoste("memoire", messageServeur(e, lieu));
      }
    },
    "memoire.lire": async (args): Promise<PassageLu> => {
      const a = objet(args), lieu = chaineOuNull(a, "lieu", 500), id = chaine(a, "id", 200);
      const r = await d.appeler<{ elements: PointeurBrut[] }>(lieu, "lire", { ids: [id], budgetOctets: BUDGET });
      const p = r.elements[0];
      if (!p) throw new ErreurPoste("introuvable", "Ce passage a changé depuis : relance la recherche.");
      return { titre: p.titre, texte: p.extrait, origine: p.origine, lignes: p.lignes };
    },
    "memoire.souvenir": async (args): Promise<SouvenirOuvert> => {
      const a = objet(args), lieu = chaineOuNull(a, "lieu", 500), id = chaine(a, "id", 200);
      type VoisinBrut = { relation: string; id?: string; nom?: string; projet?: string; agent?: string | null };
      let r: { trouve: boolean; message?: string; souvenir?: LigneGraphe; texte?: string; tronque?: boolean; voisins?: VoisinBrut[] };
      try { r = await d.appeler(lieu, "graphe-lire", { souvenir: id, budgetOctets: BUDGET }); } catch (e) { throw new ErreurPoste("memoire", messageServeur(e, lieu)); }
      if (!r.trouve || !r.souvenir) throw new ErreurPoste("introuvable", r.message ?? "Ce souvenir n’existe plus.");
      return {
        souvenir: souvenir(r.souvenir), texte: r.texte ?? "", tronque: r.tronque === true,
        voisins: (r.voisins ?? []).map((v) => ({ relation: v.relation, id: v.id, nom: v.nom, projet: v.projet, nomAgent: v.agent ? d.nomAgent(v.agent) : null })),
      };
    },
  };
}
