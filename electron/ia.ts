import { app, net, safeStorage } from "electron";
import { randomBytes, randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, rename, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { enregistrerAppelIa } from "./consommation";

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

export const FOURNISSEURS = {
  openai: { nom: "ChatGPT", url: "https://api.openai.com/v1", modele: "gpt-5" },
  gemini: { nom: "Gemini", url: "https://generativelanguage.googleapis.com/v1beta/openai", modele: "gemini-2.5-pro" },
  mistral: { nom: "Mistral", url: "https://api.mistral.ai/v1", modele: "mistral-large-latest" },
  deepseek: { nom: "DeepSeek", url: "https://api.deepseek.com/v1", modele: "deepseek-chat" },
  xai: { nom: "Grok", url: "https://api.x.ai/v1", modele: "grok-4" },
  openrouter: { nom: "OpenRouter", url: "https://openrouter.ai/api/v1", modele: "openai/gpt-5" },
  autre: { nom: "Autre", url: "", modele: "" },
} as const;
export type Fournisseur = keyof typeof FOURNISSEURS;

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
}

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

const id = { type: "string", description: "L'identifiant du fil (klyra-fil-…)." };

/**
 * Les fils : une tâche = un fil, une conversation à part d'un agent qui tourne
 * sans bloquer son chat. On en ouvre un seulement pour un travail qui ne se
 * règle pas tout de suite.
 */
const OUTILS_FILS = [
  {
    name: "ouvrir_fil",
    description:
      "Confie une tâche à un agent de l'équipe (ou à toi-même) dans un nouveau fil : un onglet de son chat, qui travaille à part sans bloquer. Seulement pour un travail qui ne se règle pas tout de suite. Le fil ne voit pas cette conversation : le brief doit être complet (contexte, fichiers, attendu, critères de fin). Regarde d'abord avec lister_fils s'il n'en existe pas déjà un ouvert sur le même sujet. Quand l'agent a fini, sa réponse te revient automatiquement dans cette conversation.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "L'identifiant de l'agent qui fait la tâche (ex. dev, designer), ou principal." },
        titre: { type: "string", description: "Un titre court : « Rapport hebdo »." },
        brief: { type: "string", description: "La consigne complète." },
      },
      required: ["agent", "titre", "brief"],
    },
  },
  {
    name: "lister_fils",
    description: "Liste les fils ouverts (tâches en cours ou finies, pas encore fermées), avec leur agent, leur état et leur identifiant.",
    inputSchema: { type: "object", properties: { agent: { type: "string", description: "Facultatif : seulement les fils de cet agent." } } },
  },
  {
    name: "lire_fil",
    description: "Lit l'état d'un fil et sa dernière réponse (le résultat, quand il a fini).",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "ecrire_dans_fil",
    description: "Ajoute une précision ou une consigne dans un fil ; s'il travaille, elle attend son tour.",
    inputSchema: { type: "object", properties: { id, message: { type: "string" } }, required: ["id", "message"] },
  },
  {
    name: "arreter_fil",
    description: "Arrête le travail en cours d'un fil, sans le fermer.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
  {
    name: "fermer_fil",
    description: "Ferme un fil une fois le travail fait et vérifié : il est archivé (rien n'est effacé) et peut être rouvert. Vérifie d'abord que le travail est fini.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
];

/** L'assistant aide à créer un agent : il propose la fiche, la personne l'ajuste et l'enregistre (ou non). */
const OUTIL_PROPOSER = {
  name: "proposer_agent",
  description:
    "Propose à la personne une fiche d'agent à créer, d'après un besoin qu'elle a exprimé et qu'aucun de ses agents ne couvre. L'app lui montre la proposition : elle l'ouvre dans l'éditeur, l'ajuste et l'enregistre elle-même. Rien n'est créé par cet outil. Une seule proposition par besoin ; demande-lui d'abord ce qui manque si le besoin est flou.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string", description: "Identifiant proposé : minuscules, chiffres et tirets (ex. juriste)." },
      nom: { type: "string", description: "Le prénom de l'agent (ex. Nina)." },
      role: { type: "string", description: "Son rôle court (ex. Juridique)." },
      description: {
        type: "string",
        description: "Une phrase : « Rôle — ce qu'il couvre, séparé par des virgules. Appelle <prénom> dès qu'il faut… »",
      },
      consignes: { type: "string", description: "Le corps de la fiche en Markdown : présentation, « ## Comment je travaille », « ## Ce que je ne fais pas », « ## Critères de sortie »." },
    },
    required: ["id", "nom", "role", "description", "consignes"],
  },
};

function repondre(res: ServerResponse, statut: number, corps?: unknown) {
  res.writeHead(statut, corps === undefined ? {} : { "Content-Type": "application/json" });
  res.end(corps === undefined ? undefined : JSON.stringify(corps));
}

async function traiter(req: IncomingMessage, res: ServerResponse) {
  if (req.headers.authorization !== `Bearer ${serveur?.jeton}`) return repondre(res, 401);
  if (req.method !== "POST" || req.url !== "/mcp") return repondre(res, 405);
  const appelant: Appelant = {
    chatId: String(req.headers["x-klyra-chat"] ?? ""),
    roleId: String(req.headers["x-klyra-agent"] ?? "principal"),
  };
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
      return resultat({ tools: [...demander, ...OUTILS_FILS, ...(appelant.roleId === "principal" ? [OUTIL_PROPOSER] : [])] });
    }
    case "tools/call": {
      const nom = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      if (nom === OUTIL_PROPOSER.name && appelant.roleId !== "principal") return texte("Seul l'assistant propose des agents.", true);
      if (OUTILS_FILS.some((o) => o.name === nom) || nom === OUTIL_PROPOSER.name) {
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
  return new Promise((resolve) => {
    const jeton = randomBytes(24).toString("hex");
    const http = createServer((req, res) => void traiter(req, res).catch(() => repondre(res, 500)));
    http.listen(0, "127.0.0.1", () => {
      serveur = { url: `http://127.0.0.1:${(http.address() as AddressInfo).port}/mcp`, jeton };
      resolve();
    });
  });
}

/** La configuration MCP d'un agent : qui il est et dans quelle conversation, pour les fils. */
export function configMcp(appelant: Appelant): string | null {
  if (!serveur) return null;
  return JSON.stringify({
    mcpServers: {
      klyra: {
        type: "http",
        url: serveur.url,
        headers: { Authorization: `Bearer ${serveur.jeton}`, "X-Klyra-Chat": appelant.chatId, "X-Klyra-Agent": appelant.roleId },
      },
    },
  });
}

/** Les outils de l'app qu'un agent peut utiliser sans demander, en accès « projet ». */
export const OUTILS_APP = () => [
  ...(combien ? ["mcp__klyra__demander_ia"] : []),
  ...[...OUTILS_FILS, OUTIL_PROPOSER].map((o) => `mcp__klyra__${o.name}`),
];
