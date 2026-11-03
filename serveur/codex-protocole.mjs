// Généré par scripts/serveur-genere.mjs depuis electron/moteurs/codex-protocole.ts : ne pas modifier à la main.
/** Les trois accès de l'app, dans les mots de Codex : quand il demande, et ce que son bac à sable laisse faire. */
export function accesCodex(acces) {
    switch (acces) {
        case "demander":
            return { approvalPolicy: "untrusted", sandbox: "read-only", sandboxPolicy: { type: "readOnly", networkAccess: false } };
        case "projet":
            return {
                approvalPolicy: "on-request",
                sandbox: "workspace-write",
                sandboxPolicy: { type: "workspaceWrite", writableRoots: [], networkAccess: true, excludeTmpdirEnvVar: false, excludeSlashTmp: false },
            };
        case "tout":
            return { approvalPolicy: "never", sandbox: "danger-full-access", sandboxPolicy: { type: "dangerFullAccess" } };
    }
}
/** Les serveurs MCP de l'app (format `--mcp-config` de Claude Code, cf. ia.ts) en `mcp_servers` de Codex. */
export function mcpPourCodex(config) {
    if (!config)
        return {};
    const { mcpServers = {} } = JSON.parse(config);
    return Object.fromEntries(Object.entries(mcpServers).map(([nom, s]) => [
        nom,
        s.url
            ? { url: s.url, ...(s.headers ? { http_headers: s.headers } : {}) }
            : { command: s.command, args: s.args ?? [], ...(s.env ? { env: s.env } : {}) },
    ]));
}
/** La fiche d'un agent sans son en-tête YAML : ce qui devient sa consigne. */
export function corpsDeFiche(contenu) {
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/.exec(contenu);
    return (m ? contenu.slice(m[0].length) : contenu).trim();
}
/** Ta réponse à une demande d'autorisation, dans les mots de Codex. */
export function decisionCodex(decision) {
    return decision === "oui" ? "accept" : decision === "toujours" ? "acceptForSession" : "decline";
}
const APERCU = 600;
const court = (texte) => (texte.length > APERCU ? `${texte.slice(0, APERCU)}…` : texte);
/** Une étape de l'app pour un élément de Codex ; null pour ce qui n'en est pas une (texte, réflexion…). */
export function etapeDe(item) {
    switch (item.type) {
        case "commandExecution":
            return { outil: "Bash", entree: { command: item.command } };
        case "fileChange": {
            const changes = item.changes ?? [];
            return { outil: "Edit", entree: { file_path: changes[0]?.path ?? "", fichiers: changes.map((c) => c.path) } };
        }
        case "mcpToolCall":
            return { outil: `mcp__${String(item.server)}__${String(item.tool)}`, entree: item.arguments ?? {} };
        case "dynamicToolCall":
            return { outil: String(item.tool), entree: item.arguments ?? {} };
        case "webSearch":
            return { outil: "WebSearch", entree: { query: item.query ?? "" } };
        case "imageView":
            return { outil: "Read", entree: { file_path: item.path } };
        default:
            return null;
    }
}
/** Comment l'étape s'est terminée, et ce qu'on en montre. */
export function finDEtape(item) {
    switch (item.type) {
        case "commandExecution":
            return { ok: item.status === "completed" && (item.exitCode ?? 0) === 0, apercu: court(String(item.aggregatedOutput ?? "").trim()) };
        case "fileChange":
            return { ok: item.status === "completed", apercu: item.status === "declined" ? "Refusé." : "" };
        case "mcpToolCall": {
            const erreur = item.error?.message;
            const contenu = (item.result?.content ?? [])
                .map((c) => (c.type === "text" ? c.text : ""))
                .join("\n");
            return { ok: item.status === "completed" && !erreur, apercu: court((erreur ?? contenu).trim()) };
        }
        default:
            return { ok: item.status !== "failed" && item.status !== "declined", apercu: "" };
    }
}
/**
 * Une réponse de Codex (un « tour »), traduite au fil de l'eau en `AgentEvent`.
 * `notification` rend true quand le tour est fini : son `fin` est parti.
 */
