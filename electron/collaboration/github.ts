/**
 * Le peu de GitHub dont le circuit a besoin, avec un jeton d'App limité à un dépôt. Aucun état, aucun
 * journal : le jeton ne sort pas d'ici. `fetch` est injectable pour les tests.
 */
import type { Verifications } from "./automate.ts";
import { estCarte, lireCarte, motifRefus, ecrireCarte, type Carte } from "./carte.ts";

const API = "https://api.github.com";
const PAR_PAGE = 100;
const PAGES_MAX = 5;

/** Seuls ces auteurs comptent. Sur un dépôt public, n'importe qui peut écrire un commentaire. */
const ASSOCIATIONS_FIABLES = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const APPS_FIABLES = new Set(["klyra-agents[bot]", "klyra-reviewer[bot]"]);

export interface Auteur {
  login: string;
  association: string;
}

export function auteurFiable(a: Auteur): boolean {
  return APPS_FIABLES.has(a.login) || ASSOCIATIONS_FIABLES.has(a.association);
}

export class ErreurGithub extends Error {
  readonly statut: number;
  constructor(statut: number, operation: string) {
    super(`GitHub a répondu ${statut} (${operation})`);
    this.name = "ErreurGithub";
    this.statut = statut;
  }
}

export class TexteRefuse extends Error {
  readonly motif: string;
  constructor(motif: string) {
    super(`Texte refusé avant envoi sur GitHub : ${motif}`);
    this.name = "TexteRefuse";
    this.motif = motif;
  }
}

export interface IssueLue {
  numero: number;
  titre: string;
  corps: string;
  ouverte: boolean;
  labels: string[];
  auteur: Auteur;
}

export interface CommentaireLu {
  id: number;
  corps: string;
  auteur: Auteur;
}

export interface PullLue {
  numero: number;
  sha: string;
  fusionnee: boolean;
  fermee: boolean;
}

interface IssueBrute {
  number: number;
  title: string;
  body: string | null;
  state: string;
  labels: { name: string }[];
  user: { login: string } | null;
  author_association: string;
  pull_request?: unknown;
}

interface CommentaireBrut {
  id: number;
  body: string | null;
  user: { login: string } | null;
  author_association: string;
}

const issueLue = (i: IssueBrute): IssueLue => ({
  numero: i.number,
  titre: i.title,
  corps: i.body ?? "",
  ouverte: i.state === "open",
  labels: i.labels.map((l) => l.name),
  auteur: { login: i.user?.login ?? "", association: i.author_association },
});

/** Combine les deux API de GitHub : les check runs et les anciens statuts. */
export function verificationsDe(runs: { status: string; conclusion: string | null }[], statuts: { state: string }[]): Verifications {
  if (runs.length === 0 && statuts.length === 0) return "aucune";
  const echec = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"]);
  const rouge = runs.some((r) => r.conclusion !== null && echec.has(r.conclusion)) || statuts.some((s) => s.state === "failure" || s.state === "error");
  if (rouge) return "rouges";
  const enCours = runs.some((r) => r.status !== "completed") || statuts.some((s) => s.state === "pending");
  return enCours ? "en_cours" : "vertes";
}

