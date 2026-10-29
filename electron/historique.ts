import { app } from "electron";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { readConversations } from "./conversations";
import type { EntreeConsommation } from "./consommation";

/**
 * Toute la consommation de Claude Code sur cet ordinateur, lue dans ses
 * transcriptions locales (~/.claude/projects/**.jsonl, ou $CLAUDE_CONFIG_DIR ;
 * %USERPROFILE%\.claude sous Windows) : terminal, IDE, et sessions de l'app.
 *
 * - Sessions de l'app : l'app garde l'identifiant de session de chaque agent
 *   dans chaque conversation (chat.sessions). Ces sessions sont marquées
 *   `klyra`, avec leur agent, et lues seulement avant le début du journal en
 *   direct (consommation.ts) : rien n'est compté deux fois.
 * - Autres sessions (terminal, IDE…) : lues en entier, agent « hors-klyra ».
 * - Jetons et modèle : chaque réponse de l'assistant (`usage`), une seule fois
 *   (Claude Code répète la ligne pour chaque bloc d'une même réponse).
 * - Coût : les lignes `cost-state`, cumulées par processus ; on prend l'écart.
 *   Sans elles, pas de coût.
 *
 * Le résultat va dans consommation-historique.jsonl ; un relevé des fichiers
 * déjà lus (taille, date, sessions de l'app ou non) rend les passages suivants
 * incrémentaux : seul un fichier qui a changé est relu.
 */

const dossierClaude = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const fichierHistorique = () => path.join(app.getPath("userData"), "consommation-historique.jsonl");
const fichierReleve = () => path.join(app.getPath("userData"), "consommation-historique.json");
const UN_AN_MS = 366 * 24 * 60 * 60 * 1000;

export interface EtatHistorique {
  /** Date du plus ancien élément rattrapé (ms) ; null si rien. */
  depuis: number | null;
  /** Le journal en direct commence ici : l'historique des sessions de l'app s'arrête avant. */
  jusqua: number;
  /** Sessions gardées par l'app, et celles dont la transcription est sur ce poste. */
  sessionsApp: number;
  sessionsTrouvees: number;
  /** Toutes les sessions Claude Code de l'année sur ce poste. */
  sessionsTotal: number;
  /** Pourquoi il manque quelque chose, en clair ; null si rien ne manque. */
  raison: string | null;
  rattrapeLe: number;
}

interface Releve {
  jusqua: number;
  /** Fichier lu → sa taille, sa date de modification et s'il appartient à l'app, à la lecture. */
  fichiers: Record<string, { taille: number; modifie: number; klyra: boolean }>;
  etat: EtatHistorique | null;
}

type Entree = EntreeConsommation & { source?: string };
const nombre = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);

/** Les sessions de l'app, avec leur agent, lues dans conversations.json. */
async function sessionsDeLApp(): Promise<Map<string, string>> {
  const sessions = new Map<string, string>();
  const data = (await readConversations().catch(() => null)) as { chats?: { sessions?: Record<string, unknown> }[] } | null;
  for (const chat of data?.chats ?? []) {
    for (const [roleId, sessionId] of Object.entries(chat.sessions ?? {})) {
      if (typeof sessionId === "string" && /^[\w-]{8,}$/.test(sessionId)) sessions.set(sessionId, roleId);
    }
  }
  return sessions;
}

/**
 * Toutes les transcriptions de l'année : <projet>/<session>.jsonl et, pour les
 * sous-agents, <projet>/<session>/**.jsonl (rattachés à leur session).
 */
