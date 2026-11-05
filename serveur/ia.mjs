/**
 * Les IA à consulter sur le VPS (ChatGPT, Gemini, Mistral, DeepSeek, Grok…), comme dans l'app (electron/ia.ts) :
 * la personne les ajoute avec leur clé API depuis Réglages du serveur › Fournisseurs, et les agents du VPS
 * (Claude Code et Codex) les interrogent par l'outil `demander_ia` d'un petit serveur MCP local.
 *
 * Les clés sont dans `donnees/ia.json` (fichier 600 de l'utilisateur klyra, comme `claude-token`) : le VPS
 * n'a pas de trousseau. Elles ne reviennent jamais à l'app et ne partent qu'à l'IA concernée.
 * Le serveur MCP n'écoute que sur 127.0.0.1, avec un jeton tiré au hasard à chaque démarrage.
 * Il sert aussi les outils de l'app que le VPS sait rendre (`brancherOutils`, cf. agents.mjs : l'atelier
 * d'un agent), d'après qui appelle : l'agent et la conversation, posés dans les en-têtes de sa session.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { FOURNISSEURS } from "./ia-catalogue.mjs";
import { estOutilCoffre, OUTILS_COFFRE } from "./coffre-definitions.mjs";
import { estOutilNavigateur, OUTILS_NAVIGATEUR } from "./navigateur-definitions.mjs";
import { estOutilWorkflow, OUTILS_WORKFLOWS } from "./workflows-outils.mjs";

export { FOURNISSEURS };

/** Un agent montre ce qu'il a produit : le fichier rejoint l'écran Artefacts de l'app (cf. serveur/rendus.mjs). */
const OUTIL_PUBLIER = {
  name: "publier_artefact",
  description:
    "Publie dans l'écran Artefacts de la personne un fichier que tu as produit sur ce VPS : tout fichier qu'on t'a demandé, quel que soit son format (texte, tableur, document, page HTML, maquette, capture d'écran, image, vidéo, PDF, présentation, petite app), et tout rendu qu'elle doit voir. Le fichier reste sur ce VPS, dans Mes artefacts de ce serveur, sans être copié sur l'ordinateur ni partagé à l'équipe. Une page qui a des ressources (images, CSS, JS) se publie par son dossier, qui doit contenir index.html (300 Mo au plus, sans node_modules ni .git). Pas pour un fichier de travail intermédiaire ni pour du code source d'un projet. Republier le même fichier met à jour cette publication.",
  inputSchema: {
    type: "object",
    properties: {
      chemin: { type: "string", description: "Le chemin complet du fichier (ou du dossier d'une page avec index.html), sur ce VPS." },
      titre: { type: "string", description: "Un titre court (80 caractères au plus), ex. « Maquette de la page d'accueil »." },
      description: { type: "string", description: "À quoi il sert, en une phrase (500 caractères au plus)." },
    },
    required: ["chemin", "titre"],
  },
};

const OUTIL_DEMANDER = {
  name: "demander_ia",
  description:
    "Pose une question à une autre IA, ajoutée par la personne dans les Réglages du serveur KLYRA (ChatGPT, Gemini, Mistral, DeepSeek, Grok…). Pour un deuxième avis, une autre plume, une comparaison. L'IA ne voit que la consigne : mets-y tout le contexte utile (texte, extrait de code). Elle répond en texte et ne touche à aucun fichier.",
};

