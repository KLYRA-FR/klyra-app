import { existsSync, readdirSync, readFileSync, statSync, watch, type FSWatcher } from "node:fs";
import path from "node:path";
import { ouvrirCerveau, type Cerveau } from "./cerveau";
import { etatDossier, lancerScan } from "./cerveau-dossiers";
import { ingererDecisions, ingererDossierAgent } from "./cerveau-ingest";
import { indexerSouvenirs } from "./cerveau-service";

/**
 * Le second cerveau se met à jour seul : souvenirs déjà écrits par les agents, fichiers qu’ils ont produits,
 * décisions des conversations, et le dossier DIGITAL-OS s’il est connecté. Rien n’est déplacé ni modifié à la source.
 */
export function demarrerVeilleCerveau(opts: { donnees: string; configClaude: string; rendus: string; atelier: string; intervalleMs?: number }): () => void {
  const cerveau = ouvrirCerveau(opts.donnees);
  let arret = false, enCours = false, dernierScan = 0, mtimeConversations = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const watchers: FSWatcher[] = [];
  const passage = async () => {
    if (arret || enCours) return;
    enCours = true;
    try {
      cerveau.completerLiens(30);
      await souvenirs(opts.configClaude, cerveau);
      await produits(opts, cerveau);
      decisions(opts.donnees, cerveau, () => mtimeConversations, (n) => { mtimeConversations = n; });
      await digitalOs(cerveau, () => dernierScan, (n) => { dernierScan = n; });
    } catch (e) {
      console.error("Second cerveau :", e instanceof Error ? e.message : e);
    } finally { enCours = false; }
  };
  const lancer = () => { if (!arret) void passage(); };
  timers.push(setTimeout(lancer, 4_000));
  const boucle = setInterval(lancer, opts.intervalleMs ?? 3 * 60_000);
  surveiller(path.join(opts.configClaude, "agent-memory"), lancer, watchers);
  surveiller(opts.rendus, lancer, watchers);
  surveiller(opts.atelier, lancer, watchers);
  surveiller(path.join(opts.donnees, "conversations.json"), lancer, watchers);
  return () => {
    arret = true;
    for (const t of timers) clearTimeout(t);
    clearInterval(boucle);
    for (const w of watchers) w.close();
  };
}

async function souvenirs(configClaude: string, cerveau: Cerveau) {
  const racine = path.join(configClaude, "agent-memory");
  if (existsSync(racine)) {
    for (const nom of lireNoms(racine)) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(nom)) continue;
      const dossier = path.join(racine, nom);
      if (!estDossier(dossier)) continue;
      await indexerSouvenirs(cerveau, nom, { dossier, portee: "user" }, null);
    }
  }
  const projets = path.join(configClaude, "projects");
  if (!existsSync(projets)) return;
  for (const nom of lireNoms(projets)) {
    const memoire = path.join(projets, nom, "memory");
    if (estDossier(memoire)) await indexerSouvenirs(cerveau, "principal", { dossier: memoire, portee: "auto" }, null);
  }
}

async function produits(opts: { rendus: string; atelier: string }, cerveau: Cerveau) {
  for (const [racine, prefixe] of [[opts.rendus, "rendu"], [opts.atelier, "atelier"]] as const) {
    if (!existsSync(racine)) continue;
    for (const agent of lireNoms(racine)) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)) continue;
      const dossier = path.join(racine, agent);
      if (!estDossier(dossier)) continue;
      await ingererDossierAgent(cerveau, dossier, agent, `${prefixe}:${agent}`);
    }
  }
}

function decisions(donnees: string, cerveau: Cerveau, lireMtime: () => number, ecrireMtime: (n: number) => void) {
  const fichier = path.join(donnees, "conversations.json");
  if (existsSync(fichier)) {
    try {
      const mtime = statSync(fichier).mtimeMs;
      if (mtime !== lireMtime()) {
        ecrireMtime(mtime);
        const v = JSON.parse(readFileSync(fichier, "utf8")) as { chats?: unknown; messages?: unknown };
        if (Array.isArray(v.chats) && Array.isArray(v.messages)) ingererDecisions(cerveau, v.chats, v.messages);
      }
    } catch { /* écriture en cours : le prochain passage reprendra */ }
  }
  const espace = path.join(donnees, "espace", "conversation");
  if (!existsSync(espace)) return;
  for (const nom of lireNoms(espace)) {
    if (!nom.endsWith(".json")) continue;
    try {
      const v = JSON.parse(readFileSync(path.join(espace, nom), "utf8")) as { valeur?: { chat?: unknown; messages?: unknown } };
      const chat = v.valeur?.chat, messages = v.valeur?.messages;
      if (chat && typeof chat === "object" && Array.isArray(messages)) ingererDecisions(cerveau, [chat as { id?: string }], messages);
    } catch { /* une conversation illisible n’empêche pas les autres */ }
  }
}

async function digitalOs(cerveau: Cerveau, lire: () => number, ecrire: (n: number) => void) {
  const etat = etatDossier(cerveau);
  if (!etat || etat.etat === "indexation") return;
  if (etat.fin && Date.now() - lire() < 15 * 60_000) return;
  ecrire(Date.now());
  lancerScan(cerveau, false);
}

function lireNoms(dossier: string): string[] {
  try { return readdirSync(dossier); } catch { return []; }
}
function estDossier(dossier: string): boolean {
  try { return statSync(dossier).isDirectory(); } catch { return false; }
}
function surveiller(cible: string, lancer: () => void, watchers: FSWatcher[]) {
  if (!existsSync(cible)) return;
  let attente: ReturnType<typeof setTimeout> | null = null;
  try {
    const w = watch(cible, { recursive: true }, () => {
      if (attente) clearTimeout(attente);
      attente = setTimeout(lancer, 8_000);
    });
    w.on("error", () => w.close());
    watchers.push(w);
  } catch { /* un dossier absent ou non surveillable : le passage périodique suffit */ }
}
