// Généré par scripts/serveur-genere.mjs depuis electron/regles-projet.ts : ne pas modifier à la main.
/**
 * Les autorisations retenues pour un projet : ce que « Toujours, dans ce projet » a fait écrire à Claude Code
 * dans `<projet>/.claude/settings.local.json` (`permissions.allow`, et `ask` / `deny` s'il y en a). L'app les
 * montre et en retire une à la demande, sans toucher au reste du fichier. Jamais par un lien.
 * Pur et sans Electron : le même module sert à l'app et au serveur d'un VPS (généré en `serveur/regles-projet.mjs`).
 */
import { existsSync, lstatSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
const fichierDe = (dossier) => path.join(dossier, ".claude", "settings.local.json");
/** Ni le dossier `.claude` ni le fichier ne sont des liens : on n'écrit que dans le projet. */
function sansLien(dossier) {
    for (const p of [path.join(dossier, ".claude"), fichierDe(dossier)]) {
        try {
            if (lstatSync(p).isSymbolicLink())
                return false;
        }
        catch {
            /* absent : rien à craindre */
        }
    }
    return true;
}
function lireJson(dossier) {
    const f = fichierDe(dossier);
    if (!existsSync(f))
        return null;
    try {
        const v = JSON.parse(readFileSync(f, "utf8"));
        return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    }
    catch {
        return null;
    }
}
const chaines = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, 500) : []);
/** Les règles retenues du projet (vides sans fichier, ou s'il est illisible). */
export function lireReglesProjet(dossier) {
    const json = lireJson(dossier);
    const permissions = (json?.permissions ?? {});
    return { allow: chaines(permissions.allow), ask: chaines(permissions.ask), deny: chaines(permissions.deny) };
}
/** Retire une règle (rien d'autre ne change dans le fichier) ; rend les règles qui restent. */
export function retirerRegleProjet(dossier, liste, regle) {
    if (!["allow", "ask", "deny"].includes(liste) || typeof regle !== "string")
        throw new Error("Règle invalide.");
    if (!sansLien(dossier))
        throw new Error("Les réglages de ce projet passent par un lien : l’app n’y touche pas.");
    const json = lireJson(dossier);
    if (!json)
        throw new Error("Les réglages de ce projet sont illisibles : l’app n’y touche pas.");
    const permissions = (json.permissions && typeof json.permissions === "object" && !Array.isArray(json.permissions) ? json.permissions : {});
    const avant = chaines(permissions[liste]);
    if (!avant.includes(regle))
        return lireReglesProjet(dossier);
    const suite = { ...json, permissions: { ...permissions, [liste]: permissions[liste].filter((r) => r !== regle) } };
    const f = fichierDe(dossier);
    const temporaire = `${f}.klyra-tmp`;
    writeFileSync(temporaire, `${JSON.stringify(suite, null, 2)}\n`);
    renameSync(temporaire, f);
    return lireReglesProjet(dossier);
}
/**
 * Les règles que Claude Code propose de retenir avec une demande d'autorisation (`permission_suggestions` de type
 * `addRules`, comportement `allow`), écrites comme dans ses réglages (« Bash(npm test:*) »).
 */
export function reglesProposees(suggestions) {
    if (!Array.isArray(suggestions))
        return [];
    const regles = [];
    for (const s of suggestions) {
        const x = (s ?? {});
        if (x.type !== "addRules" || (x.behavior !== undefined && x.behavior !== "allow") || !Array.isArray(x.rules))
            continue;
        for (const r of x.rules) {
            const rule = (r ?? {});
            if (typeof rule.toolName !== "string" || !rule.toolName)
                continue;
            regles.push(typeof rule.ruleContent === "string" && rule.ruleContent ? `${rule.toolName}(${rule.ruleContent})` : rule.toolName);
        }
    }
    return [...new Set(regles)].slice(0, 10);
}
