import type { Chat, Message } from "@/types/domain";

/**
 * Rechercher dans les conversations de ce poste : équipe, directes et fils
 * (spec : `SPEC-RECHERCHE.md` d'Iris, point 6). Tout se passe en mémoire, sur
 * les messages déjà chargés par l'app : pas d'index sur le disque, pas de
 * service, rien ne quitte le poste. Le résultat suit l'état courant (message
 * vidé, réponse qui se termine).
 *
 * La règle :
 * - on cherche dans le texte des messages (le tien et celui des agents), Markdown
 *   aplati, dans les adresses de leurs liens, et dans les titres des conversations
 *   (le nom de l'agent pour une conversation directe) ;
 * - pas dans les pièces jointes (ni leur nom, ni leur contenu), les étapes,
 *   autorisations, passations, tâches, journaux, options ni actions, ni dans une
 *   réponse en cours d'écriture, ni dans un fil supprimé ;
 * - accents, majuscules, ligatures (œ, æ), apostrophes et guillemets typographiques,
 *   espaces insécables et retours à la ligne ne comptent pas ;
 * - tous les mots d'au moins 2 caractères doivent être dans le message, dans
 *   n'importe quel ordre, même au milieu d'un mot (« factur » trouve « facture ») ;
 * - entre guillemets ("…", « … », “…”) : la phrase exacte, mots dans l'ordre ;
 * - la requête n'est jamais interprétée (ni expression régulière, ni HTML, ni commande) ;
 * - d'abord 3 conversations au plus dont le titre correspond, puis les messages,
 *   les plus récents d'abord, `LIMITE` au plus, avec le nombre total.
 */

/** Un mot plus court ne compte pas : une lettre trouve presque tout. */
export const LONGUEUR_MIN = 2;
/** Les messages montrés au plus ; le total est donné à part. */
export const LIMITE = 100;
/** Les conversations dont le titre correspond, montrées avant les messages. */
export const CONVERSATIONS_MAX = 3;
/** L'extrait : un peu de contexte avant la première correspondance, le reste après. */
const AVANT = 40;
const LONGUEUR_EXTRAIT = 180;

/* ─── Normaliser ───────────────────────────────────────────────── */

const EQUIVALENTS: Record<string, string> = {
  œ: "oe",
  æ: "ae",
  ß: "ss",
  "’": "'",
  "‘": "'",
  ʼ: "'",
  "«": '"',
  "»": '"',
  "“": '"',
  "”": '"',
  "„": '"',
};

const ESPACE = /\s/u;
const DIACRITIQUES = /\p{M}/gu;

export interface TexteNormalise {
  texte: string;
  /** Pour chaque unité de `texte`, sa position dans le texte d'origine. */
  origine: number[];
}

/**
 * Le texte tel qu'on le compare : minuscules, sans accents, espaces réduits à un
 * seul. Caractère par caractère, pour ramener chaque correspondance à sa place
 * dans le texte d'origine (extrait, surlignage dans le message rendu).
 */
export function normaliser(source: string): TexteNormalise {
  let texte = "";
  const origine: number[] = [];
  let espace = false;
  for (let i = 0; i < source.length; ) {
    /* Le cas courant, une lettre ou un signe ASCII, sans passer par Unicode. */
    const code = source.charCodeAt(i);
    if (code > 32 && code < 127) {
      texte += code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : source[i];
      origine.push(i);
      espace = false;
      i++;
      continue;
    }
    const caractere = String.fromCodePoint(source.codePointAt(i)!);
    if (ESPACE.test(caractere)) {
      if (!espace && texte) {
        texte += " ";
        origine.push(i);
      }
      espace = true;
    } else {
      espace = false;
      const minuscule = caractere.toLowerCase();
      const forme = EQUIVALENTS[minuscule] ?? minuscule.normalize("NFD").replace(DIACRITIQUES, "");
      texte += forme;
      for (let k = 0; k < forme.length; k++) origine.push(i);
    }
    i += caractere.length;
  }
  if (texte.endsWith(" ")) {
    texte = texte.slice(0, -1);
    origine.pop();
  }
  return { texte, origine };
}

