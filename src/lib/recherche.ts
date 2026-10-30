import type { Chat, Message } from "@/types/domain";

/**
 * Rechercher dans les conversations de ce poste : équipe, directes et fils.
 * Tout se passe en mémoire, sur les messages déjà chargés par l'app : pas
 * d'index sur le disque, pas de service, rien ne quitte le poste. Le résultat
 * suit donc l'état courant (message modifié, conversation vidée).
 *
 * La règle :
 * - on cherche dans le texte des messages (le tien et celui des agents), le même
 *   que « Copier » (`texteDe`) : ni les pièces jointes, ni les étapes de travail ;
 * - accents, majuscules, ligatures (œ, æ), apostrophes et guillemets typographiques,
 *   espaces insécables et retours à la ligne ne comptent pas ;
 * - plusieurs mots : chacun doit être dans le message, dans n'importe quel ordre,
 *   même au milieu d'un mot (« factur » trouve « facture ») ; un lien est un mot ;
 * - entre guillemets : la phrase exacte, mots dans l'ordre ;
 * - la requête n'est jamais interprétée (ni expression régulière, ni HTML, ni commande) ;
 * - les plus récents d'abord, `LIMITE` au plus, avec le nombre total.
 */

/** En dessous, on ne cherche pas : une lettre trouve presque tout. */
export const LONGUEUR_MIN = 2;
/** Les résultats montrés au plus ; le total est donné à part. */
export const LIMITE = 100;
/** L'extrait : un peu de contexte avant la première correspondance, le reste après. */
const AVANT = 40;
const LONGUEUR_EXTRAIT = 160;

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

/** Le texte tel qu'on le compare : minuscules, sans accents, espaces réduits à un seul. */
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

export interface Requete {
  /** Ce que l'on cherche, normalisé : des mots, ou une seule phrase exacte. */
  termes: string[];
  phrase: boolean;
}

/** La requête tapée, ou `null` si elle est trop courte pour chercher. */
export function analyserRequete(brute: string): Requete | null {
  const { texte } = normaliser(brute);
  const citation = /^"(.*)"$/.exec(texte);
  if (citation) {
    const phrase = citation[1].replaceAll('"', "").trim();
    return phrase.length >= LONGUEUR_MIN ? { termes: [phrase], phrase: true } : null;
  }
  const termes = [...new Set(texte.replaceAll('"', " ").split(" ").filter(Boolean))];
  return termes.join(" ").length >= LONGUEUR_MIN ? { termes, phrase: false } : null;
}

/** Un morceau de l'extrait : du texte simple, ou une correspondance à surligner. */
export interface Morceau {
  texte: string;
  trouve: boolean;
}

export interface Resultat {
  message: Message;
  chat: Chat;
  /** L'extrait autour de la première correspondance, espaces réduits, « … » quand il est coupé. */
  extrait: Morceau[];
}

export interface Recherche {
  resultats: Resultat[];
  /** Le nombre de messages trouvés, au-delà de `LIMITE` aussi. */
  total: number;
}

/** Un message garde le même objet tant qu'il ne change pas : son texte normalisé n'est calculé qu'une fois. */
const cache = new WeakMap<Message, { source: string; normal: TexteNormalise }>();

function texteDuMessage(message: Message): { source: string; normal: TexteNormalise } {
  let entree = cache.get(message);
  if (!entree) {
    const source = message.parts
      .flatMap((p) => (p.type === "text" ? [p.text] : []))
      .join("\n\n")
      .trim();
    entree = { source, normal: normaliser(source) };
    cache.set(message, entree);
  }
  return entree;
}

/** Les conversations où l'on cherche : toutes, sauf un fil supprimé (retiré de la liste par la personne). */
export function conversationCherchable(chat: Chat): boolean {
  return !chat.fil?.supprime;
}

/** Les positions [début, fin[ de chaque terme dans le texte normalisé, ou `null` s'il en manque un. */
function correspondances(normal: string, requete: Requete): [number, number][] | null {
  const plages: [number, number][] = [];
  for (const terme of requete.termes) {
    let depuis = normal.indexOf(terme);
    if (depuis < 0) return null;
    while (depuis >= 0) {
      plages.push([depuis, depuis + terme.length]);
      depuis = normal.indexOf(terme, depuis + terme.length);
    }
  }
  return plages.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
}

/** Une plage du texte normalisé, ramenée au texte d'origine. */
function versOrigine(source: string, normal: TexteNormalise, [debut, fin]: [number, number]): [number, number] {
  const derniere = normal.origine[fin - 1];
  return [normal.origine[debut], derniere + String.fromCodePoint(source.codePointAt(derniere)!).length];
}

const reduire = (texte: string) => texte.replace(/\s+/gu, " ");

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

/** Cherche `brute` dans les messages de `chats` ; `null` si la requête est trop courte. */
export function rechercher(brute: string, chats: Chat[], messages: Message[], limite = LIMITE): Recherche | null {
  const requete = analyserRequete(brute);
  if (!requete) return null;
  const parId = new Map(chats.filter(conversationCherchable).map((c) => [c.id, c]));
  const trouves: { message: Message; chat: Chat; source: string; normal: TexteNormalise; plages: [number, number][] }[] = [];
  for (const message of messages) {
    const chat = parId.get(message.chatId);
    if (!chat) continue;
    const { source, normal } = texteDuMessage(message);
    if (!source) continue;
    const plages = correspondances(normal.texte, requete);
    if (plages) trouves.push({ message, chat, source, normal, plages });
  }
  trouves.sort((a, b) => b.message.createdAt.localeCompare(a.message.createdAt) || a.message.id.localeCompare(b.message.id));
  return {
    total: trouves.length,
    resultats: trouves.slice(0, limite).map(({ message, chat, source, normal, plages }) => ({
      message,
      chat,
      extrait: extraitDe(source, plages.map((p) => versOrigine(source, normal, p))),
    })),
  };
}
