import { relayerComposio, serveurRelaisComposio } from "./composio-relais";
import { app, net, safeStorage } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { enregistrerAppelIa } from "./consommation";
import { composioConnect, espaceComposio, OUTILS_COMPOSIO } from "./composio";
import { serveursMcpDirects } from "./mcp-direct";
import { OUTIL_FENETRE_NAVIGATEUR, ouvrirFenetreNavigateurDefaut } from "./ordinateur/fenetre-navigateur";
import { serveurOrdinateur } from "./ordinateur/pilote";
import { estOutilNavigateur, executerOutilNavigateur, navigateurActif, OUTILS_NAVIGATEUR, OUTILS_NAVIGATEUR_LECTURE } from "./navigateur/outils";
import { DOSSIER_ARTEFACTS_LUS, lireArtefact } from "./artefacts";
import { OUTIL_CHOIX, OUTIL_PROPOSER } from "./atelier-agent";
import { OUTIL_EQUIPE } from "./atelier-equipe";
import { appelCarte, OUTIL_CARTE } from "./cartes-interactives";
import { estOutilWorkflow, OUTILS_WORKFLOWS, OUTILS_WORKFLOWS_LIBRES } from "./workflows-outils";
import { estOutilFil, OUTILS_FILS } from "./fils-outils";
import { OUTILS_CERVEAU, executerCerveau } from "./cerveau-outils";
import { dossierGithubDeConversation, estOutilGithub, executerOutilGithub, OUTILS_GITHUB, OUTILS_GITHUB_LIBRES } from "./github-outils";
import { githubProjets } from "./github";

/**
 * Les autres IA (ChatGPT, Gemini, Mistral…), à côté de Claude : la personne les
 * ajoute dans les Réglages avec leur clé API, et ses agents peuvent les interroger
 * (outil `demander_ia`). Elles répondent, elles ne touchent pas aux fichiers.
 *
 * Toutes passent par le format « chat completions » d'OpenAI, que ces fournisseurs
 * acceptent. Les clés sont chiffrées par le trousseau du système (safeStorage) dans
 * userData/ia.json : jamais en clair sur le disque, jamais dans le code, et
 * envoyées seulement à l'IA concernée.
 *
 * Les agents (Claude Code) y accèdent par un petit serveur MCP local : sur
 * 127.0.0.1 seulement, avec un jeton tiré au hasard à chaque ouverture de l'app.
 */

import { estOutilCoffre, executerOutilCoffre, OUTILS_COFFRE, OUTILS_COFFRE_LIBRES } from "./coffre-outils";
export { FOURNISSEURS, type Fournisseur } from "./ia-catalogue";
import { FOURNISSEURS, type Fournisseur } from "./ia-catalogue";


interface IaStockee {
  id: string;
  nom: string;
  fournisseur: Fournisseur;
  url: string;
  modele: string;
  /** La clé, chiffrée par le trousseau, en base64. */
  cle: string;
}

/** Ce que l'interface voit d'une IA : tout, sauf la clé. */
export type Ia = Omit<IaStockee, "cle">;

const fichier = () => path.join(app.getPath("userData"), "ia.json");

async function lire(): Promise<IaStockee[]> {
  try {
    const v = JSON.parse(await readFile(fichier(), "utf8")) as unknown;
    return Array.isArray(v) ? (v as IaStockee[]) : [];
  } catch {
    return [];
  }
}

async function ecrire(liste: IaStockee[]) {
  const temporaire = `${fichier()}.tmp`;
  await writeFile(temporaire, JSON.stringify(liste), "utf8");
  await rename(temporaire, fichier());
}

const sansCle = (ia: IaStockee): Ia => ({ id: ia.id, nom: ia.nom, fournisseur: ia.fournisseur, url: ia.url, modele: ia.modele });

export async function listerIa(): Promise<Ia[]> {
  return (await lire()).map(sansCle);
}

