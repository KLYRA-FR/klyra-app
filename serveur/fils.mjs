/**
 * Les fils pour les agents du VPS : une tâche = un fil, comme sur le PC (electron/fils-outils.ts, généré).
 *
 * - App ouverte sur le PC : l'appel lui part par le journal (événement `fil`, comme les workflows), l'écran
 *   l'exécute pour la conversation de l'agent et rend la réponse (`POST /klyra/v1/agent/fil`). Le fil s'ouvre
 *   alors dans l'app, sur ce serveur, et l'app rapporte sa réponse à l'agent qui l'a lancé.
 * - PC fermé : le serveur tient lui-même les fils de son espace (espace.mjs), avec les règles des tickets de
 *   l'app (tickets.mjs, généré). Il lance l'agent du fil, range sa réponse, met le ticket à jour et rapporte
 *   la réponse à l'agent qui l'a lancé, dans sa conversation. L'app retrouve tout à sa réouverture.
 * - Une réponse de fil qui finit PC fermé (même d'un fil ouvert par l'app) : c'est le serveur qui la rapporte,
 *   et il le note sur la fin dans le journal (`retourFil: "serveur"`) pour que l'app ne la rapporte pas une
 *   seconde fois en rejouant le journal.
 *
 * Limites : « arrêté » est gardé sur le fil (`suspendu`) ; un message qui attend un fil occupé, et le compte
 * des fils qui travaillent, sont en mémoire (perdus au redémarrage du serveur, comme une réponse en cours).
 */
import { randomUUID } from "node:crypto";
import { contexteFil, estOutilFil, OUTILS_FILS, PREFIXE_FIL, TEXTE_ATTENTE, texteFilOuvert, texteRetourFil, TRAVAUX_MAX } from "./fils-outils.mjs";
import { apresReponse, auDebut, ferme, ligneTicket, lireEcheance, lireEtatOutil, lirePriorite, peutFermer, peutMettreAJour, poserEtape, trierTickets } from "./tickets.mjs";

export { estOutilFil, OUTILS_FILS };

/** Ouvrir un fil sur le PC, c'est créer une conversation et envoyer le brief : quelques secondes. */
export const DELAI_FIL_MS = 45_000;
const REPONSE_MAX = 200_000;
const CONVERSATION = /^[A-Za-z0-9_.:@-]{1,120}$/;
const ID_AGENT = /^[a-z0-9][a-z0-9-]{0,63}$/;

const texte = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });

/** La réponse rendue par le PC, vérifiée : du texte seulement. */
export function resultatValide(brut) {
  const contenu = Array.isArray(brut?.content) ? brut.content : [];
  const propre = contenu.slice(0, 5).filter((c) => c?.type === "text" && typeof c.text === "string").map((c) => ({ type: "text", text: c.text }));
  if (!propre.length || propre.reduce((n, c) => n + c.text.length, 0) > REPONSE_MAX) return texte("Réponse illisible de l'ordinateur (fils).", true);
  return { content: propre, ...(brut?.isError === true ? { isError: true } : {}) };
}

/**
 * Le relais vers l'app du PC ; sans app qui écoute, les fils de ce serveur (`local`).
 * @param {{ publier: (requestId: string, event: object, sessionId: string | null) => void, ecouteurs: () => number,
 *   local?: () => ({ outilAgent: (appelant: object, nom: string, args: object) => object | Promise<object> } | null),
 *   delaiMs?: number, maintenant?: () => number }} options
 */
export function creerRelaisFils(options) {
  const delai = options.delaiMs ?? DELAI_FIL_MS;
  const maintenant = options.maintenant ?? Date.now;
  const attentes = new Map();

  function appeler(appelant, nom, args) {
    if (!estOutilFil(nom)) return Promise.resolve(texte("Outil inconnu.", true));
    if (!appelant?.conversation) return Promise.resolve(texte("Conversation inconnue : les fils ne s'ouvrent que depuis une conversation.", true));
    const entree = args && typeof args === "object" && !Array.isArray(args) ? args : {};
    if (!options.ecouteurs()) {
      const local = options.local?.();
      if (local) return Promise.resolve(local.outilAgent(appelant, nom, entree));
      return Promise.resolve(texte("Les fils de ce serveur ne sont pas joignables pour l'instant.", true));
    }
    const id = randomUUID();
    return new Promise((resoudre) => {
      const minuteur = setTimeout(() => {
        attentes.delete(id);
        resoudre(texte("L'ordinateur de la personne n'a pas répondu à temps (fils).", true));
      }, delai);
      attentes.set(id, (r) => {
        clearTimeout(minuteur);
        resoudre(r);
      });
      options.publier(id, { type: "fil", id, nom, arguments: entree, agent: appelant.agent ?? "principal", conversation: appelant.conversation, expire: maintenant() + delai }, null);
    });
  }

  /** La réponse du PC à un appel en attente ; faux si l'appel n'attend plus. */
  function repondre(id, resultat) {
    const fin = typeof id === "string" ? attentes.get(id) : undefined;
    if (!fin) return false;
    attentes.delete(id);
    fin(resultatValide(resultat));
    return true;
  }

  return { appeler, repondre, enAttente: () => attentes.size };
}