export function creerClientGithub(depot: string, jeton: string, appeler: typeof fetch = fetch) {
  const url = (chemin: string) => `${API}/repos/${depot}${chemin}`;

  async function requete(operation: string, chemin: string, init: { method?: string; corps?: unknown } = {}): Promise<Response> {
    return await appeler(url(chemin), {
      method: init.method ?? "GET",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jeton}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "klyra-app",
        ...(init.corps === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: init.corps === undefined ? undefined : JSON.stringify(init.corps),
      signal: AbortSignal.timeout(20_000),
    }).then((r) => {
      if (!r.ok && r.status !== 422 && r.status !== 404) throw new ErreurGithub(r.status, operation);
      return r;
    });
  }

  async function json<T>(operation: string, chemin: string): Promise<T> {
    const r = await requete(operation, chemin);
    if (!r.ok) throw new ErreurGithub(r.status, operation);
    return (await r.json()) as T;
  }

  function verifierTexte(texte: string): void {
    const motif = motifRefus(texte);
    if (motif !== null) throw new TexteRefuse(motif);
  }

  async function commentaires(numero: number): Promise<CommentaireLu[]> {
    const tous: CommentaireLu[] = [];
    for (let page = 1; page <= PAGES_MAX; page++) {
      const lus = await json<CommentaireBrut[]>("commentaires", `/issues/${numero}/comments?per_page=${PAR_PAGE}&page=${page}`);
      tous.push(...lus.map((c) => ({ id: c.id, corps: c.body ?? "", auteur: { login: c.user?.login ?? "", association: c.author_association } })));
      if (lus.length < PAR_PAGE) break;
    }
    return tous;
  }

  /** La dernière carte écrite par un auteur fiable : celle d'un inconnu ne vaut jamais comme état. */
  async function lireCarteIssue(numero: number): Promise<{ id: number; carte: Carte } | null> {
    const fiables = (await commentaires(numero)).filter((c) => auteurFiable(c.auteur) && estCarte(c.corps));
    for (const c of fiables.reverse()) {
      const carte = lireCarte(c.corps);
      if (carte !== null) return { id: c.id, carte };
    }
    return null;
  }

  return {
    /** Les Issues prêtes pour un agent. L'API des Issues rend aussi les PR : elles sont écartées. */
    async issuesPretes(label: string): Promise<IssueLue[]> {
      const lues = await json<IssueBrute[]>("issues", `/issues?state=open&labels=${encodeURIComponent(label)}&per_page=${PAR_PAGE}`);
      return lues.filter((i) => i.pull_request === undefined).map(issueLue);
    },

    async issue(numero: number): Promise<IssueLue> {
      return issueLue(await json<IssueBrute>("issue", `/issues/${numero}`));
    },

    /** Seuls les commentaires d'auteurs fiables arrivent à un agent. */
    async commentairesFiables(numero: number): Promise<CommentaireLu[]> {
      return (await commentaires(numero)).filter((c) => auteurFiable(c.auteur) && !estCarte(c.corps));
    },

    lireCarte: lireCarteIssue,

    /** Réécrit la carte, jamais une seconde carte. Refuse un secret ou un chemin personnel. */
    async ecrireCarte(numero: number, carte: Carte): Promise<void> {
      const corps = ecrireCarte(carte);
      verifierTexte(corps);
      const existante = await lireCarteIssue(numero);
      const r = existante
        ? await requete("carte", `/issues/comments/${existante.id}`, { method: "PATCH", corps: { body: corps } })
        : await requete("carte", `/issues/${numero}/comments`, { method: "POST", corps: { body: corps } });
      if (!r.ok) throw new ErreurGithub(r.status, "carte");
    },

    async commenter(numero: number, corps: string): Promise<void> {
      verifierTexte(corps);
      const r = await requete("commentaire", `/issues/${numero}/comments`, { method: "POST", corps: { body: corps } });
      if (!r.ok) throw new ErreurGithub(r.status, "commentaire");
    },

    async poserLabels(numero: number, labels: string[]): Promise<void> {
      const r = await requete("labels", `/issues/${numero}/labels`, { method: "POST", corps: { labels } });
      if (!r.ok) throw new ErreurGithub(r.status, "labels");
    },

    /** Un label déjà absent n'est pas une erreur. */
    async retirerLabel(numero: number, label: string): Promise<void> {
      await requete("label", `/issues/${numero}/labels/${encodeURIComponent(label)}`, { method: "DELETE" });
    },

    /** Une App ne peut pas être assignée : c'est la personne responsable. Un refus n'empêche pas de travailler. */
    async assigner(numero: number, compte: string): Promise<boolean> {
      const r = await requete("assignation", `/issues/${numero}/assignees`, { method: "POST", corps: { assignees: [compte] } });
      return r.ok;
    },

    async shaBrancheParDefaut(): Promise<string> {
      const depotLu = await json<{ default_branch: string }>("depot", "");
      const ref = await json<{ object: { sha: string } }>("reference", `/git/ref/heads/${encodeURIComponent(depotLu.default_branch)}`);
      return ref.object.sha;
    },

    /**
     * Crée une branche. GitHub refuse une branche qui existe déjà, y compris sous concurrence (vérifié
     * le 04/11/2026, quatre créations simultanées, une seule acceptée) : c'est le verrou du circuit.
     */
    async creerBranche(nom: string, sha: string): Promise<boolean> {
      const r = await requete("branche", "/git/refs", { method: "POST", corps: { ref: `refs/heads/${nom}`, sha } });
      if (r.status === 422) return false;
      if (!r.ok) throw new ErreurGithub(r.status, "branche");
      return true;
    },

    async brancheExiste(nom: string): Promise<boolean> {
      const r = await requete("branche", `/git/ref/heads/${nom}`);
      return r.ok;
    },

    async supprimerBranche(nom: string): Promise<void> {
      await requete("branche", `/git/refs/heads/${nom}`, { method: "DELETE" });
    },

    /** La PR de cette branche, la plus récente, ouverte ou non. */
    async pullDeBranche(proprietaire: string, branche: string): Promise<PullLue | null> {
      const lues = await json<{ number: number; state: string; merged_at: string | null; head: { sha: string } }[]>(
        "pull",
        `/pulls?state=all&head=${encodeURIComponent(`${proprietaire}:${branche}`)}&per_page=5`,
      );
      const p = lues[0];
      if (p === undefined) return null;
      return { numero: p.number, sha: p.head.sha, fusionnee: p.merged_at !== null, fermee: p.state === "closed" && p.merged_at === null };
    },

    async fichiersDePull(numero: number): Promise<string[]> {
      const lus = await json<{ filename: string }[]>("fichiers", `/pulls/${numero}/files?per_page=${PAR_PAGE}`);
      return lus.map((f) => f.filename);
    },

    async verifications(sha: string): Promise<Verifications> {
      const runs = await json<{ check_runs: { status: string; conclusion: string | null }[] }>("verifications", `/commits/${sha}/check-runs?per_page=${PAR_PAGE}`);
      const statut = await json<{ statuses: { state: string }[] }>("statuts", `/commits/${sha}/status`);
      return verificationsDe(runs.check_runs, statut.statuses);
    },

    /** Le `CODEOWNERS` du dépôt, ou une chaîne vide. */
    async codeowners(): Promise<string> {
      for (const chemin of [".github/CODEOWNERS", "CODEOWNERS", "docs/CODEOWNERS"]) {
        const r = await requete("codeowners", `/contents/${chemin}`);
        if (r.ok) {
          const { content } = (await r.json()) as { content: string };
          return Buffer.from(content, "base64").toString("utf8");
        }
      }
      return "";
    },
  };
}

export type ClientGithub = ReturnType<typeof creerClientGithub>;
