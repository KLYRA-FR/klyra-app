import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { Cerveau } from "./cerveau";
import { contientSecret, texteAGarder } from "./cerveau-sens";
import type { NoteCerveau, SourceCerveau } from "./cerveau-types";

const TEXTES = new Set(".md .markdown .txt .csv".split(" "));
const IGNORES = new Set([".git", "node_modules", ".next", "dist", "build", ".turbo", ".cache"]);
const ID = /^[a-zA-Z0-9_.:@-]{1,160}$/;

function idOuNull(v: unknown): string | null {
  return typeof v === "string" && ID.test(v) ? v : null;
}

/** Range une copie indexée. Le fichier d’origine n’est ni lu en écriture, ni déplacé. */
export function ingererTexte(cerveau: Cerveau, entree: { titre: string; contenu: string; origine: string; agentId: string | null; projetId: string | null; source?: SourceCerveau | null }): { id: string; inchange: boolean } | null {
  if (!entree.contenu.trim() || entree.contenu.includes("\0") || contientSecret(entree.contenu) || Buffer.byteLength(entree.contenu) > 2_000_000) return null;
  const avant = cerveau.db.prepare("SELECT id FROM connaissance WHERE origine=?").get(entree.origine) as { id?: string } | undefined;
  const liens = avant?.id
    ? cerveau.db.prepare("SELECT b AS id FROM connexion WHERE a=? UNION SELECT a AS id FROM connexion WHERE b=?").all(avant.id, avant.id).map((r) => String((r as { id: string }).id))
    : [];
  const note: NoteCerveau = {
    id: avant?.id ? String(avant.id) : `auto-${createHash("sha256").update(entree.origine).digest("hex").slice(0, 32)}`,
    titre: (entree.titre.trim() || "Note").slice(0, 180),
    contenu: entree.contenu,
    projetId: idOuNull(entree.projetId),
    agentId: idOuNull(entree.agentId),
    liens,
    source: entree.source ?? null,
    creeLe: "",
    modifieLe: "",
  };
  try {
    const r = cerveau.garder(note, { origine: entree.origine, agentId: note.agentId ?? null });
    return { id: r.note.id, inchange: r.inchange };
  } catch {
    return null;
  }
}

type MessageBrut = {
  id?: string; chatId?: string; statut?: string; compaction?: boolean; compactionAuto?: string;
  author?: { kind?: string; roleId?: string }; parts?: { type?: string; text?: string }[];
};
type ChatBrut = { id?: string; title?: string; projectId?: string | null; lieu?: string | null; fil?: { projetId?: string | null } };

/**
 * Décisions et passages à retenir d’une conversation. Les souvenirs privés d’un agent ne sont pas élargis :
 * ces notes sont partagées dans le projet de la conversation (visibles par l’équipe de ce projet).
 */
export function ingererDecisions(cerveau: Cerveau, chatsInconnus: unknown, messagesInconnus: unknown): { indexes: number; ignores: number } {
  const chats = (Array.isArray(chatsInconnus) ? chatsInconnus : []) as ChatBrut[];
  const messages = (Array.isArray(messagesInconnus) ? messagesInconnus : []) as MessageBrut[];
  const parChat = new Map(chats.filter((c) => c.id).map((c) => [String(c.id), c]));
  let indexes = 0, ignores = 0;
  for (const m of messages) {
    if (!m.id || !m.chatId || m.statut === "en-cours" || m.compaction || m.compactionAuto) { ignores++; continue; }
    const chat = parChat.get(m.chatId);
    if (!chat || chat.lieu) { ignores++; continue; }
    const texte = (m.parts ?? []).filter((p) => p.type === "text" && typeof p.text === "string").map((p) => p.text).join("\n").trim();
    if (!texteAGarder(texte)) { ignores++; continue; }
    const projet = chat.projectId ?? chat.fil?.projetId ?? null;
    const qui = m.author?.kind === "role" && m.author.roleId ? m.author.roleId : "conversation";
    const r = ingererTexte(cerveau, {
      titre: `Décision · ${qui} · ${(chat.title || "Conversation").slice(0, 120)}`,
      contenu: texte,
      origine: `conversation:${m.chatId}:${m.id}`,
      agentId: null,
      projetId: typeof projet === "string" ? projet : null,
      source: { chatId: m.chatId, messageId: m.id, titre: chat.title || "Conversation", extrait: texte.slice(0, 500) },
    });
    if (r && !r.inchange) indexes++;
  }
  return { indexes, ignores };
}

/** Textes d’un dossier d’agent (rendus, atelier). Les originaux restent en place. */
export async function ingererDossierAgent(cerveau: Cerveau, racine: string, agent: string, prefixe: string, projetId: string | null = null): Promise<{ indexes: number; inchanges: number }> {
  let indexes = 0, inchanges = 0;
  let reel: string;
  try { reel = await realpath(racine); } catch { return { indexes, inchanges }; }
  const visiter = async (rel: string, profondeur: number) => {
    if (profondeur > 4) return;
    let entrees;
    try { entrees = await readdir(path.join(reel, rel), { withFileTypes: true }); } catch { return; }
    for (const e of entrees) {
      if (e.name.startsWith(".") || IGNORES.has(e.name)) continue;
      const id = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { await visiter(id, profondeur + 1); continue; }
      if (!e.isFile() || !TEXTES.has(path.extname(e.name).toLowerCase())) continue;
      try {
        const fichier = path.join(reel, id);
        const st = await lstat(fichier);
        if (!st.isFile() || st.size === 0 || st.size > 2_000_000) continue;
        const cible = await realpath(fichier);
        if (cible !== reel && !cible.startsWith(reel + path.sep)) continue;
        const contenu = await readFile(cible, "utf8");
        const r = ingererTexte(cerveau, { titre: `${agent} · ${e.name}`.slice(0, 180), contenu, origine: `${prefixe}:${id}`, agentId: agent, projetId });
        if (!r) continue;
        if (r.inchange) inchanges++; else indexes++;
      } catch { /* illisible : on n’invente pas son contenu */ }
    }
  };
  await visiter("", 0);
  return { indexes, inchanges };
}