/**
 * Les fils tenus par ce serveur, PC fermé.
 * @param {{ espace: object, journal: object, envoyer: (requestId: string, demande: object) => void, annuler: (requestId: string) => boolean,
 *   equipe: () => ({ assistant: string | null, actifs: { id: string, nom: string }[] }), acces: () => string,
 *   cle: (conversation: string, agent: string) => string | null, maintenant?: () => Date, plusTard?: (fn: () => void) => void }} options
 */
export function creerFilsServeur(options) {
  const { espace, journal } = options;
  const maintenant = options.maintenant ?? (() => new Date());
  const plusTard = options.plusTard ?? ((fn) => setImmediate(fn));
  /** Fil → réponse en cours ; réponse → fil ; messages qui attendent leur tour. */
  const travail = new Map();
  const reponses = new Map();
  const enAttente = new Map();

  const conversations = () => espace.lireType("conversation").map((e) => e.valeur).filter((v) => typeof v?.chat?.id === "string");
  const conversation = (id) => conversations().find((v) => v.chat.id === id) ?? null;
  const fils = () => conversations().filter((v) => v.chat.fil);
  const projets = () => espace.lireType("projet").map((e) => e.valeur).filter((p) => typeof p?.id === "string");
  const ecrireConversation = (valeur) => espace.ecrire({ elements: [{ type: "conversation", id: valeur.chat.id, valeur }] });

  const nomDe = (id) => {
    const { assistant, actifs } = options.equipe();
    if (id === "principal") return assistant ?? "l'assistant";
    return actifs.find((a) => a.id === id)?.nom ?? id;
  };
  const agents = () => {
    const { assistant, actifs } = options.equipe();
    return [{ id: "principal", nom: assistant ?? "l'assistant" }, ...actifs];
  };

  function filDe(id) {
    const v = conversation(String(id ?? "").trim());
    if (!v?.chat?.fil) throw new Error(`Aucun fil « ${String(id)} ».`);
    return v;
  }

  const resume = (v) => {
    const fil = v.chat.fil;
    const projet = fil.projetId ? (projets().find((p) => p.id === fil.projetId)?.name ?? fil.projetId) : null;
    return ligneTicket(v.chat, { travaille: travail.has(v.chat.id), agent: nomDe(fil.roleId), projet, lancePar: fil.lancePar ? nomDe(fil.lancePar.roleId) : null });
  };

  /** Fait répondre l'agent du fil à un message (le brief, une précision) ; attend son tour s'il travaille. */
  function lancer(chatId, ligne) {
    if (travail.has(chatId)) {
      enAttente.set(chatId, [...(enAttente.get(chatId) ?? []), ligne]);
      return false;
    }
    const v = conversation(chatId);
    if (!v?.chat?.fil) return false;
    const fil = v.chat.fil;
    const roleId = fil.roleId;
    const requestId = randomUUID();
    const cle = options.cle(chatId, roleId);
    const sessionId = (cle && journal.sessionDe(cle)) || null;
    if (cle) journal.lierConversation(requestId, cle);
    const suite = auDebut(fil);
    journal.poserContexte(requestId, { chatId, agentId: roleId, titre: v.chat.title, fil: suite });
    ecrireConversation({ ...v, chat: { ...v.chat, fil: suite, updatedAt: maintenant().toISOString() } });
    travail.set(chatId, requestId);
    reponses.set(requestId, chatId);
    const projet = fil.projetId ? projets().find((p) => p.id === fil.projetId) : null;
    const lignes = [];
    if (!sessionId) {
      lignes.push("[Contexte] Tu échanges avec la personne dans l’app KLYRA : réponds en français, court et direct, en Markdown simple.");
      lignes.push(
        ...contexteFil({
          titre: v.chat.title,
          id: chatId,
          par: fil.lancePar ? nomDe(fil.lancePar.roleId) : "la personne",
          retour: !!fil.lancePar,
          projet: projet ? `${projet.name}${projet.subtitle ? ` (${projet.subtitle})` : ""}, dossier ${projet.folder}` : null,
          echeance: fil.echeance,
        }),
      );
    }
    lignes.push(ligne);
    options.envoyer(requestId, {
      agent: roleId === "principal" ? null : roleId,
      prompt: lignes.join("\n\n"),
      conversation: chatId,
      dossier: typeof projet?.folder === "string" && projet.folder ? projet.folder : null,
      sessionId,
      acces: options.acces(),
    });
    return true;
  }

  /** Rapporte la réponse d'un fil à l'agent qui l'a lancé : un message dans sa conversation, puis sa réponse. */
  function rapporter(v, ok, corps) {
    const { fil } = v.chat;
    const lanceur = fil.lancePar ? conversation(fil.lancePar.chatId) : null;
    if (!lanceur) return false;
    const date = maintenant().toISOString();
    const message = {
      id: randomUUID(),
      chatId: lanceur.chat.id,
      author: { kind: "role", roleId: fil.roleId },
      createdAt: date,
      parts: [{ type: "text", text: texteRetourFil({ titre: v.chat.title, id: v.chat.id, agent: nomDe(fil.roleId), ok, texte: corps }) }],
    };
    ecrireConversation({ chat: { ...lanceur.chat, updatedAt: date }, messages: [...(lanceur.messages ?? []), message] });
    const roleId = fil.lancePar.roleId;
    const requestId = randomUUID();
    const cle = options.cle(lanceur.chat.id, roleId);
    if (cle) journal.lierConversation(requestId, cle);
    journal.poserContexte(requestId, {
      chatId: lanceur.chat.id,
      agentId: roleId,
      titre: lanceur.chat.title,
      retour: { messageId: message.id, roleId: fil.roleId, texte: message.parts[0].text, creeLe: date },
    });
    options.envoyer(requestId, {
      agent: roleId === "principal" ? null : roleId,
      prompt: `[Retour du fil, de ${nomDe(fil.roleId)}]\n${message.parts[0].text}`,
      conversation: lanceur.chat.id,
      dossier: null,
      sessionId: (cle && journal.sessionDe(cle)) || null,
      acces: options.acces(),
    });
    return true;
  }

  /**
   * La fin d'une réponse. PC fermé, la réponse vient d'être rangée par le serveur (espace.noterReponse) :
   * le ticket passe « à valider » (ou bloqué), et la réponse revient à l'agent qui a lancé le fil.
   */
  function surFin({ requestId, event, cle }) {
    const propre = reponses.get(requestId) ?? null;
    if (propre) {
      reponses.delete(requestId);
      travail.delete(propre);
    }
    const chatId = propre ?? (typeof cle === "string" ? cle.split("|")[0] : null);
    if (!chatId || !chatId.startsWith(PREFIXE_FIL)) return;
    if (journal.ecouteurs() > 0) {
      // L'app suit la réponse : c'est elle qui tient le ticket et rapporte le retour.
      relancer(chatId);
      return;
    }
    plusTard(() => {
      try {
        const v = conversation(chatId);
        if (!v?.chat?.fil) return;
        const ok = event?.ok !== false;
        let fil = apresReponse(v.chat.fil, { ok, erreur: typeof event?.erreur === "string" ? event.erreur : undefined });
        const retour = !!v.chat.fil.retourAttendu && !!v.chat.fil.lancePar;
        if (retour) fil = { ...fil, retourAttendu: false };
        ecrireConversation({ ...v, chat: { ...v.chat, fil } });
        if (retour) {
          const corps = typeof event?.texte === "string" && event.texte ? event.texte : typeof event?.erreur === "string" ? event.erreur : "";
          if (rapporter({ ...v, chat: { ...v.chat, fil } }, ok, corps)) journal.annoterFin?.(requestId, { retourFil: "serveur" });
        }
      } catch {
        /* Le journal garde la réponse 24 h : l'app la rattrapera. */
      }
      relancer(chatId);
    });
  }
  journal.ecouterFin(surFin);

  /** Le message suivant qui attendait que le fil ait fini. */
  function relancer(chatId) {
    const file = enAttente.get(chatId);
    if (!file?.length) return;
    const [prochain, ...reste] = file;
    if (reste.length) enAttente.set(chatId, reste);
    else enAttente.delete(chatId);
    lancer(chatId, prochain);
  }

  function executer(nom, args, appelant) {
    const qui = typeof appelant.agent === "string" && ID_AGENT.test(appelant.agent) ? appelant.agent : "principal";
    switch (nom) {
      case "ouvrir_fil": {
        const agent = String(args.agent ?? "").trim();
        const titre = String(args.titre ?? "").trim().replace(/\s+/g, " ").slice(0, 80);
        const brief = String(args.brief ?? "").trim();
        if (!agents().some((a) => a.id === agent)) {
          throw new Error(`« ${agent} » n’est pas dans Mes agents : il ne peut pas recevoir de fil. Agents disponibles : ${agents().map((a) => `${a.id} (${a.nom})`).join(", ")}.`);
        }
        if (!brief) throw new Error("Le brief est vide : le fil ne voit pas ta conversation, il lui faut tout.");
        const projetId = typeof args.projet === "string" && args.projet.trim() ? args.projet.trim() : null;
        if (projetId && !projets().some((p) => p.id === projetId)) {
          throw new Error(`Aucun projet « ${projetId} ». Projets : ${projets().map((p) => `${p.id} (${p.name})`).join(", ") || "aucun"}.`);
        }
        if (travail.size >= TRAVAUX_MAX) throw new Error(TEXTE_ATTENTE);
        const lanceur = CONVERSATION.test(appelant.conversation ?? "") && conversation(appelant.conversation) ? { roleId: qui, chatId: appelant.conversation } : null;
        const date = maintenant().toISOString();
        const id = `${PREFIXE_FIL}${randomUUID().slice(0, 8)}`;
        const chat = {
          id,
          kind: "direct",
          projectId: null,
          title: titre || brief.replace(/\s+/g, " ").slice(0, 80),
          roleIds: [agent],
          updatedAt: date,
          sessions: {},
          luJusqua: null,
          fil: {
            roleId: agent,
            statut: "ouvert",
            creeLe: date,
            lancePar: lanceur,
            etape: "a-faire",
            priorite: lirePriorite(args.priorite) ?? 0,
            echeance: lireEcheance(args.echeance) ?? null,
            projetId,
            ...(lanceur ? { retourAttendu: true } : {}),
          },
        };
        ecrireConversation({ chat, messages: [{ id: randomUUID(), chatId: id, author: { kind: "user" }, createdAt: date, parts: [{ type: "text", text: brief }] }] });
        lancer(id, `[Brief de ${nomDe(qui)}]\n${brief}`);
        return texteFilOuvert(chat.title, id, nomDe(agent), !!lanceur);
      }
      case "lister_fils": {
        const agent = typeof args.agent === "string" && args.agent ? args.agent : null;
        const etatVoulu = args.etat === undefined || args.etat === null || args.etat === "" ? null : lireEtatOutil(args.etat);
        const ouverts = fils().filter((v) => v.chat.fil.statut === "ouvert" && (!agent || v.chat.fil.roleId === agent));
        const tries = trierTickets(ouverts.map((v) => v.chat), (id) => travail.has(id));
        const choisis = tries.filter((c) => !etatVoulu || (travail.has(c.id) ? "en-cours" : (c.fil.etape ?? "a-faire")) === etatVoulu);
        return choisis.length ? choisis.map((c) => `- ${resume(conversation(c.id))}`).join("\n") : "Aucun fil ouvert.";
      }
      case "lire_fil": {
        const v = filDe(args.id);
        const derniere = [...(v.messages ?? [])].reverse().find((m) => m.author?.kind === "role" && m.statut !== "en-cours");
        const corps = derniere ? (derniere.parts ?? []).filter((p) => p.type === "text").map((p) => p.text).join("\n\n") || derniere.erreur || "" : "";
        return `${resume(v)}\n\n${corps ? `Dernière réponse :\n${corps.slice(-8000)}` : "Pas encore de réponse."}`;
      }
      case "ecrire_dans_fil": {
        const v = filDe(args.id);
        const message = String(args.message ?? "").trim();
        if (!message) throw new Error("Le message est vide.");
        if (v.chat.fil.statut === "archive") throw new Error("Ce fil est fermé : demande à la personne de le rouvrir, ou ouvre-en un autre.");
        if (v.chat.fil.suspendu) throw new Error("Ce travail est suspendu ou clos : aucun nouveau départ.");
        const date = maintenant().toISOString();
        const retour = v.chat.fil.lancePar?.chatId === appelant.conversation;
        ecrireConversation({
          chat: { ...v.chat, updatedAt: date, fil: retour ? { ...v.chat.fil, retourAttendu: true } : v.chat.fil },
          messages: [...(v.messages ?? []), { id: randomUUID(), chatId: v.chat.id, author: { kind: "user" }, createdAt: date, parts: [{ type: "text", text: message }] }],
        });
        const occupe = travail.has(v.chat.id);
        lancer(v.chat.id, `[Message de ${nomDe(qui)}]\n${message}`);
        return occupe ? "Ajouté : il le lira après sa réponse en cours." : "Envoyé : il s’y met.";
      }
      case "mettre_a_jour_fil": {
        const v = filDe(args.id);
        if (v.chat.fil.statut === "archive") throw new Error("Ce fil est fermé : demande à la personne de le rouvrir.");
        if (!peutMettreAJour(v.chat.fil, qui)) throw new Error("Seuls l’agent du fil et celui qui l’a lancé mettent son état à jour.");
        const etape = lireEtatOutil(args.etat);
        const raison = typeof args.raison === "string" ? args.raison.trim() : "";
        if (etape === "bloque" && !raison) throw new Error("Dis pourquoi c’est bloqué (raison) : c’est ce que la personne lira.");
        const suite = { ...v, chat: { ...v.chat, updatedAt: maintenant().toISOString(), fil: poserEtape(v.chat.fil, etape, raison) } };
        ecrireConversation(suite);
        return `À jour : ${ligneTicket(suite.chat, { travaille: false, agent: nomDe(suite.chat.fil.roleId), lancePar: suite.chat.fil.lancePar ? nomDe(suite.chat.fil.lancePar.roleId) : null })}`;
      }
      case "arreter_fil": {
        const v = filDe(args.id);
        const requestId = travail.get(v.chat.id);
        if (requestId) options.annuler(requestId);
        enAttente.delete(v.chat.id);
        ecrireConversation({ ...v, chat: { ...v.chat, updatedAt: maintenant().toISOString(), fil: { ...v.chat.fil, suspendu: true } } });
        return "Arrêté. Le fil reste ouvert. Aucun nouveau départ tant qu’il n’est pas repris après contrôle.";
      }
      case "reprendre_fil": {
        const v = filDe(args.id);
        const controle = typeof args.controle === "string" ? args.controle.trim() : "";
        if (!controle) throw new Error("La reprise demande la référence du contrôle.");
        if (v.chat.fil.statut === "archive") throw new Error("Ce travail est terminé ou annulé : il ne reprend pas.");
        const { suspendu: _ancien, ...fil } = v.chat.fil;
        void _ancien;
        const suite = { ...v, chat: { ...v.chat, updatedAt: maintenant().toISOString(), fil } };
        ecrireConversation(suite);
        return `Repris : ${resume(suite)}`;
      }
      case "fermer_fil": {
        const v = filDe(args.id);
        if (!peutFermer(v.chat.fil, qui)) {
          const par = v.chat.fil.lancePar ? nomDe(v.chat.fil.lancePar.roleId) : "la personne";
          throw new Error(`Ce fil a été ouvert par ${par} : c’est à ${par} de le valider et de le fermer. Mets-le « à valider » avec mettre_a_jour_fil.`);
        }
        ecrireConversation({ ...v, chat: { ...v.chat, updatedAt: maintenant().toISOString(), fil: ferme(v.chat.fil, false, maintenant()) } });
        return `Fil fermé et archivé : ${v.chat.title} (${v.chat.id}). Il peut être rouvert.`;
      }
      default:
        throw new Error("Outil inconnu.");
    }
  }

  /** Un outil de fil appelé par un agent de ce serveur, PC fermé ; rend toujours un résultat MCP. */
  function outilAgent(appelant, nom, args) {
    if (!estOutilFil(nom)) return texte("Outil inconnu.", true);
    try {
      return texte(executer(nom, args && typeof args === "object" ? args : {}, appelant ?? {}));
    } catch (e) {
      return texte(e instanceof Error ? e.message : String(e), true);
    }
  }

  return { outilAgent, travaille: (id) => travail.has(id), enAttente: () => [...enAttente.values()].reduce((n, l) => n + l.length, 0) };
}
