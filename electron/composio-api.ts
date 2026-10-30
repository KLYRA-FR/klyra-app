/**
 * Client REST Composio réservé au process principal. Aucun accès au CLI ni aux
 * identifiants du poste. Les comptes et les configurations sont projetés avant
 * de sortir de ce module ; la clé et les liens de consentement restent privés.
 *
 * Contrats vérifiés le 30/10/2026 :
 * https://docs.composio.dev/reference/api-reference/connected-accounts
 * https://docs.composio.dev/reference/api-reference/auth-configs/getAuthConfigs
 * https://docs.composio.dev/reference/api-reference/tools/getTools
 * https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteByToolSlug
 * L'exécution directe reste supportée, mais Composio recommande ses sessions
 * pour les nouvelles intégrations. KLYRA assure ici le contrôle dans son MCP.
 */

const BASE = "https://backend.composio.dev/api/v3.1";
const DELAI_MS = 15_000;
const MAX_PAGES = 50;
const MAX_LIGNES = 10_000;
const MAX_OCTETS = 4 * 1024 * 1024;
const STATUTS = ["INITIALIZING", "INITIATED", "ACTIVE", "FAILED", "EXPIRED", "INACTIVE", "REVOKED"] as const;
export type StatutComposio = (typeof STATUTS)[number] | "INCONNU";

/** Données publiques d'un compte. Aucun objet d'authentification n'est exposé. */
export interface CompteComposio {
  id: string;
  service: string;
  userId: string;
  authConfigId: string;
  nom: string;
  alias: string;
  statut: StatutComposio;
  desactive: boolean;
}
export interface ConfigurationComposio { id: string; nom: string; methode: string; active: boolean }
export interface ServiceComposio {
  slug: string;
  nom: string;
  description: string;
  configurations: ConfigurationComposio[];
}
export interface OutilComposio {
  slug: string;
  service: string;
  nom: string;
  description: string;
  version: string;
  parametres: Record<string, unknown>;
}
/** Privé : ouvrir lien dans le navigateur depuis main, ne pas le journaliser. */
export interface ConnexionComposio { compteId: string; lien: string; expireLe: string | null }
export interface ResultatComposio { succes: boolean; donnees: unknown; erreur?: string }

export class ErreurComposio extends Error {
  constructor(message: string, readonly code: "acces" | "absent" | "limite" | "reseau" | "reponse" | "entree" | "api", readonly statutHttp?: number) {
    super(message);
    this.name = "ErreurComposio";
  }
}

type Objet = Record<string, unknown>;
const estObjet = (v: unknown): v is Objet => typeof v === "object" && v !== null && !Array.isArray(v);
function objet(v: unknown): Objet {
  if (!estObjet(v)) throw new ErreurComposio("Composio a renvoyé une réponse inattendue.", "reponse");
  return v;
}
function chaine(v: unknown, max = 256): string {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) {
    throw new ErreurComposio("Composio a renvoyé un identifiant inattendu.", "reponse");
  }
  return v;
}
function identifiant(v: string): string {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(v)) {
    throw new ErreurComposio("Identifiant Composio invalide.", "entree");
  }
  return v;
}
function utilisateur(v: string): string {
  if (typeof v !== "string" || !v.trim() || v.length > 256 || /[\u0000-\u001f\u007f]/.test(v)) {
    throw new ErreurComposio("Identité Composio invalide.", "entree");
  }
  return v;
}
function texte(v: unknown, max: number): string {
  return typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, max) : "";
}
function compte(v: unknown): CompteComposio {
  const r = objet(v);
  const config = objet(r.auth_config);
  if (estObjet(r.experimental) && r.experimental.account_type !== undefined && r.experimental.account_type !== "PRIVATE") {
    throw new ErreurComposio("Cette connexion Composio n’est pas privée.", "reponse");
  }
  const state = estObjet(r.state) && estObjet(r.state.val) ? r.state.val : {};
  return {
    id: chaine(r.id), service: chaine(objet(r.toolkit).slug), userId: chaine(r.user_id), authConfigId: chaine(config.id),
    nom: texte(state.displayName, 200), alias: texte(r.alias, 120),
    statut: STATUTS.includes(r.status as (typeof STATUTS)[number]) ? r.status as StatutComposio : "INCONNU",
    desactive: (r.is_disabled !== undefined && r.is_disabled !== false) || (config.is_disabled !== undefined && config.is_disabled !== false),
  };
}
function outil(v: unknown): OutilComposio {
  const r = objet(v);
  return {
    slug: chaine(r.slug), service: chaine(objet(r.toolkit).slug), nom: texte(r.name, 200),
    description: texte(r.description, 12_000), version: chaine(r.version), parametres: objet(r.input_parameters),
  };
}

