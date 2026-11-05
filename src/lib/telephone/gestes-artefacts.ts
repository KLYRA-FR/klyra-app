import { chaine, chaineOuNull, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import { renduDansEspace } from "@/lib/rendus-espace";
import type { Artefact, Rendu, TypeRendu } from "@/types/domain";

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

/**
 * Un rendu d'agent de ce PC, tel que le téléphone le lit (lot 7, contrat ajouté) : jamais son chemin,
 * l'`id` est le seul moyen de le désigner. `apercu` : l'ordinateur sait en dessiner une image.
 */
export interface RenduLu {
  id: string;
  titre: string;
  description: string;
  type: TypeRendu;
  agent: string;
  projetId: string | null;
  projet: string | null;
  date: string;
  apercu: boolean;
}

export interface ListeArtefacts {
  artefacts: ArtefactLu[];
  rendus: RenduLu[];
  /** Les rendus d'un autre espace : ils ne se mêlent pas à ceux-ci, mais ils existent. */
  rendusAilleurs: number;
  /** La source claude.ai est allumée sur l'ordinateur. */
  claude: boolean;
  projets: { id: string; nom: string }[];
}

/**
 * Ce que l'écran montre d'une lecture, dans l'espace que ce téléphone a choisi : un VPS n'a pas de liens
 * claude.ai (comme au bureau). Un ordinateur d'avant ce contrat n'envoie pas de rendus : `ancien` le dit,
 * ce n'est pas une liste vide.
 */
export function listeDeLEspace(lue: Partial<ListeArtefacts> & Pick<ListeArtefacts, "artefacts" | "projets">, lieu: string | null): ListeArtefacts & { ancien: boolean } {
  const claude = !lieu && (lue.claude ?? true);
  return { claude, artefacts: claude ? lue.artefacts : [], rendus: lue.rendus ?? [], rendusAilleurs: lue.rendusAilleurs ?? 0, projets: lue.projets, ancien: lue.rendus === undefined };
}

/** Ce que l'écran peut filtrer : un titre, une description, un projet. */
export function filtrerArtefacts<T extends { titre: string; description: string; projetId: string | null }>(liste: readonly T[], recherche: string, projet: string): T[] {
  const q = recherche.trim().toLowerCase();
  return liste.filter((a) => (!projet || a.projetId === projet) && (!q || `${a.titre} ${a.description}`.toLowerCase().includes(q)));
}

/** Une image venue de l'ordinateur : seulement une image en data URL, jamais une page ni une adresse. */
export function imageApercu(image: unknown): string | null {
  return typeof image === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(image) ? image : null;
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
  rendus: () => Rendu[];
  claude: () => boolean;
  nomAgent: (id: string) => string | null;
  /** L'image d'un rendu, dessinée par l'ordinateur ; `forcer` la redessine. */
  vignetteRendu: (chemin: string, forcer: boolean) => Promise<string | null>;
  /** Ouvre le rendu sur l'écran de l'ordinateur, copie locale ou fichier du serveur. Lève une erreur si ça n'a pas marché. */
  ouvrirRendu: (rendu: Rendu) => Promise<void>;
  /** Retire le partage de ce rendu du compte, s'il y en a un (le bureau fait pareil). */
  retirerPartage: (origine: string, lieu: string | null) => Promise<void>;
  retirerRendu: (id: string) => void;
}

const sansBarre = (url: string) => url.replace(/\/$/, "");
/** Ce que l'ordinateur sait dessiner, comme la carte du bureau. */
const apercuPossible = (r: Rendu) => !!r.chemin && (r.type === "page" || r.type === "image");

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

  /* Séparation stricte : un rendu ne se lit, ne s'ouvre et ne se retire que dans l'espace que le téléphone a choisi. */
  const lieuDe = (args: unknown) => chaineOuNull(objet(args ?? {}), "lieu", 260);
  const renduIci = (args: unknown) => {
    const id = chaine(objet(args), "id", 100);
    const lieu = lieuDe(args);
    const rendu = d.rendus().find((r) => r.id === id && renduDansEspace(r.origine, lieu));
    if (!rendu) throw new ErreurPoste("introuvable", `Ce rendu n’est plus dans la liste sur ${d.ton}.`);
    return { rendu, lieu };
  };

  return {
    "artefacts.liste": async (args): Promise<ListeArtefacts> => {
      const lieu = lieuDe(args);
      const projets = d.projets();
      const nomProjet = (id: string | null) => projets.find((p) => p.id === id)?.name ?? null;
      const rendus = d.rendus();
      /* Les artefacts de claude.ai sont à l'ordinateur, comme au bureau : un VPS n'en a pas. */
      const claude = lieu === null && d.claude();
      return {
        claude,
        rendusAilleurs: rendus.filter((r) => !renduDansEspace(r.origine, lieu)).length,
        rendus: rendus
          .filter((r) => renduDansEspace(r.origine, lieu))
          .map((r) => ({
            id: r.id,
            titre: r.titre,
            description: r.description,
            type: r.type,
            agent: d.nomAgent(r.roleId) ?? "Agent indisponible",
            projetId: r.projectId,
            projet: nomProjet(r.projectId),
            date: r.misAJour,
            apercu: apercuPossible(r),
          }))
          .sort((x, y) => y.date.localeCompare(x.date)),
        artefacts: (claude ? d.artefacts() : [])
          .map((x) => ({
            id: x.id,
            titre: x.titre,
            description: x.description,
            url: x.url,
            projetId: x.projectId,
            projet: nomProjet(x.projectId),
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
      const urls = d.claude() ? d.artefacts().map((x) => x.url) : [];
      const copies = d.rendus().filter((r) => apercuPossible(r) && renduDansEspace(r.origine, null)).map((r) => r.chemin);
      void (async () => {
        for (const url of urls) await d.vignette(url).catch(() => null);
        for (const chemin of copies) await d.vignetteRendu(chemin, true).catch(() => null);
      })();
      return { lances: urls.length + copies.length };
    },

    /** L'image d'un rendu, dessinée par l'ordinateur. Null : pas d'aperçu, ce n'est pas un rendu vide. */
    "rendus.apercu": async (args) => {
      const { rendu } = renduIci(args);
      if (!apercuPossible(rendu)) return { image: null };
      try {
        return { image: imageApercu(await d.vignetteRendu(rendu.chemin, false)) };
      } catch {
        return { image: null };
      }
    },

    /** « Ouvrir sur ton Mac » : le rendu s'ouvre sur l'écran de l'ordinateur, le téléphone ne reçoit rien. */
    "rendus.ouvrir": async (args) => {
      const { rendu } = renduIci(args);
      try {
        await d.ouvrirRendu(rendu);
      } catch (e) {
        throw new ErreurPoste("erreur", `Ce rendu n’a pas pu s’ouvrir sur ${d.ton}.`, { cause: e });
      }
      return { ok: true };
    },

    /** Retirer : la copie de KLYRA part, l'original de l'agent reste (`retirerRendu`, `supprimerCopieRendu`). */
    "rendus.retirer": async (args) => {
      const { rendu, lieu } = renduIci(args);
      await d.retirerPartage(rendu.origine, lieu);
      d.retirerRendu(rendu.id);
      return { ok: true };
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
