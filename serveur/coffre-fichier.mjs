// Généré par scripts/serveur-genere.mjs depuis electron/coffre-fichier.ts : ne pas modifier à la main.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, lstat, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { ecrireDansEnv, marqueModele, normaliserVariable, remplacerModele } from "./coffre-regles.mjs";
/**
 * Écrire un secret du coffre dans un fichier, pour un agent qui ne voit jamais la valeur. Sans Electron :
 * le même code sur ce PC (`coffre.ts`) et sur un VPS (`serveur/coffre.mjs`, généré en
 * `serveur/coffre-fichier.mjs`). En deux temps : `verifierCible` contrôle le fichier avant que la valeur
 * soit lue (sur un VPS, avant qu'elle parte du PC), `ecrireCible` l'écrit ensuite.
 *
 * Refusé : un chemin relatif, hors de `racine` (sur un VPS, le dossier de l'utilisateur klyra), dans un
 * dossier interdit (les données de l'app), un lien symbolique, un fichier de plus de 1 Mo, un fichier
 * suivi par Git ou qu'il suivrait. Le fichier écrit est en 600.
 * - `env` : ajoute ou remplace la ligne VARIABLE=valeur ;
 * - `modele` : remplace chaque {{coffre:VARIABLE}} du fichier (il doit en avoir une) ;
 * - `brut` : un fichier qui ne contient que la valeur (absent ou vide avant).
 */
const executer = promisify(execFile);
const sous = (chemin, dossier) => {
    const d = path.resolve(dossier);
    return chemin === d || chemin.startsWith(d + path.sep);
};
/**
 * Le fichier est-il suivi par Git (ou le serait-il au prochain `git add`) ? Hors d'un dépôt (ou sans
 * git) : non, il n'y a rien à protéger d'un commit. Dans un dépôt, `git check-ignore` doit répondre 0
 * (ignoré) et le fichier ne pas être déjà suivi.
 */
export async function exposeAGit(chemin) {
    const dossier = path.dirname(chemin);
    try {
        await executer("git", ["-C", dossier, "rev-parse", "--is-inside-work-tree"], { timeout: 5_000 });
    }
    catch {
        return false;
    }
    try {
        await executer("git", ["-C", dossier, "check-ignore", "-q", "--no-index", "--", chemin], { timeout: 5_000 });
    }
    catch {
        // 1 : pas ignoré ; une autre erreur dans un dépôt : dans le doute, le secret n'y va pas.
        return true;
    }
    // Ignoré par le .gitignore, mais peut-être déjà suivi (ajouté avant la règle).
    try {
        const { stdout } = await executer("git", ["-C", dossier, "ls-files", "--", chemin], { timeout: 5_000 });
        return stdout.trim().length > 0;
    }
    catch {
        return false;
    }
}
/** Contrôle le fichier où un secret doit aller, sans lire le secret. Lève avec ce que l'agent doit faire. */
export async function verifierCible(entree, gardes) {
    const variable = normaliserVariable(entree.variable);
    const format = entree.format === "modele" || entree.format === "brut" ? entree.format : "env";
    const brut = typeof entree.chemin === "string" ? entree.chemin.trim() : "";
    if (!brut || !path.isAbsolute(brut))
        throw new Error("Donne le chemin complet du fichier.");
    const chemin = path.resolve(brut);
    if (gardes.racine && !sous(chemin, gardes.racine))
        throw new Error(`Le fichier doit être sous ${path.resolve(gardes.racine)}.`);
    if (gardes.interdits.some((d) => sous(chemin, d)))
        throw new Error("Ce dossier est celui des données de l’app : un secret n’y est pas écrit.");
    try {
        const dossier = await stat(path.dirname(chemin));
        if (!dossier.isDirectory())
            throw new Error();
    }
    catch {
        throw new Error(`Le dossier ${path.dirname(chemin)} n’existe pas.`);
    }
    let avant = "";
    let existe = false;
    try {
        const infos = await lstat(chemin);
        if (infos.isSymbolicLink())
            throw new Error("Ce chemin est un lien symbolique : donne le vrai fichier.");
        if (!infos.isFile())
            throw new Error("Ce chemin n’est pas un fichier.");
        if (infos.size > 1024 * 1024)
            throw new Error("Ce fichier dépasse 1 Mo : ce n’est pas un fichier de configuration.");
        avant = await readFile(chemin, "utf8");
        existe = true;
    }
    catch (e) {
        if (e.code !== "ENOENT")
            throw e;
    }
    if (await exposeAGit(chemin)) {
        throw new Error(`${path.basename(chemin)} est (ou serait) suivi par Git : le secret partirait dans un commit. Ajoute ce fichier au .gitignore, puis réessaie.`);
    }
    if (format === "modele") {
        if (!existe)
            throw new Error(`Le fichier n’existe pas : écris d’abord ${marqueModele(variable)} là où va le secret.`);
        if (!avant.includes(marqueModele(variable)))
            throw new Error(`Le fichier n’a aucune marque ${marqueModele(variable)} à remplacer.`);
    }
    if (format === "brut" && avant.trim())
        throw new Error("Le format « brut » écrit un fichier qui ne contient que le secret : ce fichier n’est pas vide.");
    return { variable, chemin, format, avant, existe };
}
/** Écrit le secret dans le fichier contrôlé ; rend le texte pour l'agent, sans la valeur. */
export async function ecrireCible(cible, valeur) {
    const { variable, chemin, format, avant } = cible;
    let apres;
    let bilan;
    if (format === "env") {
        const r = ecrireDansEnv(avant, variable, valeur);
        apres = r.contenu;
        bilan = r.remplace ? `ligne ${variable}= remplacée` : `ligne ${variable}= ajoutée`;
    }
    else if (format === "modele") {
        const r = remplacerModele(avant, variable, valeur);
        apres = r.contenu;
        bilan = `${r.n} marque${r.n > 1 ? "s" : ""} ${marqueModele(variable)} remplacée${r.n > 1 ? "s" : ""}`;
    }
    else {
        apres = valeur;
        bilan = "fichier qui ne contient que la valeur";
    }
    const tmp = `${chemin}.klyra-${randomUUID().slice(0, 8)}.tmp`;
    await writeFile(tmp, apres, { encoding: "utf8", mode: 0o600 });
    await rename(tmp, chemin);
    await chmod(chemin, 0o600).catch(() => undefined);
    return `${variable} écrit dans ${chemin} (${bilan}, fichier lisible par son propriétaire seulement, hors de Git). N’affiche pas ce fichier ni la variable : lis-la depuis tes commandes (ex. source, dotenv).`;
}
