import { randomBytes, randomUUID } from "node:crypto";
import type { ComposioApi, CompteComposio, OutilComposio } from "./composio-api";
import { ErreurComposio } from "./composio-api";
import type { IdentiteComposio } from "./composio-identite";
import type { EtatComposio } from "./composio-types";

export interface ConfigurationComposio {
  userId: string;
  cle: string | null;
  selections: Record<string, string>;
  enAttente: { compteId: string; service: string; expireLe: string | null }[];
}

export interface DependancesComposio {
  identite: () => Promise<IdentiteComposio>;
  revisionIdentite: () => string;
  lire: (scope: string) => Promise<ConfigurationComposio | null>;
  ecrire: (scope: string, configuration: ConfigurationComposio) => Promise<void>;
  api: (cle: string) => ComposioApi;
  ouvrir: (url: string) => Promise<void>;
  coffreDisponible: () => boolean;
}

interface Contexte {
  identite: IdentiteComposio;
  configuration: ConfigurationComposio | null;
  revision: number;
  id: string;
}

const invalide = () => new Error("La configuration ou le compte KLYRA a changé. Actualise Composio, puis relance la demande.");
const identifiant = (v: unknown): string => {
  if (typeof v !== "string" || !/^[a-zA-Z0-9_-]{1,160}$/.test(v)) throw new Error("Identifiant Composio invalide.");
  return v;
};
const serviceValide = (v: unknown) => identifiant(v).toLowerCase();

/** Logique indépendante d'Electron, testable avec comptes et coffre simulés. */
export class EspaceComposio {
  private revision = 0;
  private ecritureEnCours = false;
  private epoch = randomBytes(16).toString("hex");
  private operations: Promise<unknown> = Promise.resolve();
  private capacites = new Map<string, { signature: string; contexte: Contexte | null }>();
  private schemas = new Map<string, OutilComposio>();

  constructor(private readonly d: DependancesComposio) {}

  signature(): string {
    return `${this.d.revisionIdentite()}:${this.revision}`;
  }

  private verifier(c: Contexte) {
    if (this.ecritureEnCours || c.revision !== this.revision || c.identite.revision !== this.d.revisionIdentite()) throw invalide();
  }

  private async contexte(attendu?: unknown): Promise<Contexte> {
    const revision = this.revision;
    const identite = await this.d.identite();
    const configuration = await this.d.lire(identite.scope);
    const id = `${this.epoch}:${identite.scope}:${identite.revision}:${revision}`;
    const c = { identite, configuration, revision, id };
    this.verifier(c);
    if (attendu !== undefined && attendu !== id) throw invalide();
    return c;
  }

  private configuration(c: Contexte): ConfigurationComposio & { cle: string } {
    if (!c.configuration?.cle) throw new Error("Configure Composio dans les Réglages de ce profil avant d’utiliser ses services.");
    return c.configuration as ConfigurationComposio & { cle: string };
  }

  private serialiser<T>(operation: () => Promise<T>): Promise<T> {
    const prochaine = this.operations.then(operation, operation);
    this.operations = prochaine.catch(() => {});
    return prochaine;
  }

  private async garder(c: Contexte, configuration: ConfigurationComposio): Promise<void> {
    this.verifier(c);
    // Les anciens processus perdent leur capacité AVANT la première écriture.
    this.revision++;
    this.capacites.clear();
    this.schemas.clear();
    this.ecritureEnCours = true;
    try { await this.d.ecrire(c.identite.scope, configuration); }
    finally { this.revision++; this.ecritureEnCours = false; }
  }

  async etat(): Promise<EtatComposio> {
    const c = await this.contexte();
    const config = c.configuration;
    const base: EtatComposio = {
      contexte: c.id,
      profil: { nom: c.identite.nom, type: c.identite.type },
      configure: !!config?.cle,
      coffreDisponible: this.d.coffreDisponible(),
      services: [], comptes: [], selections: { ...config?.selections },
      enAttente: [], verifieLe: null, erreur: null,
    };
    if (!config?.cle) return base;
    const api = this.d.api(config.cle);
    let services, comptes;
    try {
      [services, comptes] = await Promise.all([api.listerServices(), api.listerComptes(config.userId)]);
    } catch (e) {
      this.verifier(c);
      // Garder seulement le contexte local permet de remplacer une clé refusée.
      // Aucune ancienne liste ni état connecté ne survit à un échec de la source.
      return { ...base, erreur: e instanceof ErreurComposio ? { code: e.code, message: e.message } : { code: "erreur", message: "Composio est indisponible. Actualise pour réessayer." } };
    }
    this.verifier(c);
    // Un bug de filtre côté fournisseur ne doit jamais montrer un compte d'un autre utilisateur.
    const propres = comptes.filter((compte) => compte.userId === config.userId);
    return {
      ...base, services,
      comptes: propres.map(({ id, service, nom, alias, statut, desactive }) => ({ id, service, nom, alias, statut, desactive })),
      enAttente: config.enAttente.filter((a) => !propres.some((p) => p.id === a.compteId && p.statut === "ACTIVE" && !p.desactive)),
      verifieLe: Date.now(),
    };
  }

