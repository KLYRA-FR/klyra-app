import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { motifRefus } from "./carte.ts";

/**
 * Un dossier de travail par Issue, hors du dossier du projet : deux agents ne se gênent jamais, et ce
 * que la personne a en cours reste intact. L'identité et le jeton passent par l'environnement, jamais
 * par la ligne de commande ni par la configuration du dépôt.
 */

const IDENTITES = {
  agents: { nom: "klyra-agents[bot]", email: "352646707+klyra-agents[bot]@users.noreply.github.com" },
  reviewer: { nom: "klyra-reviewer[bot]", email: "352647021+klyra-reviewer[bot]@users.noreply.github.com" },
} as const;

/** `klyra-fr/nom` pour une adresse GitHub d'un dépôt de KLYRA-FR, sinon null. */
export function depotDuDistant(distant: string): string | null {
  const lu = /^(?:https:\/\/(?:[^@/]+@)?github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(distant.trim());
  if (lu === null || lu[1].toLowerCase() !== "klyra-fr") return null;
  return `klyra-fr/${lu[2].toLowerCase()}`;
}

/** L'environnement d'un agent du circuit : Git et `gh` utilisent le jeton d'App, pas le compte du poste. */
export function environnementGit(jeton: string, role: keyof typeof IDENTITES): Record<string, string> {
  const identite = IDENTITES[role];
  const basique = Buffer.from(`x-access-token:${jeton}`).toString("base64");
  return {
    GH_TOKEN: jeton,
    GITHUB_TOKEN: jeton,
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_COUNT: "3",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basique}`,
    GIT_CONFIG_KEY_1: "url.https://github.com/.insteadOf",
    GIT_CONFIG_VALUE_1: "git@github.com:",
    GIT_CONFIG_KEY_2: "credential.helper",
    GIT_CONFIG_VALUE_2: "",
    GIT_AUTHOR_NAME: identite.nom,
    GIT_AUTHOR_EMAIL: identite.email,
    GIT_COMMITTER_NAME: identite.nom,
    GIT_COMMITTER_EMAIL: identite.email,
  };
}

function git(cwd: string, args: string[], env: Record<string, string>): Promise<{ code: number; sortie: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, env: { ...process.env, ...env }, timeout: 300_000, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (erreur, stdout, stderr) => {
      const code = erreur ? (typeof erreur.code === "number" ? erreur.code : 1) : 0;
      resolve({ code, sortie: `${stdout}${stderr}`.trim() });
    });
  });
}

export function cheminWorktree(racine: string, depot: string, numero: number): string {
  return path.join(racine, depot.replace(/[^a-z0-9._-]+/gi, "-"), `issue-${numero}`);
}

export async function depotDuDossier(dossier: string): Promise<string | null> {
  const { code, sortie } = await git(dossier, ["remote", "get-url", "origin"], {});
  return code === 0 ? depotDuDistant(sortie) : null;
}

/** Prépare le dossier de l'Issue sur sa branche. S'il existe déjà, le travail déjà fait reste en place. */
export async function preparerWorktree(c: {
  dossierProjet: string;
  racine: string;
  depot: string;
  numero: number;
  branche: string;
  env: Record<string, string>;
}): Promise<{ ok: true; chemin: string } | { ok: false; sortie: string }> {
  const chemin = cheminWorktree(c.racine, c.depot, c.numero);
  const recu = await git(c.dossierProjet, ["fetch", "origin", `+refs/heads/${c.branche}:refs/remotes/origin/${c.branche}`], c.env);
  if (recu.code !== 0) return { ok: false, sortie: recu.sortie };
  if (existsSync(chemin)) return { ok: true, chemin };
  mkdirSync(path.dirname(chemin), { recursive: true });
  const ajout = await git(c.dossierProjet, ["worktree", "add", "-B", c.branche, chemin, `origin/${c.branche}`], c.env);
  return ajout.code === 0 ? { ok: true, chemin } : { ok: false, sortie: ajout.sortie };
}

/** Retire le dossier de l'Issue. Un dossier déjà absent n'est pas une erreur. */
export async function retirerWorktree(c: { dossierProjet: string; racine: string; depot: string; numero: number }): Promise<void> {
  const chemin = cheminWorktree(c.racine, c.depot, c.numero);
  if (existsSync(chemin)) await git(c.dossierProjet, ["worktree", "remove", "--force", chemin], {});
  await git(c.dossierProjet, ["worktree", "prune"], {});
}

/** Au-delà, c'est presque toujours un dossier oublié dans le `.gitignore`. */
export const FICHIERS_MAX = 1000;

export type Envoi =
  | { statut: "rien" }
  | { statut: "pousse"; sha: string; fichiers: string[] }
  | { statut: "refus"; motif: "secret" | "trop_de_fichiers" | "workflows" | "git"; detail: string };

/**
 * Le travail de l'agent part sur sa branche. L'agent n'a pas accès à GitHub : c'est ce code qui valide
 * et pousse, avec l'identité de l'App. Un secret dans le changement arrête tout, avant le commit.
 */
export async function validerEtPousser(c: { chemin: string; branche: string; message: string; env: Record<string, string>; jeton: string }): Promise<Envoi> {
  const propre = (texte: string) => texte.split(c.jeton).join("***").slice(0, 2000);
  const refus = (motif: "git" | "workflows", sortie: string): Envoi => ({ statut: "refus", motif, detail: propre(sortie) });

  const ajout = await git(c.chemin, ["add", "-A"], c.env);
  if (ajout.code !== 0) return refus("git", ajout.sortie);
  const noms = await git(c.chemin, ["diff", "--cached", "--name-only"], c.env);
  if (noms.code !== 0) return refus("git", noms.sortie);
  const fichiers = noms.sortie.split("\n").map((l) => l.trim()).filter(Boolean);

  if (fichiers.length > FICHIERS_MAX) {
    await git(c.chemin, ["reset"], c.env);
    return { statut: "refus", motif: "trop_de_fichiers", detail: `${fichiers.length} fichiers` };
  }

  if (fichiers.length > 0) {
    const difference = await git(c.chemin, ["diff", "--cached", "--no-color", "-U0"], c.env);
    const ajoutes = difference.sortie.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).join("\n");
    if (motifRefus(ajoutes) === "secret") {
      await git(c.chemin, ["reset"], c.env);
      return { statut: "refus", motif: "secret", detail: "Le changement contient ce qui ressemble à un secret." };
    }
    const commit = await git(c.chemin, ["commit", "--no-verify", "-m", c.message], c.env);
    if (commit.code !== 0) return refus("git", commit.sortie);
  } else {
    const enAvance = await git(c.chemin, ["rev-list", "--count", `origin/${c.branche}..HEAD`], c.env);
    if (enAvance.code === 0 && enAvance.sortie === "0") return { statut: "rien" };
  }

  const envoi = await git(c.chemin, ["push", "origin", `HEAD:refs/heads/${c.branche}`], c.env);
  if (envoi.code !== 0) return /workflow/i.test(envoi.sortie) ? refus("workflows", envoi.sortie) : refus("git", envoi.sortie);
  const sha = await git(c.chemin, ["rev-parse", "HEAD"], c.env);
  const tous = fichiers.length ? fichiers : (await git(c.chemin, ["diff", "--name-only", `origin/${c.branche}~1..HEAD`], c.env)).sortie.split("\n").filter(Boolean);
  return { statut: "pousse", sha: sha.sortie, fichiers: tous };
}
