// Généré par scripts/serveur-genere.mjs depuis electron/composio-connect.ts : ne pas modifier à la main.
import { createHash, randomBytes } from "node:crypto";
import { createServer } from "node:http";
/**
 * Composio Connect : le serveur MCP hébergé de Composio (plus de 1 000 apps),
 * rejoint avec le compte Composio de la personne, sans clé. La connexion suit
 * l'OAuth des serveurs MCP : inscription dynamique du client, PKCE, retour sur
 * une adresse locale (127.0.0.1), jetons renouvelables.
 *
 * Les apps (Gmail, Slack…) se connectent ensuite chez Composio, au premier
 * besoin d'un agent : Composio lui donne un lien d'autorisation à transmettre.
 *
 * Ce module ne touche ni à Electron ni au disque : main lui donne de quoi lire,
 * écrire (chiffré), appeler le réseau et ouvrir le navigateur.
 */
export const URL_CONNECT = "https://connect.composio.dev/mcp";
const DECOUVERTE = "https://connect.composio.dev/.well-known/oauth-authorization-server";
const PORTEE = "openid profile email offline_access";
/** Le temps laissé pour se connecter dans le navigateur. */
const DELAI_CONNEXION_MS = 5 * 60 * 1000;
/** Un jeton qui expire avant cette marge est renouvelé. */
const MARGE_MS = 2 * 60 * 1000;
const base64url = (b) => b.toString("base64url");
/** Les adresses OAuth doivent rester chez Composio, en https. */
function adresseComposio(v) {
    const u = new URL(String(v));
    if (u.protocol !== "https:" || !/(^|\.)composio\.dev$/.test(u.hostname))
        throw new Error("Composio a renvoyé une adresse inattendue.");
    return u.toString();
}
function compteDe(idToken) {
    if (typeof idToken !== "string")
        return null;
    try {
        const charge = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8"));
        const v = typeof charge.email === "string" ? charge.email : typeof charge.name === "string" ? charge.name : null;
        return v ? v.slice(0, 200) : null;
    }
    catch {
        return null;
    }
}
export class ComposioConnect {
    d;
    #jetons = null;
    #enCours = null;
    #erreur = null;
    #renouvellement = null;
    constructor(d) {
        this.d = d;
    }
    #maintenant() { return this.d.maintenant?.() ?? Date.now(); }
    /** À l'ouverture de l'app : relit les jetons et les renouvelle s'il le faut. */
    async charger() {
        this.#jetons = await this.d.lire();
        await this.renouvelerSiBesoin();
    }
    etat() {
        return { connecte: !!this.#jetons, compte: this.#jetons?.compte ?? null, enCours: !!this.#enCours, erreur: this.#erreur };
    }
    async #metadonnees() {
        const r = await this.d.fetch(DECOUVERTE);
        if (!r.ok)
            throw new Error("Composio ne répond pas. Réessaie dans un instant.");
        const m = (await r.json());
        return {
            authorization_endpoint: adresseComposio(m.authorization_endpoint),
            token_endpoint: adresseComposio(m.token_endpoint),
            registration_endpoint: adresseComposio(m.registration_endpoint),
        };
    }
    async #jeton(point, corps) {
        const r = await this.d.fetch(point, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(corps).toString() });
        const v = (await r.json().catch(() => ({})));
        if (!r.ok || typeof v.access_token !== "string")
            throw new Error("Composio n’a pas accordé l’accès. Reconnecte-toi.");
        return v;
    }
    #garder(clientId, v, ancien) {
        const duree = typeof v.expires_in === "number" && v.expires_in > 0 ? v.expires_in : 3600;
        return {
            clientId,
            acces: v.access_token,
            renouvellement: typeof v.refresh_token === "string" ? v.refresh_token : ancien?.renouvellement ?? null,
            expireLe: this.#maintenant() + duree * 1000,
            compte: compteDe(v.id_token) ?? ancien?.compte ?? null,
        };
    }
    /**
     * Ouvre le navigateur sur la page de connexion de Composio et attend le retour.
     * Rend vrai une fois connecté, faux si la personne annule.
     */
    async connecter() {
        if (this.#enCours)
            throw new Error("Une connexion est déjà en cours dans le navigateur.");
        this.#erreur = null;
        let serveur = null;
        let annule = false;
        let liberer = () => { };
        const retour = new Promise((r) => { liberer = r; });
        this.#enCours = { annuler: () => { annule = true; liberer(null); } };
        const minuterie = setTimeout(() => liberer(null), DELAI_CONNEXION_MS);
        try {
            const etat = base64url(randomBytes(24));
            const verificateur = base64url(randomBytes(48));
            serveur = createServer((req, res) => {
                const url = new URL(req.url ?? "/", "http://127.0.0.1");
                if (url.pathname !== "/callback") {
                    res.writeHead(404).end();
                    return;
                }
                const ok = url.searchParams.get("state") === etat && !!url.searchParams.get("code");
                res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
                res.end(`<!doctype html><meta charset="utf-8"><title>KLYRA</title><body style="font-family:sans-serif;padding:48px"><p>${ok ? "Composio est connecté. Tu peux fermer cet onglet et revenir dans KLYRA." : "La connexion n’a pas abouti. Recommence depuis KLYRA."}</p></body>`);
                if (url.searchParams.get("state") === etat)
                    liberer(url.searchParams.get("code"));
            });
            await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
            const redirection = `http://127.0.0.1:${serveur.address().port}/callback`;
            const m = await this.#metadonnees();
            const inscription = await this.d.fetch(m.registration_endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json", Accept: "application/json" },
                body: JSON.stringify({ client_name: "KLYRA", redirect_uris: [redirection], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none", scope: PORTEE }),
            });
            const client = (await inscription.json().catch(() => ({})));
            if (!inscription.ok || typeof client.client_id !== "string")
                throw new Error("Composio refuse d’inscrire KLYRA. Réessaie plus tard.");
            const autorisation = new URL(m.authorization_endpoint);
            for (const [k, v] of Object.entries({
                response_type: "code", client_id: client.client_id, redirect_uri: redirection, scope: PORTEE, state: etat,
                code_challenge: base64url(createHash("sha256").update(verificateur).digest()), code_challenge_method: "S256", resource: URL_CONNECT,
            }))
                autorisation.searchParams.set(k, v);
            await this.d.ouvrir(autorisation.toString());
            const code = await retour;
            if (!code) {
                if (!annule)
                    this.#erreur = "La connexion n’a pas été terminée dans le navigateur.";
                return false;
            }
            const v = await this.#jeton(m.token_endpoint, { grant_type: "authorization_code", code, redirect_uri: redirection, client_id: client.client_id, code_verifier: verificateur, resource: URL_CONNECT });
            this.#jetons = this.#garder(client.client_id, v, null);
            await this.d.ecrire(this.#jetons);
            return true;
        }
        catch (e) {
            this.#erreur = e instanceof Error ? e.message : "La connexion à Composio a échoué.";
            throw e;
        }
        finally {
            clearTimeout(minuterie);
            serveur?.close();
            this.#enCours = null;
        }
    }
    annuler() {
        this.#enCours?.annuler();
    }
    /** Des jetons obtenus ailleurs : un VPS n'a pas de navigateur, l'app de la personne se connecte pour lui. */
    async adopter(jetons) {
        this.#jetons = jetons;
        this.#erreur = null;
        await this.d.ecrire(jetons);
    }
    async deconnecter() {
        this.#enCours?.annuler();
        this.#jetons = null;
        this.#erreur = null;
        await this.d.ecrire(null);
    }
    /** Renouvelle le jeton s'il expire bientôt ; un refus de Composio déconnecte. */
    renouvelerSiBesoin() {
        const j = this.#jetons;
        if (!j || j.expireLe - this.#maintenant() > MARGE_MS)
            return Promise.resolve();
        this.#renouvellement ??= (async () => {
            try {
                if (!j.renouvellement)
                    throw new Error();
                const m = await this.#metadonnees();
                const v = await this.#jeton(m.token_endpoint, { grant_type: "refresh_token", refresh_token: j.renouvellement, client_id: j.clientId, resource: URL_CONNECT });
                this.#jetons = this.#garder(j.clientId, v, j);
                await this.d.ecrire(this.#jetons);
            }
            catch {
                this.#jetons = null;
                this.#erreur = "La session Composio a expiré. Reconnecte-toi.";
                await this.d.ecrire(null).catch(() => { });
            }
            finally {
                this.#renouvellement = null;
            }
        })();
        return this.#renouvellement;
    }
    /** Le serveur à ajouter à la configuration MCP d'un agent, si le jeton est encore valable. */
    serveur() {
        const j = this.#jetons;
        if (!j)
            return null;
        if (j.expireLe - this.#maintenant() <= MARGE_MS)
            void this.renouvelerSiBesoin();
        if (j.expireLe - this.#maintenant() <= 30_000)
            return null;
        return { type: "http", url: URL_CONNECT, headers: { Authorization: `Bearer ${j.acces}` } };
    }
}