  configurer(attendu: unknown, cle: string): Promise<void> {
    return this.serialiser(async () => {
      const c = await this.contexte(attendu);
      if (!this.d.coffreDisponible()) throw new Error("Le coffre du système est indisponible : la clé ne peut pas être protégée.");
      if (!/^[\x21-\x7e]{16,512}$/.test(cle)) throw new Error("Le fichier doit contenir uniquement une clé API de projet Composio.");
      // Vérification metadata seulement : aucun compte créé ni outil métier exécuté.
      await this.d.api(cle).listerServices();
      this.verifier(c);
      await this.garder(c, { userId: c.configuration?.userId ?? `klyra_${randomUUID()}`, cle, selections: {}, enAttente: [] });
    });
  }

  retirerConfiguration(attendu: unknown): Promise<void> {
    return this.serialiser(async () => {
      const c = await this.contexte(attendu);
      if (c.configuration) await this.garder(c, { ...c.configuration, cle: null, selections: {}, enAttente: [] });
    });
  }

  private appartient(compte: CompteComposio, config: ConfigurationComposio, service?: string) {
    if (compte.userId !== config.userId || (service !== undefined && compte.service !== service)) {
      throw new Error("Ce compte ne correspond pas au service et au profil sélectionnés.");
    }
  }

  private actif(compte: CompteComposio) {
    if (compte.statut !== "ACTIVE" || compte.desactive) {
      throw new Error("Ce compte est absent, désactivé ou à reconnecter. Choisis un compte actif dans Composio ; aucun autre compte ne sera utilisé.");
    }
  }

  selectionner(attendu: unknown, service: unknown, compteId: unknown): Promise<void> {
    return this.serialiser(async () => {
      const c = await this.contexte(attendu);
      const config = this.configuration(c);
      const slug = serviceValide(service);
      const selections = { ...config.selections };
      if (compteId === null) delete selections[slug];
      else {
        const compte = await this.d.api(config.cle).lireCompte(identifiant(compteId));
        this.appartient(compte, config, slug);
        this.actif(compte);
        selections[slug] = compte.id;
      }
      await this.garder(c, { ...config, selections });
    });
  }

  connecter(attendu: unknown, service: unknown, authConfigId: unknown): Promise<{ compteId: string; service: string; expireLe: string | null }> {
    return this.serialiser(async () => {
      const c = await this.contexte(attendu);
      const config = this.configuration(c);
      const slug = serviceValide(service);
      const id = identifiant(authConfigId);
      const api = this.d.api(config.cle);
      const services = await api.listerServices();
      if (!services.some((s) => s.slug === slug && s.configurations.some((a) => a.id === id && a.active))) {
        throw new Error("Cette configuration de service n’est plus disponible dans le projet Composio.");
      }
      this.verifier(c);
      const connexion = await api.connecter(config.userId, id);
      this.verifier(c);
      // Seul main reçoit le lien. Il n'est jamais conservé ni transmis au renderer ou à l'agent.
      const url = new URL(connexion.lien);
      if (url.protocol !== "https:" || !["connect.composio.dev", "app.composio.dev", "dashboard.composio.dev"].includes(url.hostname) || url.username || url.password || url.port) {
        throw new Error("Composio a renvoyé une adresse de connexion non reconnue. Aucun lien n’a été ouvert.");
      }
      await this.garder(c, {
        ...config,
        enAttente: [...config.enAttente.slice(-19), { compteId: connexion.compteId, service: slug, expireLe: connexion.expireLe }],
      });
      if (c.identite.revision !== this.d.revisionIdentite()) throw invalide();
      try { await this.d.ouvrir(connexion.lien); }
      catch { throw new Error("Le navigateur n’a pas pu être ouvert. Actualise l’état, puis relance la connexion si nécessaire."); }
      return { compteId: connexion.compteId, service: slug, expireLe: connexion.expireLe };
    });
  }

