import os from "node:os";
import path from "node:path";
import { creerClientGithub } from "./github.ts";
import { nouvelleMemoire, terminer, tour, type BilanTour, type ContexteProjet, type FinEtape, type Memoire } from "./runner.ts";
import { compteGithubValable } from "./reglages.ts";
import { cheminWorktree, depotDuDossier } from "./worktree.ts";

/** Ce que l'écran demande au process principal. L'écran a la session du compte, donc le jeton ; il ne garde que lui. */

const RACINE = () => path.join(os.homedir(), ".klyra", "worktrees");
const memoires = new Map<string, Memoire>();

function memoireDe(depot: string): Memoire {
  const lue = memoires.get(depot) ?? nouvelleMemoire();
  memoires.set(depot, lue);
  return lue;
}

function texte(v: unknown, nom: string): string {
  if (typeof v !== "string" || v.length === 0 || v.length > 4096) throw new Error(`Valeur invalide : ${nom}.`);
  return v;
}

function numero(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v <= 0) throw new Error("Numéro d'Issue invalide.");
  return v;
}

async function contexte(b: Record<string, unknown>): Promise<ContexteProjet> {
  const dossier = texte(b.dossier, "dossier");
  const depot = texte(b.depot, "dépôt");
  const moi = texte(b.moi, "compte GitHub");
  if (!compteGithubValable(moi)) throw new Error("Compte GitHub invalide.");
  /* Le dossier dit lui-même son dépôt : un jeton ne sert jamais pour un autre. */
  if ((await depotDuDossier(dossier)) !== depot) throw new Error("Ce dossier n'est pas relié à ce dépôt.");
  return { depot, dossierProjet: dossier, racine: RACINE(), moi, poste: texte(b.poste, "poste"), jeton: texte(b.jeton, "jeton"), maintenant: Date.now() };
}

export async function depotDuProjet(dossier: unknown): Promise<string | null> {
  return typeof dossier === "string" && dossier ? await depotDuDossier(dossier) : null;
}

export async function tourCollaboration(brut: unknown): Promise<BilanTour> {
  const b = (brut ?? {}) as Record<string, unknown>;
  const ctx = await contexte(b);
  const enCours = Array.isArray(b.enCours) ? b.enCours.filter((n): n is number => typeof n === "number") : [];
  const places = typeof b.places === "number" && b.places > 0 ? Math.floor(b.places) : 0;
  return await tour(creerClientGithub(ctx.depot, ctx.jeton), ctx, { enCours, places, memoire: memoireDe(ctx.depot) });
}

export async function terminerCollaboration(brut: unknown): Promise<FinEtape> {
  const b = (brut ?? {}) as Record<string, unknown>;
  const ctx = await contexte(b);
  const n = numero(b.numero);
  return await terminer(creerClientGithub(ctx.depot, ctx.jeton), ctx, {
    numero: n,
    ok: b.ok === true,
    texte: typeof b.texte === "string" ? b.texte : "",
    erreur: typeof b.erreur === "string" ? b.erreur : undefined,
    chemin: cheminWorktree(ctx.racine, ctx.depot, n),
    agent: texte(b.agent, "agent"),
  });
}