/* ─── La requête ───────────────────────────────────────────────── */

export interface Requete {
  /** Ce que l'on cherche, normalisé : des mots, ou une seule phrase exacte. */
  termes: string[];
  phrase: boolean;
}

/** La requête tapée, ou `null` s'il n'y a rien d'assez long pour chercher. */
export function analyserRequete(brute: string): Requete | null {
  const { texte } = normaliser(brute);
  const citation = /^"(.*)"$/.exec(texte);
  if (citation) {
    const phrase = citation[1].replaceAll('"', "").trim();
    return phrase.length >= LONGUEUR_MIN ? { termes: [phrase], phrase: true } : null;
  }
  const termes = [...new Set(texte.replaceAll('"', " ").split(" ").filter((t) => t.length >= LONGUEUR_MIN))];
  return termes.length ? { termes, phrase: false } : null;
}

/** Les positions [début, fin[ de chaque terme dans un texte normalisé, triées. */
export function occurrences(normal: string, termes: string[]): [number, number][] {
  const plages: [number, number][] = [];
  for (const terme of termes) {
    for (let depuis = normal.indexOf(terme); depuis >= 0; depuis = normal.indexOf(terme, depuis + terme.length)) {
      plages.push([depuis, depuis + terme.length]);
    }
  }
  return plages.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}

/** Une plage du texte normalisé, ramenée au texte d'origine. */
export function versOrigine(source: string, normal: TexteNormalise, [debut, fin]: [number, number]): [number, number] {
  const derniere = normal.origine[fin - 1];
  return [normal.origine[debut], derniere + String.fromCodePoint(source.codePointAt(derniere)!).length];
}

/* ─── Le Markdown aplati ───────────────────────────────────────── */

const LIEN = /!?\[([^\]\n]*)\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"\n]*")?\s*\)/g;
const LIEN_AUTO = /<((?:https?:\/\/|mailto:)[^>\s]+)>/g;

/**
 * Le texte d'un message tel qu'on le lit : le libellé des liens sans leur
 * syntaxe, sans les marques de mise en forme. Les adresses des liens sont
 * gardées à part : on les cherche aussi.
 */
