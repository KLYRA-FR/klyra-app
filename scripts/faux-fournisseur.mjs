/**
 * Un faux fournisseur Anthropic local (`ANTHROPIC_BASE_URL`) pour faire tourner le vrai Claude Code
 * sans compte ni dépense. Réponses scriptées d'après le dernier ordre de la personne :
 * - « appelle <agent> » : l'assistant appelle l'outil Agent avec ce type de sous-agent ;
 * - « fil <agent> » : il ouvre un fil (outil `ouvrir_fil` de l'app) pour cet agent ;
 * - « liste <agent> » : il liste les fils ouverts de cet agent (outil `lister_fils`) ;
 * - « atelier <prénom> » : il complète la carte d'un agent à créer (outil `proposer_agent`) ;
 * - « choix <mot> » : il propose des réponses toutes prêtes (outil `proposer_choix`) ;
 * - « coffre <variable> » : il demande un secret à la personne (outil `coffre_demander`) ;
 * - après un résultat d'outil : « fin OK|REFUS … » ; un sous-agent répond « bonjour de <nom> ».
 * - l'épreuve de l'atelier : l'agent en essai répond d'après la demande (il prend un bug pour lui tant
 *   que sa fiche ne dit pas de passer la main), et le juge rend un verdict JSON.
 * L'entrée de `proposer_agent` arrive par morceaux, comme d'un vrai modèle (carte écrite en direct).
 * Les fiches d'essai portent `SOUS-AGENT-TEST-<nom>` dans leur consigne pour être reconnues.
 * Chaque requête est notée : sous-agent, agents listés au modèle, résultats d'outils.
 */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";

