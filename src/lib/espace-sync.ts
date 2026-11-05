import type { Chat, Message, Project, Rendu } from "@/types/domain";
import type { ExecutionWorkflow, Workflow } from "@/types/workflows";
import { dansEspace } from "./lieux";
import { lieuDuRendu } from "./rendus-espace";

/**
 * Ce qu'un VPS garde de son espace (serveur/espace.mjs) : ce module découpe l'état de l'app par serveur,
 * trouve ce qui a changé, et range ce que le serveur rend. Sans réseau ni écran : il se teste seul.
 * Le PC garde sa copie dans `conversations.json` : elle sert de filet si le serveur ne répond pas.
 */

export type TypeEspace = "conversation" | "projet" | "workflow" | "execution" | "rendu";

export interface ElementEspace {
  type: TypeEspace;
  id: string;
  valeur: unknown;
}

export interface ValeurConversation {
  chat: Chat;
  messages: Message[];
}

export interface EtatEspace {
  chats: Chat[];
  messages: Message[];
  projects: Project[];
  workflows: Workflow[];
  executions: ExecutionWorkflow[];
  rendus: Rendu[];
}

export interface LectureEspace {
  revision: number;
  inchange?: boolean;
  elements?: ElementEspace[];
  supprimes?: Partial<Record<TypeEspace, Record<string, number>>>;
  /** Les workflows de ce serveur tournent sur lui : l'app ne les lance plus elle-même. */
  moteurWorkflows?: boolean;
}