  deconnecter(attendu: unknown, compteId: unknown): Promise<void> {
    return this.serialiser(async () => {
      const c = await this.contexte(attendu);
      const config = this.configuration(c);
      const id = identifiant(compteId);
      const api = this.d.api(config.cle);
      const selections = Object.fromEntries(Object.entries(config.selections).filter(([, choisi]) => choisi !== id));
      // Le retrait local ne dépend pas du réseau. La suppression distante exige
      // toujours de relire l’appartenance du compte avant le DELETE.
      await this.garder(c, { ...config, selections, enAttente: config.enAttente.filter((a) => a.compteId !== id) });
      try {
        const compte = await api.lireCompte(id);
        this.appartient(compte, config);
        if (c.identite.revision !== this.d.revisionIdentite()) throw invalide();
        await api.deconnecter(id);
      } catch {
        throw new Error("Ce compte n’est plus choisi par les agents, mais sa déconnexion chez Composio n’a pas été confirmée. Actualise puis réessaie.");
      }
    });
  }

  /** Une capacité distincte par processus Claude ; aucun jeton fournisseur ne quitte main. */
  creerCapacite(): string {
    // Borner les capacités, sans laisser une capacité ancienne devenir valide à nouveau.
    if (this.capacites.size >= 256) this.capacites.delete(this.capacites.keys().next().value!);
    const jeton = randomBytes(24).toString("hex");
    this.capacites.set(jeton, { signature: this.signature(), contexte: null });
    return jeton;
  }

  private async depuisCapacite(jeton: string): Promise<Contexte> {
    const capacite = this.capacites.get(jeton);
    if (!capacite || capacite.signature !== this.signature()) throw invalide();
    const actuel = await this.contexte(capacite.contexte?.id);
    if (capacite.signature !== this.signature()) throw invalide();
    if (capacite.contexte && actuel.identite.scope !== capacite.contexte.identite.scope) throw invalide();
    capacite.contexte = actuel;
    this.configuration(actuel);
    return actuel;
  }

  outils(jeton: string): boolean {
    // La liste des schémas MCP reste stable pendant une panne réseau. Chaque appel
    // vérifie ensuite configuration, identité et compte ; exposé ne signifie pas connecté.
    const capacite = this.capacites.get(jeton);
    return !!capacite && capacite.signature === this.signature();
  }

  async comptesChoisis(jeton: string): Promise<unknown> {
    const c = await this.depuisCapacite(jeton);
    const etat = await this.etat();
    this.verifier(c);
    if (etat.erreur) throw new Error(etat.erreur.message);
    return Object.entries(etat.selections).map(([service, id]) => {
      const compte = etat.comptes.find((a) => a.id === id && a.service === service);
      return { service, compte: compte?.alias || compte?.nom || id, statut: compte?.statut ?? "ABSENT", utilisable: compte?.statut === "ACTIVE" && !compte.desactive };
    });
  }

  async rechercher(jeton: string, service: unknown, recherche: unknown): Promise<unknown> {
    const c = await this.depuisCapacite(jeton);
    const config = this.configuration(c);
    const slug = serviceValide(service);
    if (typeof recherche !== "string" || !recherche.trim() || recherche.length > 250) throw new Error("Décris brièvement l’outil recherché.");
    const id = config.selections[slug];
    if (!id) throw new Error("Aucun compte choisi pour ce service. Choisis-le dans Réglages › Composio.");
    const api = this.d.api(config.cle);
    const compte = await api.lireCompte(id);
    this.appartient(compte, config, slug);
    this.actif(compte);
    const outils = await api.chercherOutils(slug, recherche.trim());
    this.verifier(c);
    const acceptes = outils.filter((o) => o.service === slug && o.version && o.version !== "latest");
    for (const outil of outils) this.schemas.delete(`${jeton}:${outil.slug}`);
    for (const outil of acceptes) {
      this.schemas.set(`${jeton}:${outil.slug}`, outil);
    }
    return acceptes;
  }

  async executer(jeton: string, nom: unknown, argumentsOutil: unknown): Promise<unknown> {
    const c = await this.depuisCapacite(jeton);
    const config = this.configuration(c);
    const slug = identifiant(nom);
    const schema = this.schemas.get(`${jeton}:${slug}`);
    if (!schema) throw new Error("Recherche d’abord cet outil et son schéma dans la session actuelle.");
    if (!argumentsOutil || typeof argumentsOutil !== "object" || Array.isArray(argumentsOutil) || JSON.stringify(argumentsOutil).length > 128_000) {
      throw new Error("Les arguments de l’outil doivent être un objet JSON de taille limitée.");
    }
    const id = config.selections[schema.service];
    if (!id) throw new Error("Aucun compte choisi pour ce service. Aucun outil n’a été exécuté.");
    const api = this.d.api(config.cle);
    const compte = await api.lireCompte(id);
    this.appartient(compte, config, schema.service);
    this.actif(compte);
    this.verifier(c);
    const resultat = await api.executerOutil(slug, schema.version, id, config.userId, argumentsOutil as Record<string, unknown>);
    // Une action déjà envoyée ne peut être annulée : masquer son résultat à un autre profil.
    this.verifier(c);
    return resultat;
  }
}
