// Généré par scripts/serveur-genere.mjs depuis electron/composio-relais.ts : ne pas modifier à la main.
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
const DESTINATION = "https://connect.composio.dev/mcp";
const MAX_CORPS = 25 * 1024 * 1024;
/** La configuration remise aux agents porte seulement le secret du relais local, jamais le jeton OAuth.
 * Elle reste valable pendant un long tour et à travers une reconnexion de Composio. */
export function serveurRelaisComposio(urlMcp, secretLocal) {
    const url = new URL(urlMcp);
    url.pathname = "/composio";
    url.search = "";
    return { type: "http", url: url.toString(), headers: { Authorization: `Bearer ${secretLocal}` } };
}
/** À appeler APRÈS la vérification du secret local par le serveur MCP de KLYRA.
 * Prépare/renouvelle l'accès à chaque requête ; aucun appel métier n'est réessayé automatiquement. */
export async function relayerComposio(req, res, preparer, appeler = globalThis.fetch) {
    const finir = (statut, message) => {
        if (res.headersSent) {
            res.destroy();
            return;
        }
        res.writeHead(statut, { "Content-Type": "application/json", "Cache-Control": "no-store" });
        res.end(JSON.stringify({ erreur: message }));
    };
    if (!["POST", "GET", "DELETE"].includes(req.method ?? ""))
        return finir(405, "Méthode MCP inconnue.");
    if (Number(req.headers["content-length"] ?? 0) > MAX_CORPS)
        return finir(413, "Requête Composio trop volumineuse.");
    const controle = new AbortController();
    const fermeture = () => controle.abort();
    req.once("aborted", fermeture);
    res.once("close", fermeture);
    const delai = setTimeout(fermeture, 5 * 60_000);
    try {
        const connexion = await preparer();
        if (!connexion)
            return finir(401, "La connexion Composio de cette machine doit être rétablie dans KLYRA.");
        if (connexion.url !== DESTINATION || typeof connexion.headers.Authorization !== "string")
            return finir(502, "Configuration Composio invalide.");
        const morceaux = [];
        let taille = 0;
        for await (const morceau of req) {
            const b = Buffer.isBuffer(morceau) ? morceau : Buffer.from(morceau);
            taille += b.length;
            if (taille > MAX_CORPS)
                return finir(413, "Requête Composio trop volumineuse.");
            morceaux.push(b);
        }
        const headers = {
            Authorization: connexion.headers.Authorization,
            Accept: "application/json, text/event-stream",
            "Content-Type": "application/json",
        };
        // Le protocole/session du client passe ; son Authorization et les en-têtes de l'app ne passent jamais.
        for (const nom of ["mcp-session-id", "mcp-protocol-version", "last-event-id"]) {
            const v = req.headers[nom];
            if (typeof v === "string" && v.length <= 1024)
                headers[nom] = v;
        }
        const reponse = await appeler(DESTINATION, {
            method: req.method, headers, redirect: "error", signal: controle.signal,
            ...(req.method === "POST" ? { body: Buffer.concat(morceaux).toString("utf8") } : {}),
        });
        const retour = { "Cache-Control": "no-store" };
        for (const nom of ["content-type", "mcp-session-id", "mcp-protocol-version"]) {
            const v = reponse.headers.get(nom);
            if (v)
                retour[nom] = v;
        }
        res.writeHead(reponse.status, retour);
        if (reponse.body)
            await pipeline(Readable.fromWeb(reponse.body), res);
        else
            res.end();
    }
    catch {
        // Ne jamais rendre une exception réseau : elle peut contenir l'en-tête d'authentification.
        if (!res.destroyed)
            finir(502, "Composio ne répond pas. Réessaie dans un instant.");
    }
    finally {
        clearTimeout(delai);
        req.removeListener("aborted", fermeture);
        res.removeListener("close", fermeture);
    }
}
