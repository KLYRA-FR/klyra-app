import { net, shell } from "electron";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { PAGE_ISOLEE } from "./document-isole";
import { ouvrirChemin } from "./fenetre-document";
import { dansLesRendus, nomLibre, RACINE_RENDUS, type CopieRendu } from "./rendus";

/**
 * Les livrables des agents d'un VPS relié (serveur/rendus.mjs). Le VPS les annonce par le journal.
 * Ils restent sur le serveur : l'écran ne les copie plus dans `~/.klyra/rendus`.
 * `htmlRenduVps` lit la page en mémoire. `ouvrirRenduVps` écrit un fichier temporaire, hors des rendus,
 * le temps de l'ouvrir. `copierRenduVps` reste pour l'ancien canal et n'est plus appelé à la publication.
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

function exigerJeton(jeton: string | null): string {
  if (!jeton) throw new Error("Ce PC n’est plus relié à ce VPS.");
  return jeton;
}

function demande(id: unknown, agent: unknown, nom: unknown): { id: string; agent: string; base: string } {
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Livrable invalide.");
  if (typeof agent !== "string" || !NOM_AGENT.test(agent)) throw new Error("Agent invalide.");
  const base = typeof nom === "string" ? path.basename(nom.replace(/[\\/]+$/, "")) : "";
  if (!base || base === "." || base === "..") throw new Error("Livrable invalide.");
  return { id, agent, base };
}

type FichierAnnonce = { relatif?: unknown; taille?: unknown };

async function fichiersDe(origine: string, jeton: string, id: string): Promise<FichierAnnonce[]> {
  const liste = ((await (await lire(origine, jeton, `/klyra/v1/rendus/${id}/fichiers`)).json()) as { fichiers?: FichierAnnonce[] }).fichiers;
  if (!Array.isArray(liste) || !liste.length) throw new Error("Le VPS n’a envoyé aucun fichier pour ce livrable.");
  const total = liste.reduce((n, f) => n + (typeof f.taille === "number" ? f.taille : 0), 0);
  if (total > TAILLE_MAX) throw new Error("Trop lourd pour un livrable (300 Mo au plus).");
  return liste;
}

/** Écrit le livrable sous `racine/<agent>/`. N'efface rien d'autre. */
async function deposer(racine: string, origine: string, jeton: string, id: string, agent: string, base: string, dossier: boolean): Promise<CopieRendu> {
  const liste = await fichiersDe(origine, jeton, id);
  const total = liste.reduce((n, f) => n + (typeof f.taille === "number" ? f.taille : 0), 0);
  const espace = path.join(racine, agent);
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
    rmSync(vers, { recursive: true, force: true });
    throw e;
  }
  return { chemin: vers, taille: total, dossier };
}

/**
 * Ancien canal : recopie dans `~/.klyra/rendus`. L'écran ne l'appelle plus à la publication.
 * `remplace` : une copie précédente, retirée seulement si elle est dans l'espace des rendus.
 */
export async function copierRenduVps(origine: string, jeton: string | null, id: unknown, agent: unknown, nom: unknown, dossier: boolean, remplace: unknown): Promise<CopieRendu> {
  const jetonOk = exigerJeton(jeton);
  const d = demande(id, agent, nom);
  const copie = await deposer(RACINE_RENDUS, origine, jetonOk, d.id, d.agent, d.base, dossier);
  if (typeof remplace === "string" && remplace && dansLesRendus(path.resolve(remplace))) rmSync(path.resolve(remplace), { recursive: true, force: true });
  return copie;
}

/** Le HTML du livrable, en base64. Rien n'est écrit sur ce PC. */
export async function htmlRenduVps(origine: string, jeton: string | null, id: unknown, dossier: boolean): Promise<string> {
  const jetonOk = exigerJeton(jeton);
  if (typeof id !== "string" || !ID.test(id)) throw new Error("Livrable invalide.");
  const liste = await fichiersDe(origine, jetonOk, id);
  const relatif = dossier ? liste.find((f) => typeof f.relatif === "string" && /(^|\/)index\.html?$/i.test(f.relatif))?.relatif : liste[0]?.relatif;
  if (typeof relatif !== "string" || !/\.html?$/i.test(relatif)) throw new Error("Seule une page HTML se partage avec l’équipe.");
  const chemin = dossier ? `/klyra/v1/rendus/${id}/fichier?relatif=${encodeURIComponent(relatif)}` : `/klyra/v1/rendus/${id}/fichier`;
  const octets = Buffer.from(await (await lire(origine, jetonOk, chemin)).arrayBuffer());
  return octets.toString("base64");
}

/** Ouvre le livrable servi par le VPS. Le fichier va dans un dossier temporaire, pas dans les rendus. */
export async function ouvrirRenduVps(origine: string, jeton: string | null, id: unknown, agent: unknown, nom: unknown, dossier: boolean): Promise<void> {
  const jetonOk = exigerJeton(jeton);
  const d = demande(id, agent, nom);
  const copie = await deposer(path.join(os.tmpdir(), "klyra-rendus-ouverts"), origine, jetonOk, d.id, d.agent, d.base, dossier);
  const cible = dossier ? path.join(copie.chemin, "index.html") : copie.chemin;
  if (!existsSync(cible)) throw new Error("Ce livrable n’a pas de page à ouvrir.");
  if (PAGE_ISOLEE.test(cible)) {
    await ouvrirChemin(dossier ? copie.chemin : cible);
    return;
  }
  const erreur = await shell.openPath(cible);
  if (erreur) throw new Error(erreur);
}
