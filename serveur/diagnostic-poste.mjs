// Généré par scripts/serveur-genere.mjs depuis electron/diagnostic-poste.ts : ne pas modifier à la main.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
/**
 * Ce que le poste de la personne ajoute à chaque appel des sessions de l'app, en plus de l'app
 * elle-même : son CLAUDE.md personnel, ses skills, ses plugins, ses serveurs MCP, et la présentation de
 * ses agents actifs. Lecture seule. Les tailles sont estimées d'après les fichiers : une mesure exacte
 * demanderait un appel au modèle. Calibré le 03/11/2026 : un CLAUDE.md de 6 164 octets ajoute 2 391 jetons
 * réels (Claude Code l'entoure d'un peu de texte) ; 2,75 caractères par jeton, comme `pnpm mesure:socle --reel`.
 * Une session Claude lancée par l'app lit un dossier préparé (`CLAUDE_CONFIG_DIR`) :
 * les agents actifs, et seulement les skills allumées pour cet agent. Le poste n'est pas modifié.
 * `--setting-sources project,local` retire aussi ce dossier : on ne le combine pas.
 * Ce diagnostic lit encore le poste (ce que la personne a), pas le dossier d'une session.
 * Les plugins du poste n'entrent pas dans ce dossier. Les interrupteurs sont dans Réglages › Agents.
 */