export class TourCodex {
    etapes = new Set();
    etapesDepuisTexte = false;
    dejaDuTexte = false;
    dernierTexte = "";
    /** Tu l'as arrêté : sa fin le dit. */
    arrete = false;
    /** Le tour de Codex qui porte cette réponse, connu à `turn/started`. */
    turnId = null;
    /** Les jetons écrits dans tout le fil de Codex, réflexion comprise. */
    jetonsDuFil;
    threadId;
    emit;
    jetonsAvant;
    /** `jetonsAvant` : ceux du fil avant ce tour (Codex compte le fil entier, l'app compte la réponse). */
    constructor(threadId, emit, jetonsAvant = 0) {
        this.threadId = threadId;
        this.emit = emit;
        this.jetonsAvant = jetonsAvant;
        this.jetonsDuFil = jetonsAvant;
    }
    notification(method, params) {
        switch (method) {
            case "turn/started":
                this.turnId = String(params.turn.id);
                return false;
            case "item/agentMessage/delta": {
                const delta = String(params.delta ?? "");
                if (!delta)
                    return false;
                this.emit({ type: "texte", delta, nouveauBloc: this.dejaDuTexte && this.etapesDepuisTexte });
                this.dejaDuTexte = true;
                this.etapesDepuisTexte = false;
                return false;
            }
            case "item/started": {
                const item = params.item;
                const etape = etapeDe(item);
                if (!etape)
                    return false;
                this.etapes.add(item.id);
                this.etapesDepuisTexte = true;
                this.emit({ type: "etape", id: item.id, outil: etape.outil, entree: etape.entree, parent: null });
                return false;
            }
            case "item/completed": {
                const item = params.item;
                if (item.type === "agentMessage" && typeof item.text === "string" && item.text)
                    this.dernierTexte = item.text;
                if (!this.etapes.delete(item.id))
                    return false;
                this.emit({ type: "etape-fin", id: item.id, ...finDEtape(item) });
                return false;
            }
            case "thread/tokenUsage/updated": {
                const total = params.tokenUsage.total;
                if (!total)
                    return false;
                this.jetonsDuFil = (total.outputTokens ?? 0) + (total.reasoningOutputTokens ?? 0);
                this.emit({ type: "jetons", total: Math.max(0, this.jetonsDuFil - this.jetonsAvant) });
                return false;
            }
            case "turn/completed": {
                const turn = params.turn;
                const ok = turn.status === "completed" && !this.arrete;
                this.emit({
                    type: "fin",
                    ok,
                    texte: this.dernierTexte,
                    erreur: ok ? undefined : this.arrete || turn.status === "interrupted" ? "Arrêté par toi." : turn.error?.message || "L’agent s’est arrêté sur une erreur.",
                    sessionId: this.threadId,
                });
                return true;
            }
            default:
                return false;
        }
    }
}
/** Une demande de Codex qui attend ta réponse, en carte d'autorisation ; null pour celles que l'app refuse d'office. */
export function autorisationDe(method, params) {
    switch (method) {
        case "item/commandExecution/requestApproval": {
            const commande = typeof params.command === "string" ? params.command : "";
            return { outil: "Bash", entree: { command: commande }, description: String(params.reason ?? commande) || "Lancer une commande" };
        }
        case "item/fileChange/requestApproval":
            return { outil: "Edit", entree: { file_path: params.grantRoot ?? "" }, description: String(params.reason ?? "") || "Modifier des fichiers" };
        case "item/permissions/requestApproval":
            return { outil: "Permissions", entree: { permissions: params.permissions }, description: String(params.reason ?? "") || "Plus d’accès (réseau ou fichiers)" };
        default:
            return null;
    }
}
/** La réponse à envoyer à Codex pour une demande d'autorisation. */
export function reponseAutorisation(method, params, decision) {
    if (method === "item/permissions/requestApproval") {
        return decision === "non"
            ? { permissions: {}, scope: "turn" }
            : { permissions: params.permissions ?? {}, scope: decision === "toujours" ? "session" : "turn" };
    }
    return { decision: decisionCodex(decision) };
}
/**
 * Ce que l'app répond d'office aux demandes qu'elle ne sait pas montrer : questions en cours de route
 * (l'agent les pose dans sa réponse, comme à un collègue), formulaires MCP, outils du client.
 */
export function reponseDOffice(method) {
    switch (method) {
        case "item/tool/requestUserInput":
            return { result: { answers: {} } };
        case "mcpServer/elicitation/request":
            return { result: { action: "decline", content: null, _meta: null } };
        case "execCommandApproval":
        case "applyPatchApproval":
            return { result: { decision: "denied" } };
        default:
            return { error: { code: -32601, message: `KLYRA ne gère pas « ${method} ».` } };
    }
}