const texteDe = (contenu) => (typeof contenu === "string" ? contenu : (contenu ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n"));

/** Les outils de l'app appelés par un ordre, et ce qu'ils reçoivent. */
const OUTILS_ORDRES = { fil: "mcp__klyra__ouvrir_fil", liste: "mcp__klyra__lister_fils", atelier: "mcp__klyra__proposer_agent", choix: "mcp__klyra__proposer_choix", coffre: "mcp__klyra__coffre_demander" };
function entreeOrdre(verbe, cible) {
  if (verbe === "fil") return { agent: cible, titre: "Essai", brief: "Brief d’essai." };
  if (verbe === "atelier")
    return {
      nom: cible.charAt(0).toUpperCase() + cible.slice(1),
      role: "Veille",
      mission: "Suit les concurrents et rend une note sourcée.",
      declencheurs: ["Chaque vendredi matin"],
      epreuve: { normal: "Quoi de neuf chez nos trois concurrents ?", floue: "Regarde le marché.", horsMetier: "Corrige le bug du formulaire de contact." },
      voisins: [{ id: "nina", raison: "Elle suit déjà les propositions commerciales." }],
      routine: { nom: "Note de veille", consigne: "Rends la note de veille de la semaine.", quand: { type: "semaine", jour: 5, heure: "08:30" } },
    };
  if (verbe === "coffre") return { variable: cible, nom: "Clé d’essai", genre: "cle-api", service: "essai.klyra.fr", raison: "Pour l’essai du coffre." };
  if (verbe === "choix") return { question: "Quand l’appeler ?", options: ["Chaque vendredi", "Avant un rendez-vous", "Quand je cite un concurrent"], multiple: true };
  return { agent: cible };
}

/** L'agent en essai (atelier) : sa réponse d'après la demande et sa fiche. */
function essai(systeme, demande) {
  if (/bug/i.test(demande)) return systeme.includes("je passe la main") ? "Ce n’est pas mon métier : je passe la main à qui s’occupe du site." : "Je corrige le formulaire tout de suite.";
  if (/^Regarde le marché/.test(demande.trim())) return "Quel marché, et pour quelle décision ? Donne-moi deux concurrents.";
  return "Une note d’une page, chaque fait avec son lien et sa date.";
}

/** Le juge de l'épreuve : un bug pris pour soi est raté, le reste réussi. */
function juger(texte) {
  const reponse = texte.match(/<reponse>\n([\s\S]*?)\n<\/reponse>/)?.[1] ?? "";
  if (texte.includes("hors de son métier") && /Je corrige/.test(reponse))
    return JSON.stringify({ verdict: "ko", raison: "Il prend un travail qui n’est pas le sien.", correction: { pilier: "limites", texte: "Le code et les bugs : je passe la main." } });
  return JSON.stringify({ verdict: "ok", raison: "Il répond comme sa fiche le demande.", correction: null });
}

export async function demarrerFournisseur(agentsSurveilles) {
  const requetes = [];
  /** Les recherches d'outils lancées : leur résultat appelle ensuite l'outil trouvé. */
  const recherches = new Set();
  function reponse(corps) {
    const brut = JSON.stringify(corps);
    const systeme = JSON.stringify(corps.system ?? "");
    const outilAgent = (corps.tools ?? []).find((t) => t.name === "Agent" || t.name === "Task");
    // Un sous-agent n'a que sa fiche pour consigne ; un agent lancé par l'app (`--agent`) a aussi celles de l'app.
    const sousAgent = systeme.includes("dans cette app") ? null : (systeme.match(/SOUS-AGENT-TEST-([a-z0-9-]+)/)?.[1] ?? null);
    // Claude peut ajouter un message système après le résultat d'outil.
    // Ne pas reprendre un résultat d'un tour précédent : garder le dernier message utilisateur.
    const dernier = (corps.messages ?? []).findLast((m) => m.role === "user");
    const resultats = Array.isArray(dernier?.content) ? dernier.content.filter((c) => c.type === "tool_result") : [];
    const consigne = [...(corps.messages ?? [])].reverse().find((m) => m.role === "user" && /^(appelle|fil|liste|atelier|choix|coffre) /m.test(texteDe(m.content)));
    const ordre = consigne ? texteDe(consigne.content).match(/^(appelle|fil|liste|atelier|choix|coffre) ([a-z0-9-]+)/m) : null;
    requetes.push({
      message: texteDe(dernier?.content ?? ""),
      sousAgent,
      principal: !!outilAgent && !sousAgent,
      systeme,
      outils: (corps.tools ?? []).map((t) => t.name),
      listes: agentsSurveilles.filter((n) => brut.includes(`- ${n}: `)),
      resultats: resultats.map((r) => ({ erreur: !!r.is_error, texte: JSON.stringify(r.content).slice(0, 300) })),
      // La requête entière : ce que Claude Code envoie au modèle (cf. mesure-socle.mjs).
      corps,
    });
    if (sousAgent) return [{ type: "text", text: `bonjour de ${sousAgent}` }];
    // L'épreuve de l'atelier : le juge, puis l'agent en essai.
    if (texteDe(dernier?.content ?? "").includes("Tu juges l'essai")) return [{ type: "text", text: juger(texteDe(dernier.content)) }];
    if (systeme.includes("C'est un essai avant ta création")) return [{ type: "text", text: essai(systeme, texteDe(dernier?.content ?? "")) }];
    // Les outils de l'app : « fil » ouvre un fil, « liste » liste ceux de l'agent ; « atelier » et « choix » pour créer un agent.
    const nomOutil = ordre ? (OUTILS_ORDRES[ordre[1]] ?? null) : null;
    const outilFil = !!nomOutil && (corps.tools ?? []).some((t) => t.name === nomOutil);
    const filDemande = () => [{ type: "tool_use", id: `toolu_${randomUUID().slice(0, 8)}`, name: nomOutil, input: entreeOrdre(ordre[1], ordre[2]) }];
    // Les outils de l'app sont chargés à la demande (ToolSearch) : une fois trouvés, on s'en sert.
    if (resultats.some((r) => recherches.has(r.tool_use_id)) && nomOutil && outilFil) return filDemande();
    if (resultats.length) {
      return [{ type: "text", text: `fin ${resultats.map((r) => (r.is_error ? "REFUS" : "OK")).join(",")} ${JSON.stringify(resultats.map((r) => r.content)).slice(0, 400)}` }];
    }
    const id = `toolu_${randomUUID().slice(0, 8)}`;
    // Au premier plan : le sous-agent répond dans le même tour, rien ne déborde sur le suivant.
    if (outilAgent && ordre?.[1] === "appelle") {
      return [{ type: "tool_use", id, name: outilAgent.name, input: { subagent_type: ordre[2], description: "Essai", prompt: "Dis bonjour.", run_in_background: false } }];
    }
    if (nomOutil && outilFil) return filDemande();
    if (nomOutil && (corps.tools ?? []).some((t) => t.name === "ToolSearch")) {
      recherches.add(id);
      return [{ type: "tool_use", id, name: "ToolSearch", input: { query: `select:${nomOutil}`, max_results: 1 } }];
    }
    return [{ type: "text", text: "ok" }];
  }
  async function sse(res, blocs) {
    const ev = [{ type: "message_start", message: { id: `msg_${randomUUID()}`, type: "message", role: "assistant", model: "faux", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } } }];
    blocs.forEach((b, i) => {
      ev.push({ type: "content_block_start", index: i, content_block: b.type === "text" ? { type: "text", text: "" } : { type: "tool_use", id: b.id, name: b.name, input: {} } });
      if (b.type === "text") ev.push({ type: "content_block_delta", index: i, delta: { type: "text_delta", text: b.text } });
      else {
        // La carte de l'atelier s'écrit en direct : son entrée arrive par morceaux, comme d'un vrai modèle.
        const json = JSON.stringify(b.input);
        const taille = b.name === "mcp__klyra__proposer_agent" ? 48 : json.length || 1;
        for (let k = 0; k < json.length; k += taille) ev.push({ type: "content_block_delta", index: i, delta: { type: "input_json_delta", partial_json: json.slice(k, k + taille) }, pause: taille < json.length ? 120 : 0 });
      }
      ev.push({ type: "content_block_stop", index: i });
    });
    ev.push({ type: "message_delta", delta: { stop_reason: blocs.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn", stop_sequence: null }, usage: { output_tokens: 1 } });
    ev.push({ type: "message_stop" });
    res.writeHead(200, { "content-type": "text/event-stream" });
    // Claude Code peut couper la connexion en cours de route (app fermée) : on s'arrête sans erreur.
    res.on("error", () => {});
    for (const { pause, ...e } of ev) {
      if (res.destroyed) return;
      res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      if (pause) await new Promise((r) => setTimeout(r, pause));
    }
    res.end();
  }
  const serveur = createServer((req, res) => {
    let brut = "";
    req.on("data", (d) => (brut += d));
    req.on("end", () => {
      if (!req.url.startsWith("/v1/messages")) return res.writeHead(404).end();
      if (req.url.includes("count_tokens")) return res.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
      let corps;
      let blocs;
      try {
        corps = JSON.parse(brut || "{}");
        blocs = reponse(corps);
      } catch (e) {
        return res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ type: "error", error: { type: "api_error", message: String(e) } }));
      }
      if (corps.stream) return void sse(res, blocs);
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ id: "msg", type: "message", role: "assistant", model: "faux", content: blocs, stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }));
    });
  });
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${serveur.address().port}`, requetes, fermer: () => serveur.close() };
}

/**
 * Fait répondre l'app par Claude Code (`window.klyra.claude.stream`) et attend la fin.
 * `app` : celle de `pilote-app.mjs`, avec `window.__evts` déjà branché (cf. `suivreEvenements`).
 */
export async function demanderA(app, fournisseur, options) {
  const id = randomUUID();
  const debut = fournisseur.requetes.length;
  await app.ev(`window.klyra.claude.stream(${JSON.stringify(id)}, ${JSON.stringify({ dossier: null, sessionId: null, chatId: "dm-principal", acces: "tout", ...options })}).then(() => 0)`);
  await app.quand(`window.__evts.some((x) => x.id === ${JSON.stringify(id)} && x.e.type === "fin")`, 60000);
  const evts = await app.ev(`window.__evts.filter((x) => x.id === ${JSON.stringify(id)}).map((x) => x.e)`);
  // Les agents d'arrière-plan reviennent après la fin : on leur laisse le temps de parler au fournisseur.
  await new Promise((r) => setTimeout(r, 1500));
  return { evts, fin: evts.find((e) => e.type === "fin"), requetes: fournisseur.requetes.slice(debut) };
}

export const suivreEvenements = (app) => app.ev(`(() => { window.__evts = []; window.klyra.claude.onEvent((id, e) => window.__evts.push({ id, e })); return 0; })()`);
export const refuse = (r) => r.requetes.some((q) => q.resultats.some((x) => x.erreur));
export const sessionDe = (r) => r.evts.find((e) => e.type === "session")?.sessionId ?? null;
