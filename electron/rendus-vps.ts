import { net } from "electron";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { dansLesRendus, nomLibre, RACINE_RENDUS, type CopieRendu } from "./rendus";

/**
 * Les livrables des agents d'un VPS relié (serveur/rendus.mjs) : le VPS les annonce par le journal des
 * événements, l'app en garde la copie sur ce PC, dans l'espace de l'agent (`~/.klyra/rendus/<agent>/`),
 * comme un livrable local (electron/rendus.ts) : même nommage, même limite, même remplacement.
 * Le VPS ne sert que les fichiers d'une publication retenue.
 */

const ATTENTE_MS = 120_000;
const TAILLE_MAX = 300 * 1024 * 1024;
const NOM_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ID = /^[0-9a-f-]{36}$/;

async function lire(origine: string, jeton: string, chemin: string): Promise<Response> {
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}${chemin}`, { headers: { Authorization: `Bearer ${jeton}` }, signal: controle.signal, redirect: "error", cache: "no-store" });
    if (reponse.status === 401) throw new Error("Ce PC n’est plus relié à ce VPS.");
    if (reponse.status === 404) throw new Error("Ce VPS ne sait pas encore envoyer les livrables : relance la commande d’installation sur le VPS.");
    if (!reponse.ok) {
      const json = (await reponse.json().catch(() => null)) as { message?: unknown } | null;
      throw new Error(typeof json?.message === "string" ? json.message : "Le VPS n’a pas envoyé le livrable.");
    }
    return reponse;
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") throw new Error("Le VPS ne répond pas.");
    throw e;
  } finally {
    clearTimeout(delai);
  }
}

/** Un chemin relatif sûr (pas de `..`, pas absolu), en séparateurs de ce système. */
function relatifSur(relatif: unknown): string {
  if (typeof relatif !== "string" || !relatif || relatif.includes("\0")) throw new Error("Le VPS a envoyé un nom de fichier invalide.");
  const morceaux = relatif.split("/");
  if (morceaux.some((m) => !m || m === "." || m === "..") || path.isAbsolute(relatif)) throw new Error("Le VPS a envoyé un nom de fichier invalide.");
  return path.join(...morceaux);
}

/**
 * Recopie un livrable du VPS dans l'espace de l'agent. `nom` : celui de l'original (fichier ou dossier de
 * la page) ; `remplace` : la copie d'une publication précédente du même original, remplacée.
 */
export async function copierRenduVps(origine: string, jeton: string | null, id: unknown, agent: unknown, nom: unknown, dossier: boolean, remplace: unknown): Promise<CopieRendu> {
  if (!jeton) throw new Error("Ce PC n’est plus relié à ce VPS.");
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Livrable invalide.");
  if (typeof agent !== "string" || !NOM_AGENT.test(agent)) throw new Error("Agent invalide.");
  const base = typeof nom === "string" ? path.basename(nom.replace(/[\\/]+$/, "")) : "";
  if (!base || base === "." || base === "..") throw new Error("Livrable invalide.");

  const liste = ((await (await lire(origine, jeton, `/klyra/v1/rendus/${id}/fichiers`)).json()) as { fichiers?: { relatif?: unknown; taille?: unknown }[] }).fichiers;
  if (!Array.isArray(liste) || !liste.length) throw new Error("Le VPS n’a envoyé aucun fichier pour ce livrable.");
  const total = liste.reduce((n, f) => n + (typeof f.taille === "number" ? f.taille : 0), 0);
  if (total > TAILLE_MAX) throw new Error("Trop lourd pour un livrable (300 Mo au plus).");

  const espace = path.join(RACINE_RENDUS, agent);
  mkdirSync(espace, { recursive: true });
  const jour = new Date().toISOString().slice(0, 10);
  const vers = nomLibre(espace, `${jour} ${base}`);
  try {
    if (!dossier) {
      const octets = Buffer.from(await (await lire(origine, jeton, `/klyra/v1/rendus/${id}/fichier`)).arrayBuffer());
      writeFileSync(vers, octets);
    } else {
      for (const f of liste) {
        const relatif = relatifSur(f.relatif);
        const cible = path.join(vers, relatif);
        if (path.relative(vers, cible).startsWith("..")) throw new Error("Le VPS a envoyé un nom de fichier invalide.");
        mkdirSync(path.dirname(cible), { recursive: true });
        const octets = Buffer.from(await (await lire(origine, jeton, `/klyra/v1/rendus/${id}/fichier?relatif=${encodeURIComponent(String(f.relatif))}`)).arrayBuffer());
        writeFileSync(cible, octets);
      }
    }
  } catch (e) {
    // Une copie à moitié faite ne reste pas dans les livrables.
    rmSync(vers, { recursive: true, force: true });
    throw e;
  }
  // La copie précédente du même original : remplacée, seulement si elle est dans l'espace des rendus.
  if (typeof remplace === "string" && remplace && dansLesRendus(path.resolve(remplace))) rmSync(path.resolve(remplace), { recursive: true, force: true });
  return { chemin: vers, taille: total, dossier };
}
