import { chaine, chaineOuNull, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import type { Artefact } from "@/types/domain";

/**
 * Les gestes « artefacts » que l'ordinateur fait pour le téléphone (spec mobile T-20). La liste
 * est sur l'ordinateur (`conversations.json`) ; le téléphone la lit, l'ouvre dans son navigateur,
 * et demande les changements ici.
 */

/** Un lien d'artefact Claude : claude.ai/artifact/… ou claude.ai/code/artifact/… (comme l'écran du bureau). */
export const LIEN_ARTEFACT = /^https:\/\/claude\.ai\/(code\/)?artifact\/[A-Za-z0-9-]+\/?$/;

export interface ArtefactLu {
  id: string;
  titre: string;
  description: string;
  url: string;
  projetId: string | null;
  projet: string | null;
  date: string;
}

export interface ListeArtefacts {
  artefacts: ArtefactLu[];
  projets: { id: string; nom: string }[];
}

export interface DepsArtefacts {
  ton: string;
  artefacts: () => Artefact[];
  projets: () => { id: string; name: string }[];
  synchroniser: () => Promise<{ total: number; nouveaux: number }>;
  modifier: (id: string, patch: Partial<Artefact>) => void;
  supprimer: (id: string) => void;
  ajouter: (artefact: Omit<Artefact, "id" | "ajouteLe">) => void;
  /** Connecté à claude.ai dans l'app de bureau (les aperçus en dépendent). */
  session: () => Promise<boolean>;
  /** Refait l'aperçu d'un artefact ; null s'il n'a pas pu être fait. */
  vignette: (url: string) => Promise<string | null>;
}

const sansBarre = (url: string) => url.replace(/\/$/, "");

export function gestesArtefacts(d: DepsArtefacts): Gestes {
  const existant = (id: string) => {
    const artefact = d.artefacts().find((x) => x.id === id);
    if (!artefact) throw new ErreurPoste("introuvable", `Cet artefact n’est plus dans la liste sur ${d.ton}.`);
    return artefact;
  };
  const projetValide = (projetId: string | null) => {
    if (projetId !== null && !d.projets().some((p) => p.id === projetId)) throw new ErreurPoste("arguments", "Demande illisible.");
    return projetId;
  };

  return {
    "artefacts.liste": async (): Promise<ListeArtefacts> => {
      const projets = d.projets();
      return {
        artefacts: d
          .artefacts()
          .map((x) => ({
            id: x.id,
            titre: x.titre,
            description: x.description,
            url: x.url,
            projetId: x.projectId,
            projet: projets.find((p) => p.id === x.projectId)?.name ?? null,
            date: x.misAJour ?? x.ajouteLe,
          }))
          .sort((x, y) => y.date.localeCompare(x.date)),
        projets: projets.map((p) => ({ id: p.id, nom: p.name })),
      };
    },

    "artefacts.synchroniser": async () => {
      try {
        return await d.synchroniser();
      } catch (e) {
        throw new ErreurPoste("erreur", (e instanceof Error ? e.message : String(e)).slice(0, 300));
      }
    },

    /** Les aperçus se refont sur l'ordinateur, en fond : le téléphone n'attend pas chaque page. */
    "artefacts.apercus": async () => {
      if (!(await d.session())) throw new ErreurPoste("apercu", `Aperçu indisponible : connecte claude.ai une fois dans l’app sur ${d.ton}.`);
      const urls = d.artefacts().map((x) => x.url);
      void (async () => {
        for (const url of urls) await d.vignette(url).catch(() => null);
      })();
      return { lances: urls.length };
    },

    "artefacts.modifier": async (args) => {
      const o = objet(args);
      const artefact = existant(chaine(o, "id", 100));
      const titre = chaine(o, "titre", 200).trim();
      const description = chaine(o, "description", 1000).trim();
      const projetId = projetValide(chaineOuNull(o, "projetId", 200));
      if (!titre) throw new ErreurPoste("invalide", "Donne-lui un titre.");
      d.modifier(artefact.id, { titre, titrePerso: titre !== artefact.titre || artefact.titrePerso, description, projectId: projetId });
      return { ok: true };
    },

    /** Retirer de la liste : l'artefact reste sur claude.ai. */
    "artefacts.retirer": async (args) => {
      const artefact = existant(chaine(objet(args), "id", 100));
      d.supprimer(artefact.id);
      return { ok: true };
    },

    "artefacts.ajouter": async (args) => {
      const o = objet(args);
      const url = chaine(o, "url", 300).trim();
      const titre = chaine(o, "titre", 200).trim();
      const projetId = projetValide(chaineOuNull(o, "projetId", 200));
      if (!LIEN_ARTEFACT.test(url)) throw new ErreurPoste("invalide", "Colle un lien claude.ai/artifact/…");
      if (!titre) throw new ErreurPoste("invalide", "Donne-lui un titre.");
      if (d.artefacts().some((x) => sansBarre(x.url) === sansBarre(url))) throw new ErreurPoste("invalide", "Cet artefact est déjà dans la liste.");
      d.ajouter({ url, titre, description: "", projectId: projetId, source: "manuel" });
      return { ok: true };
    },
  };
}
