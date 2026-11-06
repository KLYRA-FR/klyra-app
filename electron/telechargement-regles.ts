/**
 * Règles pures du téléchargement d'un livrable dans le dossier Téléchargements de ce PC
 * (cf. `electron/telechargement.ts`). Sans module de Node : testées par vitest (`src/lib/telechargement.test.ts`).
 */

/** Interdits par Windows dans un nom de fichier, et les caractères de contrôle. */
const INTERDITS = /[<>:"|?*\u0000-\u001f\u007f]/g;
/** Noms réservés par Windows, avec ou sans extension. */
const RESERVES = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const LONGUEUR_MAX = 200;

/**
 * Le nom sous lequel le fichier arrive dans Téléchargements : le dernier segment seulement, jamais un chemin.
 * Refuse un nom vide, `.`, `..` ou qui contient un séparateur ; remplace ce que Windows refuse.
 */
export function nomTelechargeable(nom: unknown): string {
  if (typeof nom !== "string") throw new Error("Nom de fichier invalide.");
  if (nom.includes("/") || nom.includes("\\") || nom.includes("\0")) throw new Error("Nom de fichier invalide.");
  const net = nom.replace(INTERDITS, "_").replace(/[. ]+$/, "").trim();
  if (!net || net === "." || net === "..") throw new Error("Nom de fichier invalide.");
  const sur = RESERVES.test(net) ? `_${net}` : net;
  if (sur.length <= LONGUEUR_MAX) return sur;
  const ext = extension(sur);
  return sur.slice(0, LONGUEUR_MAX - ext.length) + ext;
}

/** L'extension gardée à part du suffixe : « .mov » de « film.mov », rien pour « .env » ou « LISEZMOI ». */
function extension(nom: string): string {
  const i = nom.lastIndexOf(".");
  return i > 0 ? nom.slice(i) : "";
}

/**
 * Un nom libre : « film.mov », sinon « film (1).mov », « film (2).mov »…, comme un navigateur.
 * `existe` dit si un nom est déjà pris dans le dossier. Jamais d'écrasement.
 */
export function nomUnique(nom: string, existe: (nom: string) => boolean): string {
  if (!existe(nom)) return nom;
  const ext = extension(nom);
  const base = nom.slice(0, nom.length - ext.length);
  for (let i = 1; i < 10_000; i++) {
    const essai = `${base} (${i})${ext}`;
    if (!existe(essai)) return essai;
  }
  throw new Error("Trop de fichiers du même nom dans Téléchargements.");
}

/**
 * Un chemin relatif sûr, servi par le VPS pour un fichier du dossier d'une page : des segments simples
 * séparés par `/`, jamais absolu, jamais `..`. Rend la liste des segments.
 */
export function segmentsSurs(relatif: unknown): string[] {
  if (typeof relatif !== "string" || !relatif || relatif.includes("\0") || relatif.includes("\\")) throw new Error("Le VPS a envoyé un nom de fichier invalide.");
  if (relatif.startsWith("/") || /^[a-z]:/i.test(relatif)) throw new Error("Le VPS a envoyé un nom de fichier invalide.");
  const morceaux = relatif.split("/");
  if (morceaux.some((m) => !m || m === "." || m === "..")) throw new Error("Le VPS a envoyé un nom de fichier invalide.");
  return morceaux;
}

/** Identifiant d'une publication du VPS (cf. `serveur/rendus.mjs`). */
export const ID_RENDU_VPS = /^[0-9a-f-]{36}$/;

/** La progression envoyée à l'écran, au plus une fois par intervalle (et toujours la dernière). */
export function suiviProgression(envoyer: (recu: number) => void, intervalleMs = 200, maintenant: () => number = Date.now) {
  let dernier = -Infinity;
  let recu = 0;
  return {
    ajouter(octets: number) {
      recu += octets;
      const t = maintenant();
      if (t - dernier < intervalleMs) return;
      dernier = t;
      envoyer(recu);
    },
    finir() {
      envoyer(recu);
    },
    get recu() {
      return recu;
    },
  };
}
