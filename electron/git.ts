import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Publier un projet depuis l'app : voir ce qui a changé, puis commit + push
 * de la branche en cours. Rien ne part sans que la personne l'ait demandé.
 */

export interface FichierGit {
  /** « M » modifié, « A » ajouté, « D » supprimé, « ? » nouveau, « R » renommé. */
  statut: string;
  chemin: string;
}

export interface EtatGit {
  /** Le dossier est-il un dépôt git ? */
  depot: boolean;
  branche: string | null;
  /** La branche a-t-elle un équivalent sur le serveur (origin) ? */
  suivie: boolean;
  /** Commits locaux pas encore poussés. */
  enAvance: number;
  fichiers: FichierGit[];
  distant: string | null;
}

export interface ResultatPublication {
  ok: boolean;
  commit: string | null;
  branche: string | null;
  sortie: string;
}

function absolu(dossier: string): string {
  const d = dossier.startsWith("~") ? path.join(os.homedir(), dossier.slice(1)) : dossier;
  if (!path.isAbsolute(d) || !existsSync(d)) throw new Error(`Dossier introuvable : ${dossier}`);
  return d;
}

function git(cwd: string, args: string[], delai = 120_000): Promise<{ code: number; sortie: string }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: delai, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (erreur, stdout, stderr) => {
      const code = erreur ? (typeof erreur.code === "number" ? erreur.code : 1) : 0;
      resolve({ code, sortie: `${stdout}${stderr}`.trim() });
    });
  });
}

export async function etatGit(dossier: string): Promise<EtatGit> {
  const cwd = absolu(dossier);
  const statut = await git(cwd, ["status", "--porcelain=v1", "-b", "--untracked-files=all"]);
  if (statut.code !== 0) return { depot: false, branche: null, suivie: false, enAvance: 0, fichiers: [], distant: null };

  const [tete, ...lignes] = statut.sortie.split("\n");
  // « ## main...origin/main [ahead 2] » ou « ## pelin » (pas de branche distante).
  const m = tete.match(/^## (?:No commits yet on )?([^.\s]+)(?:\.\.\.(\S+))?(?: \[ahead (\d+))?/);
  const fichiers = lignes
    .filter(Boolean)
    .map((l) => {
      const code = l.slice(0, 2).trim() || "M";
      return { statut: code === "??" ? "?" : code.charAt(0), chemin: l.slice(3).replace(/^"|"$/g, "") };
    });
  const distant = await git(cwd, ["remote", "get-url", "origin"]);
  return {
    depot: true,
    branche: m?.[1] ?? null,
    suivie: !!m?.[2],
    enAvance: m?.[3] ? Number(m[3]) : 0,
    fichiers,
    distant: distant.code === 0 ? distant.sortie : null,
  };
}

/** Commit de tout ce qui a changé, puis push de la branche en cours. */
export async function publier(dossier: string, message: string): Promise<ResultatPublication> {
  const cwd = absolu(dossier);
  const texte = message.trim();
  if (!texte) return { ok: false, commit: null, branche: null, sortie: "Le message du commit est vide." };

  const etat = await etatGit(dossier);
  if (!etat.depot || !etat.branche) return { ok: false, commit: null, branche: null, sortie: "Ce dossier n’est pas un dépôt git." };

  const sorties: string[] = [];
  if (etat.fichiers.length) {
    const ajout = await git(cwd, ["add", "-A"]);
    sorties.push(ajout.sortie);
    if (ajout.code !== 0) return { ok: false, commit: null, branche: etat.branche, sortie: sorties.join("\n") };
    const commit = await git(cwd, ["commit", "-m", texte]);
    sorties.push(commit.sortie);
    if (commit.code !== 0) return { ok: false, commit: null, branche: etat.branche, sortie: sorties.join("\n") };
  }
  if (!etat.distant) {
    return { ok: false, commit: null, branche: etat.branche, sortie: [...sorties, "Pas de dépôt distant (origin) : le commit est fait, rien n’a été poussé."].join("\n") };
  }
  const push = await git(cwd, etat.suivie ? ["push"] : ["push", "-u", "origin", etat.branche]);
  sorties.push(push.sortie);
  const hash = await git(cwd, ["rev-parse", "--short", "HEAD"]);
  return { ok: push.code === 0, commit: hash.code === 0 ? hash.sortie : null, branche: etat.branche, sortie: sorties.filter(Boolean).join("\n") };
}
