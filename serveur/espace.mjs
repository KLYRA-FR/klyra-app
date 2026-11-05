/**
 * L'espace d'un serveur : ses conversations et leurs messages (donc ses tickets), ses projets, ses
 * workflows et leurs exécutions, ses livrables. L'app les écrit ici à mesure, et les relit au démarrage :
 * ils ne dépendent plus d'un seul PC. Un élément par fichier, sous `donnees/espace/`, écrit d'un bloc.
 * Le PC en garde une copie : si ce serveur ne répond pas, rien n'est perdu.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { changerDeMoteur } from "./fournisseurs.mjs";

export const TYPES_ESPACE = ["conversation", "projet", "workflow", "execution", "rendu"];

export class ErreurEspace extends Error {}

/** @param {{ donnees: string, maintenant?: () => number }} options */
export function creerEspace({ donnees, maintenant = Date.now }) {
  const racine = path.join(donnees, "espace");
  const fichierEtat = path.join(racine, "etat.json");

  const typeValide = (type) => {
    if (!TYPES_ESPACE.includes(type)) throw new ErreurEspace("Type d’élément inconnu.");
    return type;
  };
  const idValide = (id) => {
    if (typeof id !== "string" || !id || id.length > 300) throw new ErreurEspace("Identifiant d’élément invalide.");
    return id;
  };
  const cheminDe = (type, id) => path.join(racine, typeValide(type), `${createHash("sha256").update(idValide(id)).digest("hex")}.json`);

  function ecrireFichier(fichier, contenu) {
    mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
    const tmp = `${fichier}.${process.pid}.tmp`;
    writeFileSync(tmp, contenu, { mode: 0o600 });
    renameSync(tmp, fichier);
  }

  function lireEtat() {
    try {
      const e = JSON.parse(readFileSync(fichierEtat, "utf8"));
      return { revision: Number(e.revision) || 0, supprimes: e.supprimes && typeof e.supprimes === "object" ? e.supprimes : {} };
    } catch {
      return { revision: 0, supprimes: {} };
    }
  }

  /** Les éléments d'un seul type : le moteur des workflows les relit souvent. */
  function lireType(type) {
    const dossier = path.join(racine, typeValide(type));
    if (!existsSync(dossier)) return [];
    const elements = [];
    for (const nom of readdirSync(dossier)) {
      if (!nom.endsWith(".json")) continue;
      try {
        const { id, valeur } = JSON.parse(readFileSync(path.join(dossier, nom), "utf8"));
        elements.push({ type, id, valeur });
      } catch {
        /* Un fichier illisible n'empêche pas de lire le reste. */
      }
    }
    return elements;
  }

  /** Tout l'espace, ou seulement son numéro s'il n'a pas changé depuis `depuis`. */
  function lire(depuis) {
    const { revision, supprimes } = lireEtat();
    if (typeof depuis === "number" && depuis === revision) return { revision, inchange: true };
    return { revision, elements: TYPES_ESPACE.flatMap(lireType), supprimes };
  }

  /** Ce que l'app a changé : des éléments à écrire, d'autres retirés. Un élément retiré le reste, même pour un autre appareil. */
  function ecrire({ elements = [], supprimes = [] } = {}) {
    if (!Array.isArray(elements) || !Array.isArray(supprimes)) throw new ErreurEspace("Demande illisible.");
    for (const e of elements) {
      if (!e || e.valeur === undefined) throw new ErreurEspace("Élément illisible.");
      cheminDe(e.type, e.id);
    }
    for (const s of supprimes) cheminDe(s?.type, s?.id);
    const etat = lireEtat();
    for (const { type, id, valeur } of elements) {
      ecrireFichier(cheminDe(type, id), JSON.stringify({ id, valeur }));
      if (etat.supprimes[type]?.[id]) delete etat.supprimes[type][id];
    }
    for (const { type, id } of supprimes) {
      rmSync(cheminDe(type, id), { force: true });
      (etat.supprimes[type] ??= {})[id] = maintenant();
    }
    etat.revision += 1;
    ecrireFichier(fichierEtat, JSON.stringify(etat));
    return { revision: etat.revision };
  }

  /** Choix explicite du téléphone : relire et modifier seulement ce fil, sans réécrire ses messages. */
  function choisirModele(chatId, roleId, titre, choix) {
    const valeur = lireType("conversation").find((e) => e.id === chatId)?.valeur;
    const chat = valeur?.chat ?? { id: chatId, kind: "direct", projectId: null, title: titre, roleIds: [roleId], sessions: {}, luJusqua: null };
    const suivant = { ...changerDeMoteur(chat, choix.fournisseur), modele: choix.modele, effort: choix.effort, updatedAt: new Date(maintenant()).toISOString() };
    ecrire({ elements: [{ type: "conversation", id: chatId, valeur: { chat: suivant, messages: valeur?.messages ?? [] } }] });
  }

  /**
   * Une réponse finie alors qu'aucune app n'écoutait (PC fermé) : le serveur la range lui-même dans sa
   * conversation. L'app la complétera en rejouant le journal si elle revient dans les 24 h.
   */
  function noterReponse({ requestId, event, sessionId, contexte, conversation, agent, moteur = "claude", ecritParServeur = true }) {
    const chatId = contexte?.chatId ?? conversation;
    if (typeof chatId !== "string" || !chatId || typeof requestId !== "string") return;
    const roleId = contexte?.agentId ?? agent ?? "principal";
    const date = new Date(maintenant()).toISOString();
    const fichier = cheminDe("conversation", chatId);
    let valeur = null;
    try {
      valeur = JSON.parse(readFileSync(fichier, "utf8")).valeur;
    } catch {
      /* Pas encore dans l'espace : elle y entre ici. */
    }
    const chat = valeur?.chat ?? {
      id: chatId,
      kind: chatId.startsWith("dm-") ? "direct" : "equipe",
      projectId: null,
      title: contexte?.titre ?? chatId,
      roleIds: [roleId],
      sessions: {},
      luJusqua: null,
    };
    const messages = [...(valeur?.messages ?? [])];
    const t = contexte?.telephone;
    if (t && !messages.some((m) => m.id === t.messageId)) {
      messages.push({ id: t.messageId, chatId, author: { kind: "user" }, createdAt: t.creeLe, parts: [{ type: "text", text: t.texte }] });
    }
    if (messages.some((m) => m.id === requestId)) return;
    const texte = typeof event?.texte === "string" ? event.texte : "";
    messages.push({
      id: requestId,
      chatId,
      author: { kind: "role", roleId },
      createdAt: date,
      parts: texte ? [{ type: "text", text: texte }] : [],
      statut: event?.ok === false ? "erreur" : "fait",
      ...(moteur !== "claude" ? { moteur } : {}),
      ...(event?.ok === false && typeof event.erreur === "string" ? { erreur: event.erreur } : {}),
      /* L'app sait qu'elle peut remplacer ce texte seul par la réponse complète, si le journal la rejoue. */
      ...(ecritParServeur ? { ecritParServeur: true } : {}),
    });
    const suite = { ...chat, updatedAt: date, sessions: { ...chat.sessions, ...(sessionId ? { [roleId]: sessionId } : {}) } };
    ecrire({ elements: [{ type: "conversation", id: chatId, valeur: { chat: suite, messages } }] });
  }

  function appeler(methode, corps = {}) {
    if (methode === "lire") return { ...lire(corps.depuis), choixModeleTelephone: true };
    if (methode === "ecrire") return ecrire(corps);
    throw new ErreurEspace("Ce serveur ne connaît pas cette demande.");
  }

  return { appeler, lire, lireType, ecrire, choisirModele, noterReponse };
}
