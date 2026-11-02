import type { KlyraBridge } from "@/lib/bridge";
import { booleen, chaine, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import type { Project } from "@/types/domain";
import { cheminDemande, erreurLecture, niveauDossier, ouvrableADistance, statutValide, type FichierLu, type NiveauDossier, type ProjetModifiable } from "./dossiers";

/**
 * Gestes « fichiers » et « projets » que l'ordinateur fait pour le téléphone (spec T-10 à T-13),
 * sans React : `useGestesFichiers` (src/lib/poste/gestes/fichiers.ts) leur donne l'état de l'app.
 * Le téléphone donne l'id d'un projet, jamais son dossier : le dossier vient d'ici. Chaque chemin
 * reçu passe par `cheminDemande` (rien hors du projet), puis par la garde du main (`cheminDansProjet`).
 * Un projet d'un VPS est lu par l'app de bureau, comme au bureau. Le contenu lu n'est gardé nulle part.
 */
export interface DependancesFichiers {
  projets: Project[];
  /** Les projets du pont Electron ; null hors de l'app de bureau. */
  pont: Pick<KlyraBridge["projets"], "arbre" | "lireFichier" | "ouvrirFichier"> | null;
  /** Les fichiers d'un projet modifiés par les agents (`fichiersModifies`). */
  modifies: (projetId: string) => Set<string>;
  enregistrer: (projet: Project) => void;
  /** Envoie la carte du projet au compte, pour que le téléphone la voie tout de suite. */
  publier: (projet: Project) => Promise<unknown>;
  /** « ton Mac », « ton PC » : le poste qui répond. */
  ton: string;
}

function modifiable(projet: Project): ProjetModifiable {
  return { nom: projet.name, accroche: projet.subtitle, brief: projet.brief, statut: projet.status, epingle: projet.pinned };
}

export function gestesFichiers({ projets, pont, modifies, enregistrer, publier, ton }: DependancesFichiers): Gestes {
  const projetDe = (args: Record<string, unknown>): Project => {
    const id = chaine(args, "projetId", 200);
    const projet = projets.find((p) => p.id === id);
    if (!projet) throw new ErreurPoste("introuvable", `Ce projet n’est plus sur ${ton}.`);
    return projet;
  };

  const lirePont = () => {
    if (!pont) throw new ErreurPoste("bureau", "Les fichiers d’un projet se lisent dans l’app de bureau.");
    return pont;
  };

  return {
    /** Un niveau du dossier (T-12), marqué et coupé. `chemin` "" : la racine du projet. */
    "fichiers.arbre": async (brut): Promise<NiveauDossier> => {
      const args = objet(brut);
      const projet = projetDe(args);
      const chemin = cheminDemande(args.chemin, { racine: true });
      const r = await lirePont().arbre(projet.folder, chemin || undefined, projet.lieu ?? null);
      if (!r.ok) throw erreurLecture(r.message, "dossier", ton);
      return niveauDossier(r.data, modifies(projet.id));
    },

    /** Un fichier pour la visionneuse (T-13) : lu et mis en forme ici (xlsx, docx…), plafonné comme au bureau. */
    "fichiers.lire": async (brut): Promise<FichierLu> => {
      const args = objet(brut);
      const projet = projetDe(args);
      const chemin = cheminDemande(args.chemin, { racine: false });
      const r = await lirePont().lireFichier(projet.folder, chemin, projet.lieu ?? null);
      if (!r.ok) throw erreurLecture(r.message, "fichier", ton);
      return { contenu: r.data, surPoste: !projet.lieu };
    },

    /** « Ouvrir sur ton Mac » : l'app par défaut de l'ordinateur, sur son écran. Des documents, jamais un programme. */
    "fichiers.ouvrir": async (brut) => {
      const args = objet(brut);
      const projet = projetDe(args);
      const chemin = cheminDemande(args.chemin, { racine: false });
      if (projet.lieu) throw new ErreurPoste("vps", `Ce fichier est sur un VPS : il ne s’ouvre pas sur ${ton}.`);
      if (!ouvrableADistance(chemin)) throw new ErreurPoste("type", `Ce type de fichier ne s’ouvre pas à distance : il pourrait lancer un programme sur ${ton}.`);
      const r = await lirePont().ouvrirFichier(projet.folder, chemin);
      if (!r.ok) throw erreurLecture(r.message, "fichier", ton);
      return null;
    },

    /** Ce qu'on peut modifier d'un projet depuis le téléphone, tel qu'il est sur l'ordinateur. */
    "projets.lire": async (brut): Promise<ProjetModifiable> => modifiable(projetDe(objet(brut))),

    /** Nom, ligne, brief, statut, épingle. Le dossier se choisit sur l'ordinateur (P-8). */
    "projets.modifier": async (brut): Promise<ProjetModifiable> => {
      const args = objet(brut);
      const projet = projetDe(args);
      const nom = chaine(args, "nom", 120).trim();
      if (!nom) throw new ErreurPoste("arguments", "Donne-lui un nom.");
      if (!statutValide(args.statut)) throw new ErreurPoste("arguments", "Demande illisible.");
      const modifie: Project = {
        ...projet,
        name: nom,
        subtitle: chaine(args, "accroche", 200).trim(),
        brief: chaine(args, "brief", 20_000).trim(),
        status: args.statut,
        pinned: booleen(args, "epingle"),
        updatedAt: new Date().toISOString(),
      };
      enregistrer(modifie);
      /* La copie du compte ne suit que le nombre de projets : la carte part tout de suite. */
      await publier(modifie).catch(() => undefined);
      return modifiable(modifie);
    },
  };
}