/** @param {{ donnees: string, version: string, fetch?: typeof fetch }} options */
export function creerIa(options) {
  const fichier = path.join(options.donnees, "ia.json");
  const appeler = options.fetch ?? fetch;
  let generation = 0;
  /** Qui reçoit les publications (serveur/rendus.mjs, branché par agents.mjs) ; sans lui, l'outil n'est pas proposé. */
  let publication = null;
  let navigateur = null;
  /** Le Coffre de KLYRA, sur le PC (cf. coffre.mjs) : `actif()`, `appeler(appelant, nom, arguments)`. */
  let coffre = null;
  let composio = null;
  /** Les workflows, sur le PC de la personne : `appeler(appelant, nom, arguments)` (cf. workflows.mjs). */
  let workflows = null;

  function lire() {
    try {
      const v = JSON.parse(readFileSync(fichier, "utf8"));
      return Array.isArray(v) ? v.filter((i) => i && typeof i.id === "string" && typeof i.cle === "string") : [];
    } catch {
      return [];
    }
  }

  function ecrire(liste) {
    mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
    const temporaire = `${fichier}.tmp`;
    writeFileSync(temporaire, JSON.stringify(liste), { mode: 0o600 });
    renameSync(temporaire, fichier);
    generation += 1;
  }

  const sansCle = (ia) => ({ id: ia.id, nom: ia.nom, fournisseur: ia.fournisseur, url: ia.url, modele: ia.modele });
  const lister = () => lire().map(sansCle);

  function verifierUrl(url) {
    const u = new URL(String(url).trim());
    if (u.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(u.hostname)) throw new Error("L’adresse doit commencer par https://.");
    return u.toString().replace(/\/+$/, "");
  }

  function ajouter(entree) {
    if (!entree || typeof entree !== "object" || !Object.hasOwn(FOURNISSEURS, entree.fournisseur)) throw new Error("Fournisseur inconnu.");
    const nom = String(entree.nom ?? "").trim().slice(0, 40);
    const modele = String(entree.modele ?? "").trim().slice(0, 120);
    const cle = String(entree.cle ?? "").trim();
    if (!nom || !modele || !cle) throw new Error("Il manque le nom, le modèle ou la clé.");
    if (cle.length > 400 || /\s/.test(cle)) throw new Error("Cette clé ne ressemble pas à une clé API.");
    const liste = lire();
    if (liste.length >= 50) throw new Error("Trop d’IA ajoutées sur ce serveur.");
    if (liste.some((i) => i.nom.toLowerCase() === nom.toLowerCase())) throw new Error(`Une IA s’appelle déjà « ${nom} ».`);
    liste.push({ id: randomUUID(), nom, fournisseur: entree.fournisseur, url: verifierUrl(entree.url || FOURNISSEURS[entree.fournisseur].url), modele, cle });
    ecrire(liste);
    return liste.map(sansCle);
  }

  function retirer(id) {
    const liste = lire().filter((i) => i.id !== id);
    ecrire(liste);
    return liste.map(sansCle);
  }

  /** Pose une question à une IA ; rend sa réponse en texte. */
  async function demander(ia, consigne) {
    const reponse = await appeler(`${ia.url}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${ia.cle}` },
      body: JSON.stringify({ model: ia.modele, messages: [{ role: "user", content: consigne }] }),
      signal: AbortSignal.timeout(120_000),
    });
    const corps = await reponse.json().catch(() => null);
    if (!reponse.ok) {
      const erreur = typeof corps?.error === "string" ? corps.error : corps?.error?.message;
      throw new Error(`${ia.nom} a refusé la demande (${reponse.status})${erreur ? ` : ${erreur}` : ""}.`);
    }
    const contenu = corps?.choices?.[0]?.message?.content;
    const texte = typeof contenu === "string" ? contenu : Array.isArray(contenu) ? contenu.map((c) => c?.text ?? "").join("") : "";
    if (!texte.trim()) throw new Error(`${ia.nom} n’a rien répondu.`);
    return texte.trim();
  }

  async function tester(id) {
    const ia = lire().find((i) => i.id === id);
    if (!ia) throw new Error("Cette IA n’existe plus.");
    return demander(ia, "Réponds seulement : ok");
  }

  /* ─── Serveur MCP local, pour les agents du VPS ──────────────────── */

  let serveur = null;
  let http = null;
  /** D'autres outils de l'app servis ici : `lister(appelant)`, `appeler(nom, args, appelant)` (null : pas le sien). */
  let outilsApp = null;
  const brancherOutils = (outils) => {
    outilsApp = outils;
  };
  const appelantDe = (req) => ({
    agent: typeof req.headers["x-klyra-agent"] === "string" ? req.headers["x-klyra-agent"] : "principal",
    conversation: typeof req.headers["x-klyra-conversation"] === "string" ? req.headers["x-klyra-conversation"] : "",
  });

  async function traiter(req, res) {
    const finir = (statut, corps) => {
      res.writeHead(statut, corps === undefined ? {} : { "Content-Type": "application/json" });
      res.end(corps === undefined ? undefined : JSON.stringify(corps));
    };
    if (req.headers.authorization !== `Bearer ${serveur?.jeton}`) return finir(401);
    if (req.method !== "POST" || req.url !== "/mcp") return finir(405);
    let brut = "";
    for await (const morceau of req) {
      brut += morceau;
      if (brut.length > 2 * 1024 * 1024) return finir(413);
    }
    let msg;
    try {
      msg = JSON.parse(brut);
    } catch {
      return finir(400);
    }
    if (msg.id === undefined) return finir(202);
    const appelant = appelantDe(req);
    const resultat = (result) => finir(200, { jsonrpc: "2.0", id: msg.id, result });
    const texte = (t, isError = false) => resultat({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
    switch (msg.method) {
      case "initialize":
        return resultat({
          protocolVersion: typeof msg.params?.protocolVersion === "string" ? msg.params.protocolVersion : "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "klyra", version: options.version },
        });
      case "ping":
        return resultat({});
      case "tools/list": {
        const noms = lire().map((i) => i.nom);
        const publier = publication ? [OUTIL_PUBLIER] : [];
        const outils = noms.length
          ? [
              {
                ...OUTIL_DEMANDER,
                inputSchema: {
                  type: "object",
                  properties: {
                    ia: { type: "string", enum: noms, description: "Le nom de l'IA, tel qu'il est dans les Réglages du serveur." },
                    consigne: { type: "string", description: "La question, avec tout le contexte nécessaire." },
                  },
                  required: ["ia", "consigne"],
                },
              },
            ]
          : [];
        return resultat({ tools: [...outils, ...publier, ...(outilsApp?.lister(appelant) ?? []), ...(navigateur?.actif() ? OUTILS_NAVIGATEUR : []), ...(workflows ? OUTILS_WORKFLOWS : []), ...(coffre?.actif() ? OUTILS_COFFRE : [])] });
      }
      case "tools/call": {
        const nom = String(msg.params?.name ?? "");
        /* Le navigateur de KLYRA : relayé au PC de la personne (cf. navigateur.mjs). */
        if (estOutilNavigateur(nom) && navigateur?.actif()) return resultat(await navigateur.appeler(appelant, nom, msg.params?.arguments ?? {}));
        /* Le Coffre de KLYRA : relayé au PC de la personne, jamais une valeur dans la réponse (cf. coffre.mjs). */
        if (estOutilCoffre(nom) && coffre?.actif()) return resultat(await coffre.appeler(appelant, nom, msg.params?.arguments ?? {}));
        /* Les workflows : relayés au PC de la personne, où ils vivent (cf. workflows.mjs). */
        if (estOutilWorkflow(nom) && workflows) return resultat(await workflows.appeler(appelant, nom, msg.params?.arguments ?? {}));
        if (nom === OUTIL_PUBLIER.name && publication) {
          /* L'agent et la conversation de la session, posés dans sa configuration MCP (cf. configMcp). */
          try {
            return texte(publication(appelant, msg.params?.arguments ?? {}));
          } catch (e) {
            return texte(e instanceof Error ? e.message : String(e), true);
          }
        }
        const args = msg.params?.arguments ?? {};
        const autre = nom === OUTIL_DEMANDER.name ? null : await outilsApp?.appeler(nom, args, appelant);
        if (autre) return texte(autre.texte, autre.erreur);
        if (nom !== OUTIL_DEMANDER.name) return texte("Outil inconnu.", true);
        const liste = lire();
        const ia = liste.find((i) => i.nom.toLowerCase() === String(args.ia ?? "").toLowerCase());
        if (!ia) return texte(`Aucune IA « ${String(args.ia)} ». Disponibles : ${liste.map((i) => i.nom).join(", ") || "aucune"}.`, true);
        const consigne = String(args.consigne ?? "");
        if (!consigne.trim()) return texte("La consigne est vide.", true);
        try {
          return texte(`Réponse de ${ia.nom} (${ia.modele}) :\n\n${await demander(ia, consigne)}`);
        } catch (e) {
          return texte(e instanceof Error ? e.message : String(e), true);
        }
      }
      default:
        return finir(200, { jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Méthode inconnue." } });
    }
  }

  /** Démarre le serveur MCP local (une fois, au lancement du serveur KLYRA). */
  function demarrer() {
    return new Promise((resolve) => {
      const jeton = randomBytes(24).toString("hex");
      http = createServer((req, res) => {
        traiter(req, res).catch(() => {
          if (!res.headersSent) res.writeHead(500);
          res.end();
        });
      });
      http.listen(0, "127.0.0.1", () => {
        serveur = { url: `http://127.0.0.1:${http.address().port}/mcp`, jeton };
        resolve();
      });
    });
  }

  /**
   * La configuration MCP d'une session (format `--mcp-config` de Claude Code) : l'agent et la conversation
   * en en-têtes, pour savoir qui publie et quel atelier suivre. Null sans outil à proposer (ni IA ajoutée,
   * ni publication, ni outil de l'app pour cet appelant).
   */
  function configMcp(appelant = {}) {
    if (!serveur) return null;
    const autres = typeof appelant.agent === "string" ? (outilsApp?.lister({ agent: appelant.agent, conversation: appelant.conversation ?? "" }).length ?? 0) : 0;
    if (!lire().length && !publication && !autres && !navigateur?.actif() && !workflows && !coffre?.actif()) return null;
    const qui = {
      ...(typeof appelant.agent === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(appelant.agent) ? { "X-Klyra-Agent": appelant.agent } : {}),
      ...(typeof appelant.conversation === "string" && /^[A-Za-z0-9_.:@-]{1,120}$/.test(appelant.conversation) ? { "X-Klyra-Conversation": appelant.conversation } : {}),
    };
    return JSON.stringify({ mcpServers: { ...(composio?.() ? { composio: composio() } : {}), klyra: { type: "http", url: serveur.url, headers: { Authorization: `Bearer ${serveur.jeton}`, ...qui } } } });
  }

  return {
    catalogue: () => FOURNISSEURS,
    lister,
    ajouter,
    retirer,
    tester,
    demarrer,
    configMcp,
    brancherOutils,
    /** Branche l'outil `publier_artefact` : `fn(appelant, arguments)` rend le texte pour l'agent, ou lève. */
    surPublication: (fn) => {
      publication = fn;
    },
    /** Branche les outils du navigateur de KLYRA : `actif()` (le PC les donne), `appeler(appelant, nom, arguments)`. */
    surNavigateur: (relais) => {
      navigateur = relais;
    },
    /** Branche les outils du Coffre de KLYRA : `actif()` (le PC le sert), `appeler(appelant, nom, arguments)`. */
    surCoffre: (relais) => {
      coffre = relais;
    },
    /** Branche le serveur MCP de Composio de ce serveur, s'il est connecté. */
    surComposio: (fn) => {
      composio = fn;
    },
    /** Branche les outils des workflows : `appeler(appelant, nom, arguments)`, relayé au PC. */
    surWorkflows: (relais) => {
      workflows = relais;
    },
    /** Change à chaque ajout ou retrait : un agent ouvert est relancé avec la liste à jour. */
    generation: () => generation,
    fermer: () => http?.close(),
  };
}