/** L'adresse doit être en https (sauf un serveur local, comme Ollama). */
function verifierUrl(url: string): string {
  const u = new URL(url.trim());
  if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("L’adresse doit commencer par https://.");
  return u.toString().replace(/\/+$/, "");
}

export async function ajouterIa(entree: { nom: string; fournisseur: Fournisseur; url: string; modele: string; cle: string }): Promise<Ia[]> {
  if (!(entree.fournisseur in FOURNISSEURS)) throw new Error("Fournisseur inconnu.");
  const nom = String(entree.nom ?? "").trim().slice(0, 40);
  const modele = String(entree.modele ?? "").trim().slice(0, 120);
  const cle = String(entree.cle ?? "").trim();
  if (!nom || !modele || !cle) throw new Error("Il manque le nom, le modèle ou la clé.");
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : la clé ne peut pas être protégée.");
  const liste = await lire();
  if (liste.some((i) => i.nom.toLowerCase() === nom.toLowerCase())) throw new Error(`Une IA s’appelle déjà « ${nom} ».`);
  liste.push({
    id: randomUUID(),
    nom,
    fournisseur: entree.fournisseur,
    url: verifierUrl(entree.url || FOURNISSEURS[entree.fournisseur].url),
    modele,
    cle: safeStorage.encryptString(cle).toString("base64"),
  });
  await ecrire(liste);
  combien = liste.length;
  return liste.map(sansCle);
}

export async function retirerIa(id: string): Promise<Ia[]> {
  const liste = (await lire()).filter((i) => i.id !== id);
  await ecrire(liste);
  combien = liste.length;
  return liste.map(sansCle);
}

/** Pose une question à une IA ; rend sa réponse en texte. */
async function demander(ia: IaStockee, consigne: string, systeme?: string, agent: string | null = null): Promise<string> {
  const cle = safeStorage.decryptString(Buffer.from(ia.cle, "base64"));
  const reponse = await net.fetch(`${ia.url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${cle}` },
    body: JSON.stringify({
      model: ia.modele,
      messages: [...(systeme ? [{ role: "system", content: systeme }] : []), { role: "user", content: consigne }],
    }),
  });
  const corps = (await reponse.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[];
    error?: { message?: string } | string;
    usage?: unknown;
  } | null;
  if (!reponse.ok) {
    const erreur = typeof corps?.error === "string" ? corps.error : corps?.error?.message;
    throw new Error(`${ia.nom} a refusé la demande (${reponse.status})${erreur ? ` : ${erreur}` : ""}.`);
  }
  // Les jetons renvoyés par l'API, pour la consommation du Profil (pas de prix : chaque fournisseur a le sien).
  enregistrerAppelIa(FOURNISSEURS[ia.fournisseur]?.nom ?? ia.nom, ia.modele, agent, corps?.usage);
  const contenu = corps?.choices?.[0]?.message?.content;
  const texte = typeof contenu === "string" ? contenu : Array.isArray(contenu) ? contenu.map((c: { text?: string }) => c.text ?? "").join("") : "";
  if (!texte.trim()) throw new Error(`${ia.nom} n’a rien répondu.`);
  return texte.trim();
}

/** Un essai court : la clé, l'adresse et le modèle marchent-ils ? */
export async function testerIa(id: string): Promise<string> {
  const ia = (await lire()).find((i) => i.id === id);
  if (!ia) throw new Error("Cette IA n’existe plus.");
  return demander(ia, "Réponds seulement : ok");
}

/* ─── Serveur MCP local, pour les agents ──────────────────────── */

let serveur: { url: string; jeton: string } | null = null;
/** Le nombre d'IA ajoutées, tenu à jour : un agent se lance sans attendre le disque. */
let combien = 0;

/** Qui appelle un outil : l'agent et la conversation de ce Claude Code. */
export interface Appelant {
  chatId: string;
  roleId: string;
  routineRun?: string;
}

