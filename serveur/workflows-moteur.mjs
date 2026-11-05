/**
 * Les workflows d'un serveur tournent ici, PC éteint : le même moteur que l'app (`workflows-moteur-coeur.mjs`,
 * généré), avec les outils de ce serveur. Les définitions sont dans son espace (espace.mjs), envoyées par l'app.
 *
 * - Une étape agent lance l'agent du serveur dans la conversation du workflow ; le journal la montre à l'app si elle
 *   écoute, et le serveur range sa réponse sinon.
 * - Une exécution est écrite à chaque changement, et annoncée (`execution`) : l'app la suit en direct.
 * - Une exécution en cours au redémarrage du serveur est marquée arrêtée, jamais relancée.
 * - Un déclencheur planifié part toutes les 30 s au plus ; son prochain passage reste dans `donnees/workflows-prochaines.json`.
 * - Une approbation attend la décision de l'app : elle survit à la fermeture du PC, pas à un redémarrage du serveur.
 */
import { randomUUID } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { prochainPassage } from "./planning-passages.mjs";
import { executer } from "./workflows-moteur-coeur.mjs";

const TICK_MS = 30_000;
/** Comme dans l'app : les exécutions gardées par workflow. */
const EXECUTIONS_GARDEES = 30;

/**
 * @param {{ donnees: string, espace: object, journal: object, envoyer: (requestId: string, demande: object) => void,
 *   annuler: (requestId: string) => boolean, appelLibre: (o: object) => Promise<object>, ecrireFichier: (chemin: string, texte: string) => Promise<string>,
 *   cle: (conversation: string, agent: string) => string | null, acces: () => string,
 *   maintenant?: () => Date, setTimer?: typeof setInterval, clearTimer?: typeof clearInterval }} options
 */
