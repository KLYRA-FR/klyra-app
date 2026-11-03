import { app } from "electron";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { ecartModelUsage, type CumulUsage } from "./consommation-ecart";
import { lireHistorique, rattraperHistorique } from "./historique";

/**
 * La consommation de l'app, réponse par réponse : les jetons et le coût que
 * renvoient Claude Code (par modèle) et les autres IA. Un fichier JSONL dans
 * le dossier de l'app, une ligne par appel, jamais de contenu de message.
 * Le Profil en tire ses chiffres (jetons sur un an, modèles, coéquipiers…).
 */

export interface Jetons {
  entree: number;
  sortie: number;
  /** Lus dans le cache de prompt (Claude). */
  cacheLu: number;
  /** Écrits dans le cache de prompt (Claude). */
  cacheEcrit: number;
}

export interface EntreeConsommation {
  /** Horodatage en ms. */
  at: number;
  /** « Claude Code », « ChatGPT », « Gemini »… */
  fournisseur: string;
  modele: string;
  /** L'agent qui a répondu (id de sa fiche), « principal » sinon. */
  agent: string;
  jetons: Jetons;
  /** En dollars US, quand le fournisseur le donne (Claude Code). */
  coutUsd: number | null;
  /** Passé par l'app (journal, sessions de l'app) ; faux pour le terminal ou l'IDE (historique.ts). */
  klyra?: boolean;
}

const fichier = () => path.join(app.getPath("userData"), "consommation.jsonl");
const UN_AN_MS = 366 * 24 * 60 * 60 * 1000;

const total = (j: Jetons) => j.entree + j.sortie + j.cacheLu + j.cacheEcrit;
const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/* Les écritures se suivent : deux réponses qui finissent ensemble ne se mélangent pas. */
let file: Promise<void> = Promise.resolve();

export function enregistrerConsommation(entree: Omit<EntreeConsommation, "at">) {
  if (!total(entree.jetons) && !entree.coutUsd) return;
  const ligne = `${JSON.stringify({ at: Date.now(), ...entree })}\n`;
  file = file
    .then(async () => {
      await mkdir(path.dirname(fichier()), { recursive: true });
      await appendFile(fichier(), ligne, "utf8");
    })
    .catch(() => {
      /* disque plein, droits… on perd cette ligne, pas la réponse */
    });
}

/** Les appels du journal sur l'année écoulée, et la date du premier jamais enregistré. */
export async function lireJournal(): Promise<{ entrees: EntreeConsommation[]; depuis: number | null }> {
  let brut = "";
  try {
    brut = await readFile(fichier(), "utf8");
  } catch {
    return { entrees: [], depuis: null };
  }
  const limite = Date.now() - UN_AN_MS;
  const entrees: EntreeConsommation[] = [];
  let depuis: number | null = null;
  // \r?\n : un fichier passé par Windows (ou un éditeur) peut avoir des fins de ligne CRLF.
  for (const l of brut.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const e = JSON.parse(l) as EntreeConsommation;
      if (typeof e.at !== "number") continue;
      depuis ??= e.at;
      if (e.at >= limite) entrees.push(e);
    } catch {
      /* ligne abîmée : ignorée */
    }
  }
  return { entrees, depuis };
}

/**
 * Ce que lit le Profil : le journal, plus l'historique rattrapé des
 * transcriptions de Claude Code d'avant le journal (historique.ts), qu'on
 * met à jour au passage.
 */
export async function lireConsommation() {
  const journal = await lireJournal();
  const historique = await rattraperHistorique(journal.depuis ?? Date.now()).catch(() => null);
  const limite = Date.now() - UN_AN_MS;
  const anciennes = historique ? (await lireHistorique()).filter((e) => e.at >= limite) : [];
  // Tout le journal passe par l'app.
  return { entrees: [...anciennes, ...journal.entrees.map((e) => ({ ...e, klyra: true }))], depuis: journal.depuis, historique };
}

/* ─── Claude Code ─────────────────────────────────────────────── */

type Cumul = CumulUsage;

/**
 * Enregistre ce qu'un tour a consommé : l'écart de son `modelUsage` avec le cumul précédent
 * (cf. consommation-ecart.ts, le même calcul que sur un VPS). Rend le nouveau cumul.
 */
export function enregistrerTourClaude(usage: unknown, precedent: Cumul, agent: string | null): Cumul {
  const { cumul, lignes } = ecartModelUsage(usage, precedent);
  for (const l of lignes) enregistrerConsommation({ fournisseur: "Claude Code", modele: l.modele, agent: agent ?? "principal", jetons: l.jetons, coutUsd: l.coutUsd });
  return cumul;
}

/* ─── Autres IA (API compatibles OpenAI) ──────────────────────── */

export function enregistrerAppelIa(fournisseur: string, modele: string, agent: string | null, usage: unknown) {
  const u = (usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number };
  enregistrerConsommation({
    fournisseur,
    modele,
    agent: agent ?? "principal",
    jetons: { entree: nombre(u.prompt_tokens), sortie: nombre(u.completion_tokens), cacheLu: 0, cacheEcrit: 0 },
    coutUsd: null,
  });
}