let outilsRoutines: {
  active: (appelant: Appelant) => boolean;
  signaler: (appelant: Appelant, outcome: "no-update" | "failed", reason?: string) => void;
} | null = null;
export function brancherOutilsRoutines(outils: typeof outilsRoutines) { outilsRoutines = outils; }
const OUTILS_ROUTINES = [
  { name: "routine_no_update", description: "Seulement dans cette exécution de routine : indique qu’il n’y a rien à signaler. L’historique conserve l’exécution. Ne l’utilise pas si tu as un résultat à transmettre.", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "routine_report_failure", description: "Seulement dans cette exécution de routine : signale que la tâche n’a pas pu être accomplie, avec un motif court. Termine ensuite ta réponse : l’historique marquera l’échec.", inputSchema: { type: "object", properties: { reason: { type: "string", minLength: 1, maxLength: 2000 } }, required: ["reason"], additionalProperties: false } },
];

/** Les outils des fils sont exécutés par l'interface (elle tient les conversations) ; main.ts branche ce relais. */
let relaisFils: ((nom: string, args: Record<string, unknown>, appelant: Appelant) => Promise<string>) | null = null;
export function brancherRelaisFils(relais: typeof relaisFils) {
  relaisFils = relais;
}

const OUTIL_DEMANDER = {
  name: "demander_ia",
  description:
    "Pose une question à une autre IA que Claude, ajoutée par la personne dans les Réglages de l'app KLYRA (ChatGPT, Gemini, Mistral…). Pour un deuxième avis, une autre plume, une comparaison. L'IA ne voit que la consigne : mets-y tout le contexte utile (texte, extrait de code). Elle répond en texte et ne touche à aucun fichier.",
};

/** Un agent montre ce qu'il a produit : le fichier rejoint l'écran Artefacts (cf. `src/lib/rendus.ts`). */
const OUTIL_PUBLIER = {
  name: "publier_artefact",
  description:
    "Publie dans l'écran Artefacts de la personne un fichier que tu as produit : tout fichier qu'on t'a demandé, quel que soit son format (texte, tableur, document, page HTML, maquette, capture d'écran, image, vidéo, PDF, présentation, petite app), et tout rendu qu'elle doit voir. L'app en garde une copie dans Mes artefacts de cet espace, sans la partager à l'équipe ; l'original reste où il est. Une page qui a des ressources (images, CSS, JS) se publie par son dossier, qui doit contenir index.html (300 Mo au plus, sans node_modules ni .git). Pas pour un fichier de travail intermédiaire ni pour du code source d'un projet. Republier le même fichier remplace sa copie.",
  inputSchema: {
    type: "object",
    properties: {
      chemin: { type: "string", description: "Le chemin complet du fichier (ou du dossier d'une page avec index.html), sur ce poste." },
      titre: { type: "string", description: "Un titre court (80 caractères au plus), ex. « Maquette de la page d'accueil »." },
      description: { type: "string", description: "À quoi il sert, en une phrase (500 caractères au plus)." },
    },
    required: ["chemin", "titre"],
  },
};

/** Lire un artefact claude.ai : l'outil Artifact de Claude Code n'existe pas dans l'app (cf. `lireArtefact`). */
const OUTIL_LIRE_ARTEFACT = {
  name: "lire_artefact",
  description:
    "Lit un artefact claude.ai de la personne (lien https://claude.ai/artifact/…, ceux de son fichier de planning ou qu'elle te donne) avec la connexion claude.ai de l'app, et enregistre son code HTML dans un fichier que tu lis ensuite avec Read. C'est la page telle qu'elle s'affiche (scripts exécutés). Lecture seule : rien n'est publié ni modifié sur claude.ai.",
  inputSchema: {
    type: "object",
    properties: { url: { type: "string", description: "Le lien de l'artefact, https://claude.ai/artifact/…" } },
    required: ["url"],
  },
};

function repondre(res: ServerResponse, statut: number, corps?: unknown) {
  res.writeHead(statut, corps === undefined ? {} : { "Content-Type": "application/json" });
  res.end(corps === undefined ? undefined : JSON.stringify(corps));
}