async function transcriptions(): Promise<{ fichier: string; sessionId: string; taille: number; modifie: number }[]> {
  const racine = path.join(dossierClaude(), "projects");
  const limite = Date.now() - UN_AN_MS;
  const trouves: { fichier: string; sessionId: string; taille: number; modifie: number }[] = [];
  const garder = async (fichier: string, sessionId: string) => {
    const s = await stat(fichier).catch(() => null);
    if (s && s.mtimeMs >= limite) trouves.push({ fichier, sessionId, taille: s.size, modifie: s.mtimeMs });
  };
  const parcourir = async (dossier: string, sessionId: string) => {
    for (const e of await readdir(dossier, { withFileTypes: true }).catch(() => [])) {
      const chemin = path.join(dossier, e.name);
      if (e.isDirectory()) await parcourir(chemin, sessionId);
      else if (e.name.endsWith(".jsonl")) await garder(chemin, sessionId);
    }
  };
  for (const projet of await readdir(racine).catch(() => [] as string[])) {
    const dossier = path.join(racine, projet);
    for (const e of await readdir(dossier, { withFileTypes: true }).catch(() => [])) {
      if (e.isFile() && e.name.endsWith(".jsonl")) await garder(path.join(dossier, e.name), e.name.replace(/\.jsonl$/, ""));
      else if (e.isDirectory()) await parcourir(path.join(dossier, e.name), e.name);
    }
  }
  return trouves;
}

/**
 * Les entrées d'une transcription. Lue ligne par ligne (fins de ligne \n ou
 * \r\n). `jusqua` : pour une session de l'app, rien après le début du journal.
 */
