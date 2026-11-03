/**
 * Les livrables des agents du VPS (outil `publier_artefact`, cf. serveur/ia.mjs) : comme dans l'app
 * (electron/rendus.ts), un fichier ou le dossier d'une page avec index.html, 300 Mo au plus, sans
 * node_modules ni .git. Le VPS ne copie rien : il retient la publication (`donnees/rendus.json`),
 * prévient l'app par le journal des événements (type `rendu`), et ne sert ensuite que ces fichiers-là
 * à l'appareil relié, qui en garde la copie sur l'ordinateur (electron/rendus-vps.ts).
 * Rien hors du dossier de klyra.
 */
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

export const TAILLE_MAX = 300 * 1024 * 1024;
const FICHIERS_MAX = 5000;
const IGNORES = new Set(["node_modules", ".git", ".next", ".turbo", ".cache", "dist-electron"]);
const GARDES = 500;

export class ErreurRendu extends Error {}

/**
 * @param {{ home: string, donnees: string, publier: (requestId: string, event: unknown, sessionId: string | null) => void, maintenant?: () => number }} options
 */
export function creerRendus(options) {
  const racine = path.resolve(options.home);
  const fichier = path.join(options.donnees, "rendus.json");
  const maintenant = options.maintenant ?? Date.now;

  function lire() {
    try {
      const liste = JSON.parse(readFileSync(fichier, "utf8"));
      return Array.isArray(liste) ? liste : [];
    } catch {
      return [];
    }
  }
  function ecrire(liste) {
    mkdirSync(path.dirname(fichier), { recursive: true });
    const tmp = `${fichier}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(liste.slice(0, GARDES)), { mode: 0o600 });
    renameSync(tmp, fichier);
  }

  /** Un chemin du dossier de klyra (« ~/… » compris), ou une erreur qui dit quoi corriger. */
  function cheminDuVps(brut) {
    const texte = typeof brut === "string" ? brut.trim() : "";
    if (!texte) throw new ErreurRendu("Indique le chemin du fichier (chemin).");
    const complet = texte.startsWith("~/") ? path.join(racine, texte.slice(2)) : texte;
    if (!path.isAbsolute(complet)) throw new ErreurRendu(`Donne le chemin complet du fichier, pas « ${texte} ».`);
    const resolu = path.resolve(complet);
    const rel = path.relative(racine, resolu);
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw new ErreurRendu(`Seuls les fichiers sous ${racine} se publient depuis ce VPS.`);
    return resolu;
  }

  /** Les fichiers d'une publication, en chemins relatifs, sans les dossiers ignorés ; leur poids total. */
  function contenu(chemin, dossier) {
    if (!dossier) return { fichiers: [{ relatif: path.basename(chemin), taille: statSync(chemin).size }], total: statSync(chemin).size };
    const fichiers = [];
    let total = 0;
    const parcourir = (relatif) => {
      for (const e of readdirSync(path.join(chemin, relatif), { withFileTypes: true })) {
        if (IGNORES.has(e.name)) continue;
        const sous = relatif ? `${relatif}/${e.name}` : e.name;
        if (e.isDirectory()) parcourir(sous);
        else if (e.isFile()) {
          if (fichiers.length >= FICHIERS_MAX) throw new ErreurRendu(`Trop de fichiers dans cette page (${FICHIERS_MAX} au plus).`);
          const taille = statSync(path.join(chemin, sous)).size;
          total += taille;
          if (total > TAILLE_MAX) throw new ErreurRendu("Trop lourd pour un livrable (300 Mo au plus).");
          fichiers.push({ relatif: sous, taille });
        }
      }
    };
    parcourir("");
    return { fichiers, total };
  }

  /**
   * L'outil `publier_artefact` : vérifie, retient, prévient l'app. `appelant` vient des en-têtes de la
   * session (agent, conversation). Republier le même original le remplace (même identifiant).
   */
  function publier(appelant, args) {
    const chemin = cheminDuVps(args?.chemin);
    if (!existsSync(chemin)) throw new ErreurRendu(`Aucun fichier à ${chemin} sur ce VPS : vérifie le chemin complet.`);
    const dossier = statSync(chemin).isDirectory();
    if (dossier && !existsSync(path.join(chemin, "index.html"))) throw new ErreurRendu("Un dossier se publie s’il contient une page index.html ; sinon, publie ses fichiers un par un.");
    const { total } = contenu(chemin, dossier);
    if (total > TAILLE_MAX) throw new ErreurRendu("Trop lourd pour un livrable (300 Mo au plus).");
    const titre = (typeof args?.titre === "string" ? args.titre : "").trim().replace(/\s+/g, " ").slice(0, 80) || path.basename(chemin);
    const description = (typeof args?.description === "string" ? args.description : "").trim().slice(0, 500);
    const agent = /^[a-z0-9][a-z0-9-]{0,63}$/.test(appelant?.agent ?? "") ? appelant.agent : "principal";
    const conversation = typeof appelant?.conversation === "string" ? appelant.conversation.slice(0, 120) : "";
    const liste = lire();
    const avant = liste.find((r) => r.chemin === chemin);
    const rendu = { id: avant?.id ?? randomUUID(), chemin, dossier, taille: total, titre, description, agent, conversation, at: maintenant() };
    ecrire([rendu, ...liste.filter((r) => r.id !== rendu.id)]);
    options.publier(`rendu-${rendu.id}-${rendu.at}`, { type: "rendu", ...rendu }, null);
    return `Publié dans Artefacts : « ${titre} ». L’app en garde une copie sur l’ordinateur de la personne ; republier le même fichier remplace cette copie.`;
  }

  /** Une publication retenue (jamais un autre fichier). */
  function publication(id) {
    const rendu = lire().find((r) => r.id === id);
    if (!rendu || !existsSync(rendu.chemin)) throw new ErreurRendu("Ce livrable n’est plus sur le VPS.");
    return rendu;
  }

  /** La liste des fichiers d'une publication, pour que l'app la recopie. */
  function fichiers(id) {
    const rendu = publication(id);
    return contenu(rendu.chemin, rendu.dossier).fichiers;
  }

  /** Un fichier d'une publication : son chemin sur le VPS et sa taille (le serveur l'envoie tel quel). */
  function fichierDe(id, relatif) {
    const rendu = publication(id);
    if (!rendu.dossier) return { chemin: rendu.chemin, taille: statSync(rendu.chemin).size };
    const cible = path.resolve(rendu.chemin, String(relatif ?? ""));
    const rel = path.relative(rendu.chemin, cible);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel) || rel.split(path.sep).some((p) => IGNORES.has(p))) throw new ErreurRendu("Ce fichier ne fait pas partie du livrable.");
    if (!existsSync(cible) || !statSync(cible).isFile()) throw new ErreurRendu("Ce fichier n’est plus sur le VPS.");
    return { chemin: cible, taille: statSync(cible).size };
  }

  return { publier, fichiers, fichierDe, lire, flux: (chemin) => createReadStream(chemin) };
}