async function traiter(req: IncomingMessage, res: ServerResponse) {
  if (req.headers.authorization !== `Bearer ${serveur?.jeton}`) return repondre(res, 401);
  if (req.url === "/composio") return relayerComposio(req, res, () => composioConnect.preparerMcp(), (input, init) => net.fetch(input instanceof URL ? input.toString() : input as string, init));
  if (req.method !== "POST" || req.url !== "/mcp") return repondre(res, 405);
  const appelant: Appelant = {
    chatId: String(req.headers["x-klyra-chat"] ?? ""),
    roleId: String(req.headers["x-klyra-agent"] ?? "principal"),
    routineRun: typeof req.headers["x-klyra-routine"] === "string" ? req.headers["x-klyra-routine"] : undefined,
  };
  const composio = String(req.headers["x-klyra-composio"] ?? "");
  let brut = "";
  for await (const morceau of req) {
    brut += morceau;
    if (brut.length > 2 * 1024 * 1024) return repondre(res, 413);
  }
  let msg: { id?: string | number; method?: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(brut) as typeof msg;
  } catch {
    return repondre(res, 400);
  }
  // Une notification n'attend pas de réponse.
  if (msg.id === undefined) return repondre(res, 202);
  const resultat = (result: unknown) => repondre(res, 200, { jsonrpc: "2.0", id: msg.id, result });
  const texte = (t: string, isError = false) => resultat({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

  switch (msg.method) {
    case "initialize":
      return resultat({
        protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "klyra", version: app.getVersion() },
      });
    case "ping":
      return resultat({});
    case "tools/list": {
      const noms = (await lire()).map((i) => i.nom);
      const demander = noms.length
        ? [
            {
              ...OUTIL_DEMANDER,
              inputSchema: {
                type: "object",
                properties: {
                  ia: { type: "string", enum: noms, description: "Le nom de l'IA, tel qu'il est dans les Réglages." },
                  consigne: { type: "string", description: "La question, avec tout le contexte nécessaire." },
                },
                required: ["ia", "consigne"],
              },
            },
          ]
        : [];
      const outilsComposio = composio && await espaceComposio.outils(composio) ? OUTILS_COMPOSIO : [];
      /* GitHub : seulement dans une conversation d'un projet ouvert depuis GitHub sur ce PC. */
      const outilsGithub = dossierGithubDeConversation(app.getPath("userData"), appelant.chatId) ? OUTILS_GITHUB : [];
      return resultat({ tools: [...OUTILS_CERVEAU, ...demander, ...OUTILS_FILS, OUTIL_PUBLIER, OUTIL_LIRE_ARTEFACT, ...OUTILS_WORKFLOWS, ...(appelant.roleId === "principal" ? [OUTIL_PROPOSER, OUTIL_EQUIPE, OUTIL_CHOIX] : []), OUTIL_CARTE, ...outilsComposio, ...outilsGithub, ...(outilsRoutines?.active(appelant) ? OUTILS_ROUTINES : []), ...(navigateurActif() ? OUTILS_NAVIGATEUR : []), ...(serveurOrdinateur() ? [OUTIL_FENETRE_NAVIGATEUR] : []), ...OUTILS_COFFRE] });
    }
    case "tools/call": {
      const nom = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (OUTILS_CERVEAU.some((o) => o.name === nom)) return resultat(executerCerveau(app.getPath("userData"), nom, args, appelant.roleId, appelant.chatId));
      /* GitHub : le dépôt du projet de la conversation, en lecture, avec la connexion de l'app (jamais le jeton). */
      if (estOutilGithub(nom)) {
        const r = await executerOutilGithub(nom, args, dossierGithubDeConversation(app.getPath("userData"), appelant.chatId), githubProjets());
        return texte(r.texte, r.erreur);
      }
      /* Le navigateur de KLYRA : seulement les onglets de la conversation de l'agent (cf. navigateur/). */
      if (estOutilNavigateur(nom)) return resultat(await executerOutilNavigateur(nom, args, appelant));
      /* Le Coffre : jamais une valeur dans la réponse (cf. coffre-outils.ts). */
      if (estOutilCoffre(nom)) {
        const r = await executerOutilCoffre(nom, args, appelant);
        return texte(r.texte, r.erreur);
      }
      if (nom === OUTIL_FENETRE_NAVIGATEUR.name) {
        if (!serveurOrdinateur()) return texte("Computer Use n'est pas prêt : rien n'a été ouvert.", true);
        return texte(await ouvrirFenetreNavigateurDefaut(args.url, appelant.chatId));
      }
      if (OUTILS_COMPOSIO.some((o) => o.name === nom)) {
        try {
          const donnees = nom === "composio_etat" ? await espaceComposio.comptesChoisis(composio) : nom === "composio_rechercher"
            ? await espaceComposio.rechercher(composio, args.service, args.recherche)
            : await espaceComposio.executer(composio, args.outil, args.arguments);
          return texte(JSON.stringify(donnees), !!donnees && typeof donnees === "object" && "succes" in donnees && donnees.succes === false);
        } catch (e) {
          return texte(e instanceof Error ? e.message : "Composio est indisponible.", true);
        }
      }
      if (OUTILS_ROUTINES.some((o) => o.name === nom)) {
        if (!outilsRoutines?.active(appelant)) return texte("Cet outil exige une exécution de routine en cours dans cette conversation.", true);
        const failure = nom === "routine_report_failure";
        if (failure && (typeof args.reason !== "string" || !args.reason.trim() || args.reason.length > 2000)) return texte("Indique un motif de 1 à 2 000 caractères.", true);
        try {
          outilsRoutines.signaler(appelant, failure ? "failed" : "no-update", failure ? String(args.reason).trim() : undefined);
          return texte(failure ? "Échec enregistré pour cette exécution." : "Rien à signaler enregistré pour cette exécution.");
        } catch (e) { return texte(e instanceof Error ? e.message : String(e), true); }
      }
      if (nom === OUTIL_LIRE_ARTEFACT.name) {
        try {
          const { chemin, taille } = await lireArtefact(String(args.url ?? "").trim());
          return texte(`Code de l'artefact enregistré dans ${chemin} (${Math.ceil(taille / 1024)} Ko). Lis-le avec Read.`);
        } catch (e) {
          return texte(e instanceof Error ? e.message : String(e), true);
        }
      }
      if (nom === OUTIL_PROPOSER.name && appelant.roleId !== "principal") return texte("Seul l'assistant propose des agents.", true);
      /* Une carte interactive : l'écran la pose d'après l'appel ; l'outil ne fait que la vérifier (cf. cartes-interactives.ts). */
      if (nom === OUTIL_CARTE.name) {
        const r = appelCarte(args);
        return texte(r.texte, r.erreur);
      }
      if (nom === OUTIL_EQUIPE.name && appelant.roleId !== "principal") return texte("Seul l'assistant compose une équipe avec la personne.", true);
      if (nom === OUTIL_CHOIX.name && appelant.roleId !== "principal") return texte("Seul l'assistant propose des réponses toutes prêtes.", true);
      /* Les workflows vivent dans l'écran (page Workflows) : relayés comme les fils (cf. workflows-outils.ts). */
      if (estOutilFil(nom) || estOutilWorkflow(nom) || nom === OUTIL_PROPOSER.name || nom === OUTIL_EQUIPE.name || nom === OUTIL_CHOIX.name || nom === OUTIL_PUBLIER.name) {
        if (!relaisFils) return texte("L'app n'est pas prête, réessaie dans un instant.", true);
        try {
          return texte(await relaisFils(nom, args, appelant));
        } catch (e) {
          return texte(e instanceof Error ? e.message : String(e), true);
        }
      }
      if (nom !== OUTIL_DEMANDER.name) return texte("Outil inconnu.", true);
      const liste = await lire();
      const ia = liste.find((i) => i.nom.toLowerCase() === String(args.ia ?? "").toLowerCase());
      if (!ia) return texte(`Aucune IA « ${String(args.ia)} ». Disponibles : ${liste.map((i) => i.nom).join(", ") || "aucune"}.`, true);
      const consigne = String(args.consigne ?? "");
      if (!consigne.trim()) return texte("La consigne est vide.", true);
      try {
        return texte(`Réponse de ${ia.nom} (${ia.modele}) :\n\n${await demander(ia, consigne, undefined, appelant.roleId)}`);
      } catch (e) {
        return texte(e instanceof Error ? e.message : String(e), true);
      }
    }
    default:
      return repondre(res, 200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Méthode inconnue." } });
  }
}

/** Démarre le serveur MCP local (une fois, à l'ouverture de l'app). */
export async function demarrerServeurMcp(): Promise<void> {
  combien = (await lire()).length;
  // Le dossier où `lire_artefact` écrit : il existe avant le premier agent, qui reçoit son accès (`--add-dir`).
  await mkdir(DOSSIER_ARTEFACTS_LUS, { recursive: true }).catch(() => {});
  return new Promise((resolve) => {
    const jeton = randomBytes(24).toString("hex");
    const http = createServer((req, res) => void traiter(req, res).catch(() => repondre(res, 500)));
    http.listen(0, "127.0.0.1", () => {
      serveur = { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, jeton };
      resolve();
    });
  });
}

/** La configuration MCP d'un agent : qui il est et dans quelle conversation, pour les fils.
 *  S'y ajoutent les MCP directs branchés dans la Marketplace. */
export function configMcp(appelant: Appelant, composio: string | null = null): string | null {
  if (!serveur) return null;
  const connect = composioConnect.etat().connecte ? serveurRelaisComposio(serveur.url, serveur.jeton) : null;
  // Computer Use : seulement quand le pilote tourne avec ses autorisations (cf. ordinateur/pilote.ts).
  const ordinateur = serveurOrdinateur();
  return JSON.stringify({
    mcpServers: {
      ...serveursMcpDirects(),
      ...(connect ? { composio: connect } : {}),
      ...(ordinateur ? { ordinateur } : {}),
      klyra: {
        type: "http",
        url: serveur.url,
        headers: { Authorization: `Bearer ${serveur.jeton}`, "X-Klyra-Chat": appelant.chatId, "X-Klyra-Agent": appelant.roleId, ...(composio ? { "X-Klyra-Composio": composio } : {}), ...(appelant.routineRun ? { "X-Klyra-Routine": appelant.routineRun } : {}) },
      },
    },
  });
}

/** Les outils de l'app qu'un agent peut utiliser sans demander, en accès « projet ». */
export const OUTILS_APP = () => [
  ...OUTILS_CERVEAU.map((o) => `mcp__klyra__${o.name}`),
  ...(combien ? ["mcp__klyra__demander_ia"] : []),
  ...[...OUTILS_FILS, OUTIL_PROPOSER, OUTIL_EQUIPE, OUTIL_CHOIX, OUTIL_CARTE, OUTIL_PUBLIER, OUTIL_LIRE_ARTEFACT].map((o) => `mcp__klyra__${o.name}`),
  ...OUTILS_ROUTINES.map((o) => `mcp__klyra__${o.name}`),
  // Lire et construire un workflow ne lancent rien ; le lancer suit la règle de l'accès.
  ...OUTILS_WORKFLOWS_LIBRES.map((nom) => `mcp__klyra__${nom}`),
  // Le navigateur : lire est libre ; ouvrir une page ou y agir suit la règle de l'accès (comme Computer Use).
  ...(navigateurActif() ? OUTILS_NAVIGATEUR_LECTURE.map((o) => `mcp__klyra__${o}`) : []),
  // Le Coffre : lister, demander et ranger sans demander ; écrire un secret dans un fichier suit l'accès.
  ...OUTILS_COFFRE_LIBRES.map((o) => `mcp__klyra__${o}`),
  // GitHub : lire le dépôt du projet ne change rien.
  ...OUTILS_GITHUB_LIBRES.map((o) => `mcp__klyra__${o}`),
];