/** Une empreinte courte du contenu, pour ne renvoyer que ce qui a changé. */
function empreinte(valeur: unknown): string {
  const texte = JSON.stringify(valeur) ?? "";
  let h = 2166136261;
  for (let i = 0; i < texte.length; i++) {
    h ^= texte.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${texte.length}:${h >>> 0}`;
}

const cle = (type: TypeEspace, id: string) => `${type}\u0000${id}`;

/**
 * Tout ce qui appartient à ce serveur. Une conversation où un agent écrit part sans sa réponse en cours : le
 * message de la personne est tout de suite sur le serveur, et l'écriture de l'agent n'envoie rien à chaque mot.
 */
export function elementsDuServeur(etat: EtatEspace, lieu: string, travaille: (chatId: string) => boolean = () => false): { elements: ElementEspace[] } {
  const parChat = new Map<string, Message[]>();
  for (const m of etat.messages) {
    const liste = parChat.get(m.chatId);
    if (liste) liste.push(m);
    else parChat.set(m.chatId, [m]);
  }
  const elements: ElementEspace[] = [];
  for (const chat of etat.chats) {
    if (!dansEspace(chat.lieu, lieu)) continue;
    const messages = parChat.get(chat.id) ?? [];
    elements.push({ type: "conversation", id: chat.id, valeur: { chat, messages: travaille(chat.id) ? messages.filter((m) => m.statut !== "en-cours") : messages } satisfies ValeurConversation });
  }
  for (const p of etat.projects) if (dansEspace(p.lieu, lieu)) elements.push({ type: "projet", id: p.id, valeur: p });
  const workflows = new Set<string>();
  for (const w of etat.workflows) {
    if (!dansEspace(w.lieu, lieu)) continue;
    workflows.add(w.id);
    elements.push({ type: "workflow", id: w.id, valeur: w });
  }
  for (const e of etat.executions) if (workflows.has(e.workflowId)) elements.push({ type: "execution", id: e.id, valeur: e });
  for (const r of etat.rendus) if (lieuDuRendu(r.origine) === lieu) elements.push({ type: "rendu", id: r.id, valeur: r });
  return { elements };
}

/** Ce qu'il faut envoyer depuis le dernier envoi. `memo` : l'empreinte de ce que le serveur a déjà. */
export function changements(elements: ElementEspace[], memo: ReadonlyMap<string, string>) {
  const suivant = new Map<string, string>();
  const aEcrire: ElementEspace[] = [];
  for (const e of elements) {
    const k = cle(e.type, e.id);
    const h = empreinte(e.valeur);
    suivant.set(k, h);
    /* Une exécution est écrite par le moteur du serveur : l'app n'y envoie que celles qu'il ne connaît pas (l'historique). */
    if (e.type === "execution" && memo.has(k)) continue;
    if (memo.get(k) !== h) aEcrire.push(e);
  }
  const aRetirer: { type: TypeEspace; id: string }[] = [];
  for (const k of memo.keys()) {
    if (suivant.has(k)) continue;
    const i = k.indexOf("\u0000");
    aRetirer.push({ type: k.slice(0, i) as TypeEspace, id: k.slice(i + 1) });
  }
  return { aEcrire, aRetirer, suivant };
}

/** L'empreinte de ce que le serveur vient de rendre : le point de départ des prochains envois. */
export function memoDe(elements: ElementEspace[]): Map<string, string> {
  return new Map(elements.map((e) => [cle(e.type, e.id), empreinte(e.valeur)]));
}

/** Découpe un envoi : le serveur refuse un corps trop gros. */
export function paquets(aEcrire: ElementEspace[], tailleMax = 8_000_000): ElementEspace[][] {
  const sortie: ElementEspace[][] = [];
  let courant: ElementEspace[] = [];
  let taille = 0;
  for (const e of aEcrire) {
    const t = JSON.stringify(e.valeur)?.length ?? 0;
    if (courant.length && taille + t > tailleMax) {
      sortie.push(courant);
      courant = [];
      taille = 0;
    }
    courant.push(e);
    taille += t;
  }
  if (courant.length) sortie.push(courant);
  return sortie;
}

const plusRecent = (a: string | undefined, b: string | undefined) => !!a && (!b || a > b);

function ranger<T extends { id: string }>(locaux: T[], lus: T[], retires: Record<string, number> | undefined, gagne: (lu: T, local: T) => boolean, lieu?: (t: T) => T): T[] {
  const parId = new Map(locaux.map((x) => [x.id, x]));
  for (const lu of lus) {
    const propre = lieu ? lieu(lu) : lu;
    const local = parId.get(lu.id);
    if (!local || gagne(propre, local)) parId.set(lu.id, propre);
  }
  for (const id of Object.keys(retires ?? {})) if (!lus.some((l) => l.id === id)) parId.delete(id);
  return [...parId.values()];
}

/**
 * Range ce que le serveur rend dans l'état de l'app. Le plus récent gagne ; ce qui n'existe qu'ici sera
 * envoyé ensuite. Une conversation où un agent écrit ne bouge pas, et rien d'un autre serveur n'est touché.
 */
export function fusionner(etat: EtatEspace, lu: LectureEspace, lieu: string, travaille: (chatId: string) => boolean = () => false): EtatEspace {
  const de = <T,>(type: TypeEspace) => (lu.elements ?? []).filter((e) => e.type === type).map((e) => e.valeur as T);
  const retires = lu.supprimes ?? {};
  const conversations = de<ValeurConversation>("conversation").filter((c) => c?.chat?.id && !travaille(c.chat.id));
  const remplacees = new Set<string>();
  const avant = new Map(etat.chats.map((c) => [c.id, c]));
  for (const c of conversations) {
    const local = avant.get(c.chat.id);
    if (!local || plusRecent(c.chat.updatedAt, local.updatedAt)) remplacees.add(c.chat.id);
  }
  const retireesConv = Object.keys(retires.conversation ?? {}).filter((id) => !conversations.some((c) => c.chat.id === id) && dansEspace(avant.get(id)?.lieu, lieu) && !travaille(id));
  const chats = etat.chats.filter((c) => !retireesConv.includes(c.id) && !remplacees.has(c.id));
  const messages = etat.messages.filter((m) => !retireesConv.includes(m.chatId) && !remplacees.has(m.chatId));
  for (const c of conversations) {
    if (!remplacees.has(c.chat.id)) continue;
    chats.push({ ...c.chat, lieu });
    messages.push(...(c.messages ?? []));
  }
  return {
    chats,
    messages,
    projects: ranger(etat.projects, de<Project>("projet"), retires.projet, (l, x) => plusRecent(l.updatedAt, x.updatedAt), (p) => ({ ...p, lieu })),
    workflows: ranger(etat.workflows, de<Workflow>("workflow"), retires.workflow, (l, x) => plusRecent(l.majLe, x.majLe), (w) => ({ ...w, lieu })),
    /* Le serveur fait foi sur ses exécutions : c'est lui qui les fait tourner. */
    executions: ranger(etat.executions, de<ExecutionWorkflow>("execution"), retires.execution, () => true),
    rendus: ranger(etat.rendus, de<Rendu>("rendu"), retires.rendu, () => false),
  };
}
