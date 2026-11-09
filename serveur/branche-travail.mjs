// Généré par scripts/serveur-genere.mjs depuis electron/branche-travail.ts : ne pas modifier à la main.
/**
 * Une branche de travail : un autre dossier du même dépôt (`git worktree`), sur une branche neuve, pour qu'un
 * agent y travaille à côté des autres sans se gêner. L'app en fait un projet à part (une branche = un projet,
 * jamais de changement de branche dans un dossier). Le dossier est dans le dépôt principal, sous
 * `.claude/worktrees/<nom>` (comme Claude Code), caché à Git par `info/exclude`. Aucun crochet du dépôt ne tourne
 * (`core.hooksPath` vide), pas de fsmonitor. Retirer une branche de travail ne supprime que son dossier, s'il n'a
 * rien de non publié ; la branche reste dans le dépôt.
 * Pur et sans Electron : le même module sert à l'app et au serveur d'un VPS (généré en `serveur/branche-travail.mjs`).
 */
import { execFile } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
const SUR = ["-c", `core.hooksPath=${os.devNull}`, "-c", "core.fsmonitor=false"];
function git(cwd, args) {
    return new Promise((resolve) => {
        execFile("git", [...SUR, ...args], { cwd, timeout: 120_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" } }, (erreur, stdout, stderr) => resolve({ code: erreur ? (typeof erreur.code === "number" ? erreur.code : 1) : 0, sortie: `${stdout}${stderr}`.trim() }));
    });
}
/** Le nom court d'une branche de travail (« correctif menu » → « correctif-menu »), ou null. */
export function nomBrancheTravail(saisie) {
    const slug = saisie
        .normalize("NFD")
        .replace(/\p{M}/gu, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40)
        .replace(/-+$/, "");
    return /^[a-z0-9][a-z0-9-]{0,39}$/.test(slug) ? slug : null;
}
/** Le dépôt d'un dossier : la racine de sa copie de travail, et celle du dépôt principal (où vivent les branches de travail). */
async function depotDe(dossier) {
    const reel = realpathSync(dossier);
    const racine = await git(reel, ["rev-parse", "--show-toplevel"]);
    if (racine.code !== 0)
        throw new Error("Ce projet n’est pas dans un dépôt Git.");
    const commun = await git(reel, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    if (commun.code !== 0)
        throw new Error("Le dépôt Git de ce projet est illisible.");
    const racineReelle = realpathSync(racine.sortie.split("\n")[0]);
    const communReel = realpathSync(commun.sortie.split("\n")[0]);
    const principal = path.basename(communReel) === ".git" ? path.dirname(communReel) : racineReelle;
    return { racine: racineReelle, principal, commun: communReel, prefixe: path.relative(racineReelle, reel) };
}
/** Crée une branche de travail depuis l'état actuel du projet (son HEAD) ; rend son dossier et sa branche. */
export async function creerBrancheTravail(dossier, saisie) {
    const nom = nomBrancheTravail(saisie);
    if (!nom)
        throw new Error("Donne un nom avec des lettres ou des chiffres.");
    const { principal, commun, prefixe } = await depotDe(dossier);
    const branche = `klyra/${nom}`;
    const cible = path.join(principal, ".claude", "worktrees", nom);
    if (existsSync(cible))
        throw new Error(`Une branche de travail « ${nom} » existe déjà.`);
    const existe = await git(principal, ["rev-parse", "--verify", "--quiet", `refs/heads/${branche}`]);
    if (existe.code === 0)
        throw new Error(`La branche ${branche} existe déjà dans ce dépôt.`);
    mkdirSync(path.dirname(cible), { recursive: true });
    const ajout = await git(principal, ["worktree", "add", "-b", branche, cible, "HEAD"]);
    if (ajout.code !== 0)
        throw new Error(ajout.sortie.split("\n").slice(-2).join(" ").slice(0, 300) || "Git n’a pas pu créer la branche de travail.");
    /* Le dossier des branches de travail ne doit pas apparaître dans les changements du dépôt principal. */
    try {
        const exclude = path.join(commun, "info", "exclude");
        const actuel = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
        if (!actuel.split(/\r?\n/).includes("/.claude/worktrees/")) {
            mkdirSync(path.dirname(exclude), { recursive: true });
            appendFileSync(exclude, `${actuel && !actuel.endsWith("\n") ? "\n" : ""}/.claude/worktrees/\n`);
        }
    }
    catch {
        /* tant pis : le dossier apparaîtra comme nouveau dans le dépôt principal */
    }
    return { dossier: prefixe ? path.join(cible, prefixe) : cible, branche };
}
/**
 * Retire le dossier d'une branche de travail créée par l'app (sous `.claude/worktrees/` du dépôt principal), s'il
 * n'a rien de modifié ni de nouveau ; la branche et ses commits restent dans le dépôt.
 */
export async function retirerBrancheTravail(dossier) {
    const { racine, principal } = await depotDe(dossier);
    const parent = path.join(principal, ".claude", "worktrees");
    if (path.dirname(racine) !== parent)
        throw new Error("Ce projet n’est pas une branche de travail de l’app.");
    const retrait = await git(principal, ["worktree", "remove", racine]);
    if (retrait.code !== 0) {
        if (/modified|untracked|changes/i.test(retrait.sortie))
            throw new Error("Cette branche de travail a des changements pas encore publiés : publie-les, ou garde-la.");
        throw new Error(retrait.sortie.split("\n").slice(-1)[0]?.slice(0, 300) || "Git n’a pas pu retirer la branche de travail.");
    }
}
