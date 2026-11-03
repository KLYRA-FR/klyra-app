import { net, shell } from "electron";
import { createServer } from "node:http";
import type { CompteMoteur, ModeleMoteur, Progression } from "./moteurs/types";

/**
 * Les fournisseurs d'un VPS relié (serveur/moteurs.mjs et serveur/ia.mjs), pour Réglages du serveur ›
 * Fournisseurs : mêmes réponses que les moteurs et les IA de ce PC, l'écran ne voit pas la différence.
 * L'installation et la connexion de Codex se font sur le VPS ; ici, on suit leur avancée (et on relaie
 * le retour de la page de connexion d'OpenAI).
 */

const ATTENTE_MS = 20_000;
/** Tester une IA attend sa réponse : plus long qu'un appel ordinaire. */
const ATTENTE_TEST_MS = 130_000;
const TRAVAIL_MAX_MS = 15 * 60_000;
const CONNEXION_MAX_MS = 15 * 60_000;
const VIEUX_SERVEUR = "Ce VPS ne connaît pas encore les fournisseurs : relance la commande d’installation sur le VPS pour le mettre à jour.";

type Json = Record<string, unknown>;

async function appel(origine: string, jeton: string | null, chemin: string, methode: "GET" | "POST" = "GET", corps?: unknown, delai = ATTENTE_MS): Promise<Json> {
  if (!jeton) throw new Error("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
  const controle = new AbortController();
  const minuterie = setTimeout(() => controle.abort(), delai);
  let reponse: Response;
  try {
    reponse = await net.fetch(`${origine}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, ...(corps === undefined ? {} : { "Content-Type": "application/json" }) },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
      signal: controle.signal,
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    throw new Error("Le VPS ne répond pas.");
  } finally {
    clearTimeout(minuterie);
  }
  const json = (await reponse.json().catch(() => null)) as Json | null;
  if (reponse.status === 401) throw new Error("Ce PC n’est plus relié à ce VPS.");
  if (reponse.status === 404) throw new Error(VIEUX_SERVEUR);
  if (!reponse.ok || !json) throw new Error(typeof json?.message === "string" ? json.message : "Le VPS n’a pas répondu comme prévu.");
  return json;
}

const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
const idValide = (id: string) => {
  if (!/^[a-z]{1,20}$/.test(id)) throw new Error(`Fournisseur inconnu : ${id}.`);
  return id;
};

/** Les moteurs du VPS, dans la forme de `moteurs:liste`. */
export async function moteursVps(origine: string, jeton: string | null) {
  const json = await appel(origine, jeton, "/klyra/v1/moteurs");
  if (!Array.isArray(json.moteurs)) throw new Error(VIEUX_SERVEUR);
  return (json.moteurs as Json[]).map((m) => ({
    id: String(m.id),
    nom: String(m.nom),
    fournisseur: String(m.fournisseur),
    chemin: typeof m.chemin === "string" ? m.chemin : null,
    gere: m.gere === true,
    installable: m.installable === true,
  }));
}

export async function compteVps(origine: string, jeton: string | null, id: string): Promise<CompteMoteur> {
  return (await appel(origine, jeton, `/klyra/v1/moteurs/${idValide(id)}/compte`)).compte as CompteMoteur;
}

export async function modelesVps(origine: string, jeton: string | null, id: string): Promise<ModeleMoteur[]> {
  return (await appel(origine, jeton, `/klyra/v1/moteurs/${idValide(id)}/modeles`)).modeles as ModeleMoteur[];
}

export async function versionDisponibleVps(origine: string, jeton: string | null, id: string): Promise<string | null> {
  const v = (await appel(origine, jeton, `/klyra/v1/moteurs/${idValide(id)}/version-disponible`)).version;
  return typeof v === "string" ? v : null;
}

/** Installe ou met à jour sur le VPS, et suit le travail jusqu'au bout (l'avancée passe par `progression`). */
export async function travailVps(origine: string, jeton: string | null, id: string, action: "installer" | "mettre-a-jour", progression: (p: Progression) => void): Promise<CompteMoteur> {
  await appel(origine, jeton, `/klyra/v1/moteurs/${idValide(id)}/${action}`, "POST", {});
  const debut = Date.now();
  while (Date.now() - debut < TRAVAIL_MAX_MS) {
    await attendre(1000);
    const moteur = ((await appel(origine, jeton, "/klyra/v1/moteurs")).moteurs as Json[]).find((m) => m.id === id);
    const travail = moteur?.travail as (Progression & { fini: boolean; erreur: string | null }) | null | undefined;
    if (!travail) break;
    if (travail.fini) {
      if (travail.erreur) throw new Error(travail.erreur);
      return compteVps(origine, jeton, id);
    }
    progression({ etape: travail.etape, recu: travail.recu, total: travail.total });
  }
  throw new Error("Le VPS n’a pas fini à temps : regarde Fournisseurs dans un moment.");
}

const PAGE_RETOUR = (ok: boolean) =>
  `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><title>KLYRA</title></head><body style="font-family:system-ui,sans-serif;max-width:420px;margin:15vh auto;padding:0 16px;color:#111">` +
  `<h1 style="font-size:20px">${ok ? "ChatGPT est relié à ton serveur" : "La connexion n’a pas abouti"}</h1>` +
  `<p>${ok ? "Tu peux fermer cette page et revenir dans KLYRA." : "Reviens dans KLYRA et relance « Se connecter »."}</p></body></html>`;

/**
 * Écoute, sur ce PC, l'adresse de retour de la page d'OpenAI (`http://127.0.0.1:1455/auth/callback`), le temps
 * de la connexion : le navigateur y revient après la connexion, et on transmet ce retour au VPS, où Codex
 * l'attend sur la même adresse. Rend null si le port est déjà pris (le Codex de ce PC se connecte, par exemple).
 */
function ecouterRetour(retour: string, relayer: (chemin: string) => Promise<boolean>): Promise<{ fermer: () => void } | null> {
  const adresse = new URL(retour);
  return new Promise((resolve) => {
    const serveur = createServer((req, res) => {
      const chemin = req.url ?? "/";
      if (req.method !== "GET" || !chemin.startsWith(`${adresse.pathname}?`)) {
        res.writeHead(404).end();
        return;
      }
      void relayer(chemin).then((ok) => {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(PAGE_RETOUR(ok));
        if (ok) serveur.close();
      });
    });
    serveur.once("error", () => resolve(null));
    serveur.listen(Number(adresse.port), "127.0.0.1", () => resolve({ fermer: () => serveur.close() }));
  });
}

/**
 * Connexion de Codex au compte ChatGPT sur le VPS, comme sur ce PC : la page d'OpenAI s'ouvre dans le
 * navigateur, et son retour est relayé au VPS (`ecouterRetour`). Si l'adresse de retour est déjà prise sur
 * ce PC, la connexion passe par un code d'appareil : le lien s'ouvre, l'écran montre le code (`montrerCode`).
 * Dans les deux cas, on relit le compte du VPS jusqu'à ce qu'il soit connecté.
 */
export async function connecterVps(origine: string, jeton: string | null, id: string, montrerCode: (c: { url: string; code: string }) => void): Promise<CompteMoteur> {
  idValide(id);
  let ecoute: { fermer: () => void } | null = null;
  try {
    const json = await appel(origine, jeton, `/klyra/v1/moteurs/${id}/connecter`, "POST", { mode: "navigateur" });
    const url = typeof json.url === "string" ? json.url : "";
    const retour = typeof json.retour === "string" ? json.retour : "";
    if (!/^https:\/\//.test(url) || !/^http:\/\/(127\.0\.0\.1|localhost):\d+\//.test(retour)) throw new Error("Le VPS n’a pas donné de page de connexion.");
    ecoute = await ecouterRetour(retour, async (chemin) => {
      try {
        const r = await appel(origine, jeton, `/klyra/v1/moteurs/${id}/retour`, "POST", { chemin });
        return typeof r.statut === "number" && r.statut < 400;
      } catch {
        return false;
      }
    });
    if (ecoute) await shell.openExternal(url);
    else {
      const code = await appel(origine, jeton, `/klyra/v1/moteurs/${id}/connecter`, "POST", { mode: "code" });
      if (typeof code.url !== "string" || !/^https:\/\//.test(code.url) || typeof code.code !== "string") throw new Error("Le VPS n’a pas donné de code de connexion.");
      montrerCode({ url: code.url, code: code.code });
      await shell.openExternal(code.url);
    }
    const debut = Date.now();
    while (Date.now() - debut < CONNEXION_MAX_MS) {
      await attendre(2000);
      const etat = await appel(origine, jeton, `/klyra/v1/moteurs/${id}/compte`);
      const compte = etat.compte as CompteMoteur;
      const connexion = etat.connexion as { fini: boolean; erreur: string | null } | null;
      if (compte?.connecte) return compte;
      if (connexion?.fini && connexion.erreur) throw new Error(connexion.erreur);
      if (!connexion) break;
    }
    return compteVps(origine, jeton, id);
  } finally {
    ecoute?.fermer();
  }
}

export async function connecterCleVps(origine: string, jeton: string | null, id: string, cle: string): Promise<CompteMoteur> {
  return (await appel(origine, jeton, `/klyra/v1/moteurs/${idValide(id)}/connecter-cle`, "POST", { cle })).compte as CompteMoteur;
}

export async function deconnecterVps(origine: string, jeton: string | null, id: string): Promise<CompteMoteur> {
  return (await appel(origine, jeton, `/klyra/v1/moteurs/${idValide(id)}/deconnecter`, "POST", {})).compte as CompteMoteur;
}

/* ─── IA à consulter ──────────────────────────────────────────── */

export async function catalogueIaVps(origine: string, jeton: string | null) {
  return (await appel(origine, jeton, "/klyra/v1/ia")).catalogue as Record<string, { nom: string; url: string; modele: string }>;
}

export async function listerIaVps(origine: string, jeton: string | null) {
  return (await appel(origine, jeton, "/klyra/v1/ia")).liste as unknown[];
}

export async function ajouterIaVps(origine: string, jeton: string | null, entree: unknown) {
  return (await appel(origine, jeton, "/klyra/v1/ia/ajouter", "POST", entree)).liste as unknown[];
}

export async function retirerIaVps(origine: string, jeton: string | null, id: string) {
  return (await appel(origine, jeton, "/klyra/v1/ia/retirer", "POST", { id })).liste as unknown[];
}

export async function testerIaVps(origine: string, jeton: string | null, id: string) {
  return String((await appel(origine, jeton, "/klyra/v1/ia/tester", "POST", { id }, ATTENTE_TEST_MS)).texte ?? "");
}