export function aplatir(markdown: string): { texte: string; adresses: string[] } {
  const adresses: string[] = [];
  const texte = markdown
    .replace(/^ {0,3}(?:```|~~~).*$/gm, "")
    .replace(LIEN, (_, libelle: string, adresse: string) => {
      adresses.push(adresse);
      return libelle;
    })
    .replace(LIEN_AUTO, "$1")
    .replace(/^ {0,3}#{1,6}\s+/gm, "")
    .replace(/^ {0,3}>\s?/gm, "")
    .replace(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?/gm, "")
    .replace(/^[ \t]*\|?[ \t]*:?-{3,}:?[ \t]*(?:\|[ \t]*:?-{3,}:?[ \t]*)*\|?[ \t]*$/gm, "")
    .replace(/\*\*|__|~~|`+/g, "")
    .replace(/(^|[\s(])[*_](?=\S)|(?<=\S)[*_](?=[\s).,;:!?]|$)/gm, "$1")
    .replace(/\|/g, " ")
    .trim();
  return { texte, adresses: [...new Set(adresses)] };
}

/* ─── Les messages et les conversations ────────────────────────── */

export type Portee = "tout" | "agents" | "projets" | "conversation";

/** Une conversation où l'on cherche, avec le titre sous lequel on la reconnaît. */
export interface ConversationCherchable {
  chat: Chat;
  /** `chat.title`, ou le nom de l'agent pour une conversation directe. */
  titre: string;
  /** La date du dernier message, s'il y en a. */
  derniere: string | null;
}

/** Les conversations où l'on cherche : toutes, sauf un fil supprimé (retiré exprès par la personne). */
export function conversationCherchable(chat: Chat): boolean {
  return !chat.fil?.supprime;
}

function dansPortee(chat: Chat, portee: Portee, chatCourant: string | null): boolean {
  if (portee === "agents") return chat.kind === "direct";
  if (portee === "projets") return chat.kind === "equipe";
  if (portee === "conversation") return chatCourant === null || chat.id === chatCourant;
  return true;
}

type Genre = "texte" | "adresse";

/** Un endroit du message où l'on cherche : son texte, ou l'adresse d'un de ses liens. */
interface Champ {
  genre: Genre;
  source: string;
  normal: TexteNormalise;
}

const champ = (genre: Genre, source: string): Champ => ({ genre, source, normal: normaliser(source) });

/** Un message garde le même objet tant qu'il ne change pas : ses champs ne sont calculés qu'une fois. */
const cache = new WeakMap<Message, Champ[]>();

function champsDu(message: Message): Champ[] {
  let champs = cache.get(message);
  if (!champs) {
    const markdown = message.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("\n\n");
    const { texte, adresses } = aplatir(markdown);
    champs = [...(texte ? [champ("texte", texte)] : []), ...adresses.map((a) => champ("adresse", a))];
    cache.set(message, champs);
  }
  return champs;
}

/** Tous les termes sont-ils quelque part dans ces champs ? (Une phrase exacte : dans un même champ.) */
function correspond(champs: Champ[], requete: Requete): boolean {
  return requete.termes.every((t) => champs.some((c) => c.normal.texte.includes(t)));
}

/* ─── L'extrait ────────────────────────────────────────────────── */

/** Un morceau d'extrait : du texte simple, ou une correspondance à surligner. */
export interface Morceau {
  texte: string;
  trouve: boolean;
}

const reduire = (texte: string) => texte.replace(/\s+/gu, " ");

/** Le texte découpé en morceaux, les correspondances à part. */
function decouper(source: string, plages: [number, number][], debut: number, fin: number): Morceau[] {
  const morceaux: Morceau[] = [];
  let curseur = debut;
  for (const [a, b] of plages) {
    if (a >= fin) break;
    if (b <= curseur) continue;
    const de = Math.max(a, curseur);
    if (de > curseur) morceaux.push({ texte: reduire(source.slice(curseur, de)), trouve: false });
    const jusqua = Math.min(b, fin);
    morceaux.push({ texte: reduire(source.slice(de, jusqua)), trouve: true });
    curseur = jusqua;
  }
  if (curseur < fin) morceaux.push({ texte: reduire(source.slice(curseur, fin)), trouve: false });
  return morceaux;
}

/** Le champ découpé, surlignages compris (titre, adresse : en entier). */
export function surligner(source: string, requete: Requete): Morceau[] {
  const normal = normaliser(source);
  const plages = occurrences(normal.texte, requete.termes).map((p) => versOrigine(source, normal, p));
  return decouper(source, plages, 0, source.length);
}

/** L'extrait d'un long texte : centré sur la première correspondance, coupé entre deux mots, « … » aux bords. */
function extraitDe(source: string, plages: [number, number][]): Morceau[] {
  const [premierDebut, premiereFin] = plages[0];
  let debut = Math.max(0, premierDebut - AVANT);
  if (debut > 0) {
    const coupure = source.slice(debut, premierDebut).search(ESPACE);
    debut = coupure >= 0 ? debut + coupure + 1 : premierDebut;
  }
  let fin = Math.min(source.length, Math.max(debut + LONGUEUR_EXTRAIT, premiereFin));
  if (fin < source.length) {
    const reste = source.slice(premiereFin, fin);
    const coupure = Math.max(reste.lastIndexOf(" "), reste.lastIndexOf("\n"));
    if (coupure > 0) fin = premiereFin + coupure;
  }

  const morceaux = decouper(source, plages, debut, fin);
  if (debut > 0) {
    if (morceaux[0].trouve) morceaux.unshift({ texte: "…", trouve: false });
    else morceaux[0].texte = `…${morceaux[0].texte.trimStart()}`;
  }
  if (fin < source.length) {
    const dernier = morceaux[morceaux.length - 1];
    if (dernier.trouve) morceaux.push({ texte: "…", trouve: false });
    else dernier.texte = `${dernier.texte.trimEnd()}…`;
  }
  return morceaux;
}

/** L'extrait d'un message trouvé : dans son texte d'abord, sinon l'adresse du lien. */
function extraitDu(champs: Champ[], requete: Requete): { genre: Genre; extrait: Morceau[] } {
  for (const c of champs) {
    const plages = occurrences(c.normal.texte, requete.termes);
    if (!plages.length) continue;
    const reelles = plages.map((p) => versOrigine(c.source, c.normal, p));
    return { genre: c.genre, extrait: c.genre === "texte" ? extraitDe(c.source, reelles) : decouper(c.source, reelles, 0, c.source.length) };
  }
  return { genre: "texte", extrait: [] };
}

/* ─── Chercher ─────────────────────────────────────────────────── */

export interface ResultatMessage {
  message: Message;
  conversation: ConversationCherchable;
  /** Où l'on a trouvé : dans le texte, ou seulement dans l'adresse d'un lien (l'extrait montre alors l'adresse). */
  genre: Genre;
  extrait: Morceau[];
}

export interface ResultatConversation {
  conversation: ConversationCherchable;
  titre: Morceau[];
}

export interface Recherche {
  requete: Requete;
  conversations: ResultatConversation[];
  messages: ResultatMessage[];
  /** Le nombre de messages trouvés, au-delà de `LIMITE` aussi. */
  totalMessages: number;
  /** Les résultats de chaque portée : conversations montrées et messages trouvés. */
  parPortee: Record<Portee, number>;
}

/**
 * Cherche `brute` dans `messages`, rangés dans `conversations` ; `null` s'il n'y a
 * rien d'assez long à chercher. `chatCourant` : la conversation ouverte, pour la
 * portée « Cette conversation » (sans elle, la portée revient à tout).
 */
export function chercher(
  conversations: ConversationCherchable[],
  messages: Message[],
  brute: string,
  portee: Portee = "tout",
  chatCourant: string | null = null,
  limite = LIMITE,
): Recherche | null {
  const requete = analyserRequete(brute);
  if (!requete) return null;
  const parId = new Map(conversations.filter((c) => conversationCherchable(c.chat)).map((c) => [c.chat.id, c]));
  const cherchees = [...parId.values()];

  const titres = cherchees
    .filter((c) => correspond([champ("texte", c.titre)], requete))
    .sort((a, b) => (b.derniere ?? "").localeCompare(a.derniere ?? ""));
  const trouves: { message: Message; conversation: ConversationCherchable; champs: Champ[] }[] = [];
  for (const message of messages) {
    if (message.statut === "en-cours") continue;
    const conversation = parId.get(message.chatId);
    if (!conversation) continue;
    const champs = champsDu(message);
    if (champs.length && correspond(champs, requete)) trouves.push({ message, conversation, champs });
  }
  trouves.sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt) || a.message.id.localeCompare(b.message.id));

  const compter = (p: Portee) => {
    const ici = (c: ConversationCherchable) => dansPortee(c.chat, p, chatCourant);
    const nbTitres = p === "conversation" ? 0 : Math.min(CONVERSATIONS_MAX, titres.filter(ici).length);
    return nbTitres + trouves.filter((t) => ici(t.conversation)).length;
  };
  const parPortee: Record<Portee, number> = {
    tout: compter("tout"),
    agents: compter("agents"),
    projets: compter("projets"),
    conversation: chatCourant ? compter("conversation") : 0,
  };

  const effective: Portee = portee === "conversation" && !chatCourant ? "tout" : portee;
  const ici = (c: ConversationCherchable) => dansPortee(c.chat, effective, chatCourant);
  const retenus = trouves.filter((t) => ici(t.conversation));
  return {
    requete,
    conversations:
      effective === "conversation"
        ? []
        : titres
            .filter(ici)
            .slice(0, CONVERSATIONS_MAX)
            .map((conversation) => ({ conversation, titre: surligner(conversation.titre, requete) })),
    messages: retenus.slice(0, limite).map(({ message, conversation, champs }) => ({
      message,
      conversation,
      ...extraitDu(champs, requete),
    })),
    totalMessages: retenus.length,
    parPortee,
  };
}