/** Écarte les champs d'authentification, même si un fournisseur les renvoie. */
function nettoyer(v: unknown, cle: string, profondeur = 0): unknown {
  if (profondeur > 40) return "[Résultat trop profond]";
  if (typeof v === "string") {
    return v.split(cle).join("[secret masqué]")
      .replace(/([?&](?:token|access[_-]?token|refresh[_-]?token|api[_-]?key|key|signature|sig|x-amz-signature)=)[^&#\s]*/gi, "$1[secret masqué]");
  }
  if (Array.isArray(v)) return v.map((x) => nettoyer(x, cle, profondeur + 1));
  if (!estObjet(v)) return v;
  return Object.fromEntries(Object.entries(v)
    .filter(([k]) => !/^(?:config|configuration|credentials?|cle|key|apikey|accesskey|secret|clientsecret|password|authorization|auth|authstate|authconfig|state|connectiondata|customauthparams|customconnectiondata|redirect|redirecturl|linktoken|sessionuri|tokens?|accesstoken|refreshtoken|idtoken|bearertoken|oauthtoken|oauthtokensecret|cookie|setcookie|headers)$/i.test(k.replace(/[_-]/g, "")))
    .map(([k, x]) => [k, nettoyer(x, cle, profondeur + 1)]));
}

export class ComposioApi {
  #cle: string;
  #fetcher: typeof fetch;

  constructor(cle: string, fetcher: typeof fetch = fetch) {
    if (typeof cle !== "string" || cle.trim().length < 8 || cle.length > 4096 || /\s/.test(cle)) {
      throw new ErreurComposio("La clé Composio est invalide.", "entree");
    }
    this.#cle = cle;
    this.#fetcher = fetcher;
  }

  async #appeler(chemin: string, params: Record<string, string> = {}, methode: "GET" | "POST" | "DELETE" = "GET", donnees?: Objet): Promise<unknown> {
    const url = new URL(`${BASE}${chemin}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const controle = new AbortController();
    const delai = setTimeout(() => controle.abort(), DELAI_MS);
    try {
      const r = await this.#fetcher(url.toString(), {
        method: methode, headers: { "x-api-key": this.#cle, Accept: "application/json", ...(donnees ? { "Content-Type": "application/json" } : {}) },
        ...(donnees ? { body: JSON.stringify(donnees) } : {}), signal: controle.signal,
        redirect: "error", credentials: "omit", cache: "no-store",
      });
      if (!r.ok) {
        await r.body?.cancel();
        if (r.status === 401 || r.status === 403) throw new ErreurComposio("Composio refuse l’accès. Vérifie la clé et ses permissions.", "acces", r.status);
        if (r.status === 404) throw new ErreurComposio("Cette ressource Composio est absente.", "absent", r.status);
        if (r.status === 429) throw new ErreurComposio("Composio limite les requêtes. Réessaie plus tard.", "limite", r.status);
        throw new ErreurComposio(`Composio a refusé la requête (HTTP ${r.status}).`, "api", r.status);
      }
      if (!r.body) throw new ErreurComposio("Composio a renvoyé une réponse vide.", "reponse");
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let taille = 0;
      let corps = "";
      while (true) {
        const bloc = await reader.read();
        if (bloc.done) break;
        taille += bloc.value.byteLength;
        if (taille > MAX_OCTETS) {
          await reader.cancel();
          throw new ErreurComposio("La réponse Composio dépasse la taille prise en charge.", "limite");
        }
        corps += decoder.decode(bloc.value, { stream: true });
      }
      corps += decoder.decode();
      try { return JSON.parse(corps) as unknown; }
      catch { throw new ErreurComposio("Composio a renvoyé une réponse illisible.", "reponse"); }
    } catch (e) {
      if (e instanceof ErreurComposio) throw e;
      throw new ErreurComposio("Impossible de joindre Composio. Vérifie la connexion et réessaie.", "reseau");
    } finally { clearTimeout(delai); }
  }

  /** Toutes les pages, ou une erreur explicite : jamais de liste tronquée. */
  async #lister(chemin: string, params: Record<string, string>): Promise<unknown[]> {
    const resultat: unknown[] = [];
    const vus = new Set<string>();
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const r = objet(await this.#appeler(chemin, { ...params, limit: "200", ...(cursor ? { cursor } : {}) }));
      if (!Array.isArray(r.items)) throw new ErreurComposio("Composio a renvoyé une liste inattendue.", "reponse");
      resultat.push(...r.items);
      if (resultat.length > MAX_LIGNES) throw new ErreurComposio("La liste Composio dépasse la limite prise en charge.", "limite");
      if (r.next_cursor === null || r.next_cursor === undefined || r.next_cursor === "") return resultat;
      if (typeof r.next_cursor !== "string" || r.next_cursor.length > 4096 || vus.has(r.next_cursor)) {
        throw new ErreurComposio("La pagination Composio est incohérente.", "reponse");
      }
      cursor = r.next_cursor;
      vus.add(cursor);
    }
    throw new ErreurComposio("La liste Composio est trop longue. Aucun résultat partiel n’est utilisé.", "limite");
  }

  /** Services configurés dans CE projet ; aucun catalogue factice ni création. */
  async listerServices(): Promise<ServiceComposio[]> {
    const configs = await this.#lister("/auth_configs", { show_disabled: "true" });
    if (!configs.length) return [];
    const catalogue = await this.#lister("/toolkits", { include_deprecated: "false" });
    const noms = new Map(catalogue.map((v) => {
      const r = objet(v);
      const meta = estObjet(r.meta) ? r.meta : {};
      return [chaine(r.slug), { nom: texte(r.name, 200), description: texte(meta.description, 2000) }];
    }));
    const services = new Map<string, ServiceComposio>();
    for (const v of configs) {
      const r = objet(v);
      const slug = chaine(objet(r.toolkit).slug);
      const s = services.get(slug) ?? { slug, nom: noms.get(slug)?.nom || slug, description: noms.get(slug)?.description || "", configurations: [] };
      s.configurations.push({ id: chaine(r.id), nom: texte(r.name, 200), methode: texte(r.auth_scheme, 80), active: r.status === "ENABLED" });
      services.set(slug, s);
    }
    return [...services.values()].sort((a, b) => a.nom.localeCompare(b.nom));
  }

  async listerComptes(userId: string): Promise<CompteComposio[]> {
    const id = utilisateur(userId);
    const lignes = await this.#lister("/connected_accounts", { user_ids: id, account_type: "PRIVATE" });
    const comptes = lignes.map(compte);
    if (comptes.some((c) => c.userId !== id)) throw new ErreurComposio("Composio a renvoyé un compte d’une autre identité.", "reponse");
    return comptes;
  }

  async lireCompte(id: string): Promise<CompteComposio> {
    const c = compte(await this.#appeler(`/connected_accounts/${identifiant(id)}`));
    if (c.id !== id) throw new ErreurComposio("Composio a renvoyé un autre compte.", "reponse");
    return c;
  }

  /** Un nouveau Connect Link, également pour réautoriser un compte expiré. */
  async connecter(userId: string, authConfigId: string): Promise<ConnexionComposio> {
    const r = objet(await this.#appeler("/connected_accounts/link", {}, "POST", { user_id: utilisateur(userId), auth_config_id: identifiant(authConfigId) }));
    const lien = chaine(r.redirect_url, 4096);
    let url: URL;
    try { url = new URL(lien); } catch { throw new ErreurComposio("Composio a renvoyé un lien invalide.", "reponse"); }
    if (url.protocol !== "https:" || !["connect.composio.dev", "app.composio.dev", "dashboard.composio.dev"].includes(url.hostname) || url.username || url.password || url.port) {
      throw new ErreurComposio("Composio a renvoyé un lien non autorisé.", "reponse");
    }
    return { compteId: chaine(r.connected_account_id), lien, expireLe: typeof r.expires_at === "string" ? r.expires_at : null };
  }

  /** Suppression Composio définitive ; ne promet pas une révocation fournisseur. */
  async deconnecter(id: string): Promise<void> {
    const r = objet(await this.#appeler(`/connected_accounts/${identifiant(id)}`, {}, "DELETE"));
    if (r.success !== true) throw new ErreurComposio("Composio n’a pas confirmé la déconnexion.", "reponse");
  }

  async chercherOutils(service: string, query: string): Promise<OutilComposio[]> {
    identifiant(service);
    if (typeof query !== "string" || query.length > 500 || /[\u0000-\u001f\u007f]/.test(query)) throw new ErreurComposio("Recherche Composio invalide.", "entree");
    const lignes = await this.#lister("/tools", { toolkit_slug: service, query, include_deprecated: "false", toolkit_versions: "latest" });
    const outils = lignes.map(outil);
    if (outils.some((o) => o.service !== service)) throw new ErreurComposio("Composio a renvoyé un outil d’un autre service.", "reponse");
    return outils;
  }

  async lireOutil(slug: string): Promise<OutilComposio> {
    const o = outil(await this.#appeler(`/tools/${identifiant(slug)}`, { toolkit_versions: "latest" }));
    if (o.slug !== slug) throw new ErreurComposio("Composio a renvoyé un autre outil.", "reponse");
    return o;
  }

  /** Le parent vérifie identité/statut et fournit le compte choisi, jamais le modèle. */
  async executerOutil(slug: string, version: string, compteId: string, userId: string, args: Record<string, unknown>): Promise<ResultatComposio> {
    identifiant(slug); identifiant(compteId); utilisateur(userId);
    if (compteId === "instant_account" || !estObjet(args) || typeof version !== "string" || !/^[a-zA-Z0-9_.-]{1,100}$/.test(version) || version === "latest") {
      throw new ErreurComposio("Exécution Composio invalide : compte et version explicites requis.", "entree");
    }
    let taille: number;
    try { taille = JSON.stringify(args).length; } catch { throw new ErreurComposio("Arguments Composio invalides.", "entree"); }
    if (taille > 256_000) throw new ErreurComposio("Arguments Composio trop volumineux.", "entree");
    const r = objet(await this.#appeler(`/tools/execute/${slug}`, {}, "POST", { connected_account_id: compteId, user_id: userId, version, arguments: args }));
    if (typeof r.successful !== "boolean") throw new ErreurComposio("Composio n’a pas confirmé le résultat de l’outil.", "reponse");
    return { succes: r.successful, donnees: nettoyer(r.data ?? null, this.#cle), ...(!r.successful ? { erreur: "L’outil Composio a échoué. Vérifie ses paramètres et la connexion du compte." } : {}) };
  }
}