export function creerMoteurWorkflows(options) {
  const { espace, journal } = options;
  const maintenant = options.maintenant ?? (() => new Date());
  const fichierProchaines = path.join(options.donnees, "workflows-prochaines.json");
  /** L'exécution en cours : son signal d'arrêt, ses réponses d'agent et ses approbations. */
  const enCours = new Map();
  const reponses = new Map();
  const approbations = new Map();
  let minuteur = null;

  journal.ecouterFin(({ requestId, event }) => {
    const finir = reponses.get(requestId);
    if (!finir) return;
    reponses.delete(requestId);
    finir(event?.ok === false ? { ok: false, erreur: event.erreur || "L’agent n’a pas pu répondre." } : { ok: true, texte: typeof event?.texte === "string" ? event.texte : "" });
  });

  const elements = (type) => espace.lireType(type);
  const workflows = () => elements("workflow").map((e) => e.valeur);
  const executionsDe = (id) => elements("execution").map((e) => e.valeur).filter((x) => x?.workflowId === id);
  const annoncer = (event) => journal.publier("workflows", event, null);

  function enregistrer(execution) {
    espace.ecrire({ elements: [{ type: "execution", id: execution.id, valeur: execution }] });
    annoncer({ type: "execution", execution });
  }

  function lireProchaines() {
    try {
      const v = JSON.parse(readFileSync(fichierProchaines, "utf8"));
      return v && typeof v === "object" ? v : {};
    } catch {
      return {};
    }
  }
  function ecrireProchaines(v) {
    const tmp = `${fichierProchaines}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(v), { mode: 0o600 });
    renameSync(tmp, fichierProchaines);
  }

  /** Ce que le moteur demande : tout se passe sur ce serveur. */
  function outilsPour(wf, acces) {
    const chatId = `wf-${wf.id}`;
    const dossierDuProjet = () => {
      if (!wf.projectId) return null;
      return elements("projet").find((e) => e.id === wf.projectId)?.valeur?.folder ?? null;
    };
    return {
      agent: ({ roleId, consigne, fichiers, signal }) =>
        new Promise((resoudre) => {
          const requestId = randomUUID();
          const agent = roleId === "principal" ? null : roleId;
          const cle = options.cle(chatId, roleId);
          if (cle) journal.lierConversation(requestId, cle);
          journal.poserContexte(requestId, { chatId, agentId: roleId, titre: `Workflow · ${wf.titre}` });
          reponses.set(requestId, resoudre);
          const execution = [...enCours.values()].find((x) => x.workflowId === wf.id);
          execution?.requetes.add(requestId);
          signal.addEventListener("abort", () => {
            options.annuler(requestId);
            if (reponses.delete(requestId)) resoudre({ ok: false, erreur: "Arrêté." });
          });
          options.envoyer(requestId, {
            agent,
            prompt: `Workflow « ${wf.titre} »\n\n${consigne}`,
            conversation: chatId,
            dossier: dossierDuProjet(),
            sessionId: (cle && journal.sessionDe(cle)) || null,
            acces,
            ...(fichiers?.length ? { fichiers } : {}),
          });
        }),
      llm: (o) => options.appelLibre(o),
      notifier: (titre, texte) => annoncer({ type: "workflow-notification", titre, texte, workflowId: wf.id }),
      conversation: (titre, texte) => {
        espace.noterReponse({ requestId: randomUUID(), event: { ok: true, texte: texte || "(vide)" }, sessionId: null, contexte: { chatId: `wf-sortie-${wf.id}`, agentId: "principal", titre }, ecritParServeur: false });
        annoncer({ type: "espace" });
        return { ok: true, texte: `Publié dans la conversation « ${titre} ».` };
      },
      ecrireFichier: async (chemin, texte) => {
        try {
          return { ok: true, texte: `Écrit dans ${await options.ecrireFichier(chemin, texte)}.` };
        } catch (e) {
          return { ok: false, erreur: e instanceof Error ? e.message : String(e) };
        }
      },
      approbation: (etapeId, signal) =>
        new Promise((resoudre) => {
          approbations.set(etapeId, resoudre);
          signal.addEventListener("abort", () => {
            approbations.delete(etapeId);
            resoudre(false);
          });
          annoncer({ type: "workflow-notification", titre: `${wf.titre} attend ton accord`, texte: "Ouvre le workflow pour approuver ou refuser.", workflowId: wf.id });
        }),
    };
  }

  /** Lance un workflow. `id` : celui choisi par l'app, qui montre déjà l'exécution ; rend l'id, ou null s'il n'existe pas. */
  function lancer(workflowId, o = {}) {
    const wf = workflows().find((w) => w?.id === workflowId);
    if (!wf) return null;
    const precedentes = executionsDe(workflowId);
    const sortiesConnues = {};
    for (const e of [...precedentes].sort((a, b) => a.numero - b.numero)) {
      for (const x of e.etapes ?? []) if (x.statut === "fait") sortiesConnues[x.noeudId] = { texte: x.sortie ?? "", fichiers: x.fichiers };
    }
    const execution = {
      id: typeof o.id === "string" && o.id ? o.id : randomUUID(),
      workflowId,
      numero: Math.max(0, ...precedentes.map((e) => e.numero ?? 0)) + 1,
      declencheurId: o.declencheurId ?? null,
      ...(o.seule ? { seule: o.seule } : {}),
      source: o.source ?? "manuel",
      statut: "en-cours",
      erreur: null,
      debut: maintenant().toISOString(),
      fin: null,
      etapes: [],
      chatId: `wf-${workflowId}`,
      ...(o.lancePar ? { lancePar: o.lancePar } : {}),
    };
    const ctrl = new AbortController();
    const suivi = { workflowId, ctrl, requetes: new Set() };
    enCours.set(execution.id, suivi);
    enregistrer(execution);
    const acces = ["demander", "projet", "tout"].includes(o.acces) ? o.acces : options.acces();
    const fini = executer(execution, { wf, outils: outilsPour(wf, acces), maj: enregistrer, signal: ctrl.signal, charge: o.charge, sortiesConnues })
      .catch((e) => enregistrer({ ...execution, statut: "erreur", erreur: e instanceof Error ? e.message : String(e), fin: maintenant().toISOString() }))
      .finally(() => {
        enCours.delete(execution.id);
        nettoyer(workflowId);
      });
    suivi.fini = fini;
    return execution.id;
  }

  /** Les plus anciennes exécutions d'un workflow partent, comme dans l'app. */
  function nettoyer(workflowId) {
    const trop = executionsDe(workflowId).sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0)).slice(EXECUTIONS_GARDEES);
    if (trop.length) espace.ecrire({ supprimes: trop.map((e) => ({ type: "execution", id: e.id })) });
  }

  function arreter(id) {
    const suivi = enCours.get(id);
    if (!suivi) return false;
    suivi.ctrl.abort();
    return true;
  }

  function decider(etapeId, approuver) {
    const finir = approbations.get(etapeId);
    if (!finir) return false;
    approbations.delete(etapeId);
    finir(approuver === true);
    return true;
  }

  /** Un appel sur l'adresse d'un déclencheur : son workflow part. Faux si ce secret n'ouvre rien. */
  function webhook(secret, charge) {
    for (const wf of workflows()) {
      for (const [noeudId, s] of Object.entries(wf?.webhooks ?? {})) {
        if (s === secret) {
          lancer(wf.id, { declencheurId: noeudId, source: "webhook", charge });
          return true;
        }
      }
    }
    return false;
  }

  /** Les déclencheurs planifiés dont l'heure est passée partent. Un nouveau prend son prochain passage sans partir. */
  function tick() {
    const date = maintenant();
    const prochaines = lireProchaines();
    let change = false;
    for (const wf of workflows()) {
      for (const n of wf?.graphe?.noeuds ?? []) {
        if (n.type !== "declencheur" || n.champs?.declencheur !== "planifie" || !n.frequence) continue;
        const cle = `${wf.id}:${n.id}`;
        const due = prochaines[cle];
        if (due && new Date(due) > date) continue;
        prochaines[cle] = prochainPassage(n.frequence, date).toISOString();
        change = true;
        if (due) lancer(wf.id, { declencheurId: n.id, source: "planifie" });
      }
    }
    if (change) ecrireProchaines(prochaines);
  }

  /** Une exécution qui n'a pas survécu au redémarrage du serveur : arrêtée, et dite telle. */
  function reprendre() {
    for (const { valeur: e } of elements("execution")) {
      if (e?.statut !== "en-cours" && e?.statut !== "approbation") continue;
      const fin = maintenant().toISOString();
      espace.ecrire({
        elements: [{
          type: "execution",
          id: e.id,
          valeur: {
            ...e,
            statut: "arrete",
            erreur: "Le serveur a redémarré pendant cette exécution.",
            fin,
            etapes: (e.etapes ?? []).map((s) => (s.statut === "en-cours" || s.statut === "approbation" ? { ...s, statut: "arrete", fin } : s)),
          },
        }],
      });
    }
  }

  function demarrer() {
    reprendre();
    tick();
    const poser = options.setTimer ?? setInterval;
    minuteur = poser(tick, TICK_MS);
    minuteur?.unref?.();
  }
  function arreterTout() {
    (options.clearTimer ?? clearInterval)(minuteur);
    for (const { ctrl } of enCours.values()) ctrl.abort();
  }

  /**
   * Les outils des workflows pour un agent de ce serveur, quand aucune app n'est ouverte. La construction se fait
   * sous les yeux de la personne : elle attend l'app.
   */
  function outilAgent(appelant, nom, args) {
    const texte = (t, isError = false) => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
    const tous = workflows().filter(Boolean);
    const trouver = (id) => tous.find((w) => w.id === String(id ?? "").trim());
    const ligne = (w) => {
      const dernier = executionsDe(w.id).sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0))[0];
      const etapes = (w.graphe?.noeuds ?? []).filter((n) => !["note", "texte", "forme"].includes(n.type)).length;
      return `- ${w.titre} (${w.id}) · ${etapes} étape${etapes > 1 ? "s" : ""}${dernier ? ` · dernière exécution n°${dernier.numero} : ${dernier.statut}` : ""}`;
    };
    switch (nom) {
      case "lister_workflows":
        return texte(tous.length ? tous.map(ligne).join("\n") : "Aucun workflow pour l'instant sur ce serveur.");
      case "lire_workflow": {
        const wf = trouver(args.workflow);
        if (!wf) return texte(`Aucun workflow « ${String(args.workflow ?? "")} ». lister_workflows donne les identifiants.`, true);
        const siennes = executionsDe(wf.id).sort((a, b) => (b.numero ?? 0) - (a.numero ?? 0));
        const voulue = typeof args.execution === "string" && args.execution.trim() ? args.execution.trim() : null;
        const exec = voulue ? siennes.find((e) => e.id === voulue) : siennes[0];
        if (voulue && !exec) return texte(`Aucune exécution « ${voulue} » pour ce workflow.`, true);
        const etapes = (exec?.etapes ?? []).map((s) => `- ${s.noeudId} : ${s.statut}${s.erreur ? ` (${s.erreur})` : ""}${s.sortie ? `\n  ${String(s.sortie).slice(0, 2000)}` : ""}`);
        return texte(`${ligne(wf)}${exec ? `\n\nExécution n°${exec.numero} : ${exec.statut}${exec.erreur ? ` (${exec.erreur})` : ""}${etapes.length ? `\n${etapes.join("\n")}` : ""}` : "\n\nPas encore d'exécution."}`);
      }
      case "lancer_workflow": {
        const wf = trouver(args.workflow);
        if (!wf) return texte(`Aucun workflow « ${String(args.workflow ?? "")} ». lister_workflows donne les identifiants.`, true);
        if (String(appelant?.conversation ?? "").startsWith("wf-")) return texte("Une étape d'un workflow ne lance pas de workflow : dis-le dans ta réponse, la personne choisira.", true);
        if ([...enCours.values()].some((x) => x.workflowId === wf.id)) return texte(`« ${wf.titre} » tourne déjà : suis-le avec lire_workflow.`, true);
        const declencheurId = typeof args.declencheur === "string" && args.declencheur.trim() ? args.declencheur.trim() : null;
        if (declencheurId && !wf.graphe?.noeuds?.some((n) => n.id === declencheurId && n.type === "declencheur")) return texte(`« ${declencheurId} » n'est pas un déclencheur de ce workflow.`, true);
        const id = lancer(wf.id, { declencheurId, source: "agent", charge: typeof args.entree === "string" ? args.entree.slice(0, 100_000) : undefined, lancePar: { roleId: appelant?.agent ?? "principal", chatId: appelant?.conversation ?? "" } });
        return texte(`Exécution de « ${wf.titre} » lancée (id ${id}). Suis-la avec lire_workflow.`);
      }
      case "construire_workflow":
        return texte("Construire ou modifier un workflow se fait sous les yeux de la personne : son app KLYRA doit être ouverte. Dis-lui ce que tu voulais construire.", true);
      default:
        return texte("Outil inconnu.", true);
    }
  }

  /** Une demande de l'app (route `/klyra/v1/workflows/<méthode>`). */
  function appeler(methode, c = {}) {
    switch (methode) {
      case "lancer": {
        /* L'app envoie le workflow avec : le dernier changement n'attend pas la prochaine écriture de l'espace. */
        if (c.workflow?.id) espace.ecrire({ elements: [{ type: "workflow", id: c.workflow.id, valeur: c.workflow }] });
        const id = lancer(c.workflow?.id ?? c.workflowId, c.options);
        if (!id) throw new Error("Ce workflow n’est pas sur ce serveur.");
        return { id };
      }
      case "arreter":
        return { ok: arreter(c.id) };
      case "decider":
        return { ok: decider(c.etapeId, c.approuver) };
      default:
        throw new Error("Ce serveur ne connaît pas cette demande.");
    }
  }

  return { appeler, outilAgent, lancer, arreter, decider, webhook, tick, reprendre, demarrer, arreterTout, enCours: () => enCours.size, attendre: (id) => enCours.get(id)?.fini };
}