export const CARACTERES_PAR_JETON = 2.75;
const jetons = (caracteres) => Math.round(caracteres / CARACTERES_PAR_JETON);
const lire = (fichier) => {
    try {
        return readFileSync(fichier, "utf8");
    }
    catch {
        return null;
    }
};
const lireJson = (fichier) => {
    const brut = lire(fichier);
    if (!brut)
        return null;
    try {
        return JSON.parse(brut);
    }
    catch {
        return null;
    }
};
const lister = (dossier) => {
    try {
        return readdirSync(dossier);
    }
    catch {
        return [];
    }
};
/** Le champ `description` d'un en-tête YAML simple (entre guillemets ou non). */
export function description(contenu) {
    const entete = /^---\n([\s\S]*?)\n---/.exec(contenu)?.[1] ?? "";
    const ligne = /^description:\s*(.*)$/m.exec(entete)?.[1]?.trim() ?? "";
    return ligne.replace(/^(["'])([\s\S]*)\1$/, "$2");
}
/** Le CLAUDE.md personnel et ses imports `@chemin` (un niveau), tels que Claude Code les charge. */
function claudeMd(dossierClaude) {
    const fichier = path.join(dossierClaude, "CLAUDE.md");
    const contenu = lire(fichier);
    if (contenu === null)
        return { cle: "claude-md", libelle: "CLAUDE.md personnel", detail: "Aucun.", jetons: 0, conseil: null, chemin: null };
    let caracteres = contenu.length;
    let imports = 0;
    for (const [, cible] of contenu.matchAll(/^@(\S+)\s*$/gm)) {
        const chemin = cible.startsWith("~/") ? path.join(path.dirname(dossierClaude), cible.slice(2)) : path.resolve(path.dirname(fichier), cible);
        const importe = lire(chemin);
        if (importe !== null) {
            caracteres += importe.length;
            imports += 1;
        }
    }
    const n = jetons(caracteres);
    return {
        cle: "claude-md",
        libelle: "CLAUDE.md personnel",
        detail: `${caracteres.toLocaleString("fr-FR")} caractères${imports ? `, avec ${imports} fichier${imports > 1 ? "s" : ""} importé${imports > 1 ? "s" : ""}` : ""}, relus à chaque appel de tous tes agents, dans KLYRA comme ailleurs.`,
        jetons: n,
        conseil: n > 1500 ? "Garde-y seulement ce qui vaut partout. Ce qui concerne un projet va dans son AGENTS.md : il ne sera lu que là." : null,
        chemin: fichier,
    };
}
/** Les skills personnelles : leur nom et leur description sont listés à chaque appel. */
function skills(dossierClaude) {
    const dossier = path.join(dossierClaude, "skills");
    const noms = [];
    let caracteres = 0;
    for (const nom of lister(dossier)) {
        const contenu = lire(path.join(dossier, nom, "SKILL.md"));
        if (contenu === null)
            continue;
        noms.push(nom);
        caracteres += nom.length + description(contenu).length + 4;
    }
    const n = jetons(caracteres);
    return {
        cle: "skills",
        libelle: "Skills personnelles",
        detail: noms.length ? `${noms.length} skill${noms.length > 1 ? "s" : ""} (${noms.slice(0, 6).join(", ")}${noms.length > 6 ? "…" : ""}) : présentée${noms.length > 1 ? "s" : ""} à un agent tant qu’on ne la coupe pas dans Réglages › Agents.` : "Aucune.",
        jetons: n,
        conseil: n > 400 ? "Coupe, dans Réglages › Agents, celles qui ne servent pas à un agent : une skill coupée ne part plus dans ses appels. Rien n’est supprimé du poste." : null,
        chemin: noms.length ? dossier : null,
    };
}
/** Les agents actifs : l'assistant reçoit le nom et la description de chacun à chaque appel. */
function agents(dossierClaude, actifs) {
    let caracteres = 0;
    let longues = 0;
    for (const id of actifs) {
        const d = description(lire(path.join(dossierClaude, "agents", `${id}.md`)) ?? "");
        caracteres += id.length + d.length + 4;
        if (d.length > 300)
            longues += 1;
    }
    return {
        cle: "agents",
        libelle: "Présentation de tes agents actifs",
        detail: actifs.length ? `${actifs.length} agent${actifs.length > 1 ? "s" : ""} actif${actifs.length > 1 ? "s" : ""}, présenté${actifs.length > 1 ? "s" : ""} à l’assistant à chaque appel. Les agents désactivés ne coûtent rien.` : "Aucun agent actif : l’assistant travaille seul.",
        jetons: jetons(caracteres),
        conseil: longues ? `${longues} description${longues > 1 ? "s" : ""} dépasse${longues > 1 ? "nt" : ""} 300 caractères : quelques phrases suffisent pour que l’assistant sache quand appeler l’agent.` : null,
        chemin: actifs.length ? path.join(dossierClaude, "agents") : null,
    };
}
/** Les plugins activés dans les réglages de Claude Code : leur contenu n'est pas mesuré ici. */
function plugins(dossierClaude) {
    const actives = Object.entries((lireJson(path.join(dossierClaude, "settings.json"))?.enabledPlugins ?? {}))
        .filter(([, actif]) => actif === true)
        .map(([nom]) => nom.split("@")[0]);
    return {
        cle: "plugins",
        libelle: "Plugins de Claude Code",
        detail: actives.length ? `${actives.length} activé${actives.length > 1 ? "s" : ""} : ${actives.slice(0, 6).join(", ")}${actives.length > 6 ? "…" : ""}. Une session lancée par KLYRA ne les charge pas.` : "Aucun.",
        jetons: null,
        conseil: actives.length ? "Ces plugins valent pour Claude Code hors de KLYRA. Une session de l’app lit un dossier préparé, sans eux." : null,
        chemin: actives.length ? path.join(dossierClaude, "settings.json") : null,
    };
}
/** Les serveurs MCP du poste (portée utilisateur) : leurs outils sont chargés à la demande. */
function mcp(fichierClaudeJson) {
    const serveurs = Object.keys((lireJson(fichierClaudeJson)?.mcpServers ?? {}));
    return {
        cle: "mcp",
        libelle: "Serveurs MCP du poste",
        detail: serveurs.length ? `${serveurs.length} : ${serveurs.slice(0, 6).join(", ")}${serveurs.length > 6 ? "…" : ""}. Leurs outils sont chargés à la demande : ils coûtent peu tant qu’ils ne servent pas.` : "Aucun.",
        jetons: null,
        conseil: null,
        chemin: serveurs.length ? fichierClaudeJson : null,
    };
}
/**
 * Le diagnostic du poste. `home` : le dossier personnel ; `dossierClaude` : celui de Claude Code
 * (`CLAUDE_CONFIG_DIR`, sinon ~/.claude) ; `actifs` : les agents actifs de Mes agents.
 */
export function diagnostiquerPoste(home, actifs, dossierClaude = path.join(home, ".claude")) {
    const elements = [claudeMd(dossierClaude), skills(dossierClaude), agents(dossierClaude, actifs), plugins(dossierClaude), mcp(path.join(home, ".claude.json"))];
    return { elements, total: elements.reduce((s, e) => s + (e.jetons ?? 0), 0) };
}
/** Le chemin existe-t-il encore (avant de l'ouvrir) ? */
export const existe = (chemin) => existsSync(chemin);