async function lireTranscription(fichier: string, klyra: boolean, agent: string, jusqua: number): Promise<Entree[]> {
  const entrees: Entree[] = [];
  const vus = new Set<string>();
  const avant = (at: number) => !klyra || at < jusqua;
  /* Coût cumulé par processus (startTime) et par modèle. */
  const coutPrecedent = new Map<string, number>();
  let dernierAt = 0;
  const lignes = createInterface({ input: createReadStream(fichier, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const brute of lignes) {
    const ligne = brute.trim();
    if (!ligne) continue;
    let m: Record<string, unknown>;
    try {
      m = JSON.parse(ligne) as Record<string, unknown>;
    } catch {
      continue;
    }
    const at = typeof m.timestamp === "string" ? Date.parse(m.timestamp) : NaN;
    if (Number.isFinite(at)) dernierAt = at;

    if (m.type === "assistant" && Number.isFinite(at) && avant(at)) {
      const message = (m.message ?? {}) as { id?: string; model?: string; usage?: Record<string, unknown> };
      const cle = `${message.id ?? ""}|${String(m.requestId ?? "")}`;
      if (!message.usage || !message.model || message.model === "<synthetic>" || vus.has(cle)) continue;
      vus.add(cle);
      const u = message.usage;
      const jetons = {
        entree: nombre(u.input_tokens),
        sortie: nombre(u.output_tokens),
        cacheLu: nombre(u.cache_read_input_tokens),
        cacheEcrit: nombre(u.cache_creation_input_tokens),
      };
      if (jetons.entree + jetons.sortie + jetons.cacheLu + jetons.cacheEcrit === 0) continue;
      entrees.push({ at, fournisseur: "Claude Code", modele: message.model, agent, jetons, coutUsd: null, klyra, source: fichier });
    }

    if (m.type === "cost-state" && dernierAt && avant(dernierAt)) {
      const usage = (m.modelUsage ?? {}) as Record<string, { costUSD?: number }>;
      for (const [modele, u] of Object.entries(usage)) {
        const cle = `${String(m.startTime ?? "")}|${modele}`;
        const total = nombre(u?.costUSD);
        const ecart = total - (coutPrecedent.get(cle) ?? 0);
        coutPrecedent.set(cle, total);
        if (ecart > 0) {
          entrees.push({ at: dernierAt, fournisseur: "Claude Code", modele, agent, jetons: { entree: 0, sortie: 0, cacheLu: 0, cacheEcrit: 0 }, coutUsd: ecart, klyra, source: fichier });
        }
      }
    }
  }
  return entrees;
}

let enCours: Promise<EtatHistorique> | null = null;

/**
 * Rattrape l'historique, puis seulement ce qui a changé depuis. `debutJournal` :
 * la date de la première ligne du journal en direct (ou maintenant).
 */
export function rattraperHistorique(debutJournal: number): Promise<EtatHistorique> {
  enCours ??= (async () => {
    const releve: Releve = await readFile(fichierReleve(), "utf8")
      .then((t) => JSON.parse(t) as Releve)
      .catch(() => ({ jusqua: debutJournal, fichiers: {}, etat: null }));
    const jusqua = releve.jusqua;
    const sessions = await sessionsDeLApp();
    const fichiers = await transcriptions();
    const nouvelles: Entree[] = [];
    const relus = new Set<string>();
    const presents = new Set(fichiers.map((f) => f.fichier));
    const sessionsTrouvees = new Set<string>();

    for (const { fichier, sessionId, taille, modifie } of fichiers) {
      const klyra = sessions.has(sessionId);
      if (klyra) sessionsTrouvees.add(sessionId);
      const deja = releve.fichiers[fichier];
      // Inchangé depuis la dernière lecture, et toujours rangé du même côté (app ou non) : rien à relire.
      if (deja && deja.taille === taille && deja.modifie === modifie && deja.klyra === klyra) continue;
      nouvelles.push(...(await lireTranscription(fichier, klyra, klyra ? (sessions.get(sessionId) ?? "principal") : "hors-klyra", jusqua)));
      relus.add(fichier);
      releve.fichiers[fichier] = { taille, modifie, klyra };
    }

    // Réécrit l'historique : les lignes des fichiers non relus et encore présents, plus les nouvelles.
    const anciennes = (await readFile(fichierHistorique(), "utf8").catch(() => ""))
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l) as Entree;
        } catch {
          return null;
        }
      })
      .filter((e): e is Entree => !!e && !relus.has(e.source ?? "") && presents.has(e.source ?? ""));
    for (const f of Object.keys(releve.fichiers)) if (!presents.has(f)) delete releve.fichiers[f];
    const toutes = [...anciennes, ...nouvelles].sort((a, b) => a.at - b.at);
    await mkdir(path.dirname(fichierHistorique()), { recursive: true });
    await writeFile(fichierHistorique(), toutes.map((e) => JSON.stringify(e)).join("\n") + (toutes.length ? "\n" : ""), "utf8");

    const sessionsTotal = new Set(fichiers.map((f) => f.sessionId)).size;
    const etat: EtatHistorique = {
      depuis: toutes[0]?.at ?? null,
      jusqua,
      sessionsApp: sessions.size,
      sessionsTrouvees: sessionsTrouvees.size,
      sessionsTotal,
      raison: !sessionsTotal
        ? "Aucune transcription de Claude Code sur ce poste : Claude Code n’y a pas encore servi, ou ses transcriptions ont été effacées."
        : sessions.size && !sessionsTrouvees.size
          ? "Les transcriptions des conversations de l’app sont introuvables sur ce poste (effacées, ou Claude Code a tourné ailleurs)."
          : sessionsTrouvees.size < sessions.size
            ? `${sessions.size - sessionsTrouvees.size} conversation(s) de l’app sur ${sessions.size} n’ont plus leur transcription : elles ne sont pas comptées.`
            : null,
      rattrapeLe: Date.now(),
    };
    releve.etat = etat;
    await writeFile(fichierReleve(), JSON.stringify(releve), "utf8");
    return etat;
  })().finally(() => {
    enCours = null;
  });
  return enCours;
}

/** Les lignes rattrapées, sans leur source. */
export async function lireHistorique(): Promise<EntreeConsommation[]> {
  const brut = await readFile(fichierHistorique(), "utf8").catch(() => "");
  const entrees: EntreeConsommation[] = [];
  for (const l of brut.split(/\r?\n/)) {
    if (!l.trim()) continue;
    try {
      const { source: _source, ...e } = JSON.parse(l) as Entree;
      void _source;
      entrees.push(e);
    } catch {
      /* ligne abîmée : ignorée */
    }
  }
  return entrees;
}
