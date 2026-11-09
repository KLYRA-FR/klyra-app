// Généré par scripts/serveur-genere.mjs depuis electron/liste-fichiers.ts : ne pas modifier à la main.
/**
 * Tous les fichiers d'un projet, en chemins relatifs, pour la complétion « @ » du composeur (le message garde
 * `@chemin`, que Claude Code lit dans le dossier du projet). Ceux que Git suit ou ne cache pas (`git ls-files`),
 * sinon un parcours du dossier sans les dossiers lourds (node_modules, .git, dist…), sans suivre les liens.
 * Pur et sans Electron : le même module sert à l'app et au serveur d'un VPS (généré en `serveur/liste-fichiers.mjs`).
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
export const FICHIERS_MAX = 20_000;
const IGNORES = new Set(["node_modules", ".git", ".next", "dist", "dist-electron", "out", "build", ".turbo", ".vercel", ".cache", "coverage", ".venv", "venv", "__pycache__", "target", ".DS_Store"]);
/** Ce que Git connaît du dossier (suivi, ou nouveau sans être ignoré) ; null hors d'un dépôt ou si git manque. */
function parGit(dossier) {
    /* Pas de fsmonitor : un dépôt pourrait y nommer un programme à lancer. */
    const r = spawnSync("git", ["-c", "core.fsmonitor=false", "-c", "core.quotePath=false", "ls-files", "-co", "--exclude-standard", "-z"], {
        cwd: dossier,
        encoding: "utf8",
        timeout: 8000,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    });
    if (r.status !== 0 || typeof r.stdout !== "string")
        return null;
    return r.stdout.split("\0").filter(Boolean);
}
/** Le parcours du dossier, en largeur, sans les dossiers lourds ni les liens. */
function parcours(dossier, max) {
    const fichiers = [];
    const file = [""];
    while (file.length) {
        const relatif = file.shift();
        let entrees;
        try {
            entrees = readdirSync(path.join(dossier, relatif), { withFileTypes: true });
        }
        catch {
            continue;
        }
        for (const e of entrees.sort((a, b) => a.name.localeCompare(b.name))) {
            if (IGNORES.has(e.name) || e.isSymbolicLink())
                continue;
            const chemin = relatif ? `${relatif}/${e.name}` : e.name;
            if (e.isDirectory())
                file.push(chemin);
            else if (e.isFile()) {
                fichiers.push(chemin);
                if (fichiers.length >= max)
                    return { fichiers, coupe: true };
            }
        }
    }
    return { fichiers, coupe: false };
}
/** Les fichiers du projet (chemins relatifs, avec « / »), au plus `max` ; `coupe` : il y en a plus. */
export function listerFichiersProjet(dossier, max = FICHIERS_MAX) {
    const git = parGit(dossier);
    if (git) {
        const propres = git.map((f) => f.split(path.sep).join("/")).filter((f) => !f.split("/").some((p) => p === "node_modules"));
        return { fichiers: propres.slice(0, max), coupe: propres.length > max };
    }
    return parcours(dossier, max);
}
