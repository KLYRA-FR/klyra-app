import { nomFichier } from "@/lib/fichiers";
import { formatDateComplete, formatTime } from "@/lib/format";
import { DEPART_ROUTINE } from "@/lib/message-routine";
import type { Chat, Message, MessagePart, Project, Role, User } from "@/types/domain";

export interface InstantaneExport {
  chat: Chat;
  messages: readonly Message[];
  moi: Pick<User, "name">;
  roles: readonly Pick<Role, "id" | "name" | "title">[];
  project?: Pick<Project, "name">;
  maintenant: Date;
}

export interface DocumentConversation {
  contenu: string;
  nomPropose: string;
}

const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const graphemes = new Intl.Segmenter("fr", { granularity: "grapheme" });
const uneLigne = (texte: string): string => texte.replace(/\s+/g, " ").trim();
const echapper = (texte: string): string => uneLigne(texte).replace(/([\\`*_[\]<>#|~])/g, "\\$1");

/** Une limite de caractères visibles, sans couper une paire de substitution ni un emoji composé. */
function couper(texte: string, limite: number): string {
  let resultat = "";
  let compte = 0;
  for (const { segment } of graphemes.segment(texte)) {
    if (compte++ === limite) break;
    resultat += segment;
  }
  return resultat;
}

/** Nom suggéré uniquement : le fichier sera écrit au chemin choisi dans le sélecteur. */
export function nomExport(base: string, maintenant: Date): string {
  const propre = uneLigne(base.replace(/[\u0000-\u001f\u007f-\u009f/\\:*?"<>|]/g, " ")).replace(/^[.\s]+/, "");
  // CON devient valide avec la date, mais CON.txt reste un périphérique Windows même avec ce suffixe.
  const sur = /^(?:CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])\./i.test(propre) ? `Conversation ${propre}` : propre;
  const court = couper(sur, 80).replace(/[.\s]+$/, "") || "Conversation";
  const deux = (n: number) => String(n).padStart(2, "0");
  const date = `${maintenant.getFullYear()}-${deux(maintenant.getMonth() + 1)}-${deux(maintenant.getDate())}`;
  return `${court} - ${date}.md`;
}

/** Termine un bloc interrompu pour que les métadonnées et le message suivant restent hors du code. */
export function fermerCode(texte: string): string {
  let ouvert: { retrait: string; marque: string } | null = null;
  for (const ligne of texte.split("\n")) {
    if (!ouvert) {
      const debut = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(ligne);
      if (debut && !(debut[2][0] === "`" && debut[3].includes("`"))) {
        ouvert = { retrait: debut[1], marque: debut[2] };
      }
    } else {
      const fin = /^( {0,3})(`{3,}|~{3,})\s*$/.exec(ligne);
      if (fin && fin[2][0] === ouvert.marque[0] && fin[2].length >= ouvert.marque.length) ouvert = null;
    }
  }
  return ouvert ? `${texte}\n${ouvert.retrait}${ouvert.marque}` : texte;
}

function texteOriginal(texte: string): string {
  // Garder notamment le retrait de la première ligne non vide et les espaces à l'intérieur du code.
  return texte.replace(/\r\n/g, "\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd();
}

function nomEnCode(chemin: string): string {
  const nom = nomFichier(chemin);
  const longueur = Math.max(0, ...(nom.match(/`+/g) ?? []).map((suite) => suite.length));
  const marque = "`".repeat(longueur + 1);
  return longueur ? `${marque} ${nom} ${marque}` : `${marque}${nom}${marque}`;
}

type AgentExport = Pick<Role, "id" | "name" | "title">;
type TrouverAgent = (id: string) => AgentExport;

function blocLisible(part: Exclude<MessagePart, { type: "text" }>, agent: TrouverAgent): string | null {
  switch (part.type) {
    case "fichiers":
      return part.chemins.length
        ? `${part.chemins.length === 1 ? "Pièce jointe" : "Pièces jointes"} : ${part.chemins.map(nomEnCode).join(", ")}`
        : null;
    case "passation": {
      const libelle = { "en-cours": "Confié à", fait: "Rendu par", erreur: "Arrêté chez" }[part.statut];
      const consigne = uneLigne(part.consigne);
      const debut = couper(consigne, 200);
      const court = debut.length < consigne.length ? `${debut}…` : debut;
      return `_${libelle} ${echapper(agent(part.roleId).name)}${court ? ` · ${echapper(court)}` : ""}_`;
    }
    case "proposition-agent": {
      const { nom, role, description } = part.proposition;
      const entete = `_Proposition d’agent : ${echapper(nom)}${uneLigne(role) ? ` · ${echapper(role)}` : ""}_`;
      return uneLigne(description) ? `${entete}\n\n> ${echapper(description)}` : entete;
    }
    default:
      // Étapes, permissions et anciens blocs de démonstration ne sont pas le texte de la conversation.
      return null;
  }
}

function corpsMessage(message: Message, agent: TrouverAgent, prefixeRoutine: number): string | null {
  const blocs: string[] = [];
  let textes: string[] = [];
  const finirTextes = () => {
    if (textes.length) blocs.push(fermerCode(textes.join("\n\n")));
    textes = [];
  };
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      const brut = part.text.replace(/\r\n/g, "\n");
      const texte = texteOriginal(index === 0 ? brut.slice(prefixeRoutine) : brut);
      if (texte.trim()) textes.push(texte);
      return;
    }
    const bloc = blocLisible(part, agent);
    if (bloc) {
      finirTextes();
      blocs.push(bloc);
    }
  });
  finirTextes();
  if (message.statut === "erreur") blocs.push("_L’agent s’est arrêté sur une erreur._");
  else if (message.statut === "en-cours" && blocs.length) blocs.push("_Réponse en cours d’écriture au moment de l’export._");
  return blocs.length ? blocs.join("\n\n") : null;
}

/** Document en mémoire seulement ; aucun tri, accès au disque ni mutation des données reçues. */
export function preparerExport({ chat, messages, moi, roles, project, maintenant }: InstantaneExport): DocumentConversation | null {
  const agent: TrouverAgent = (id) => roles.find((role) => role.id === id) ?? {
    id, name: id, title: "Agent introuvable sur ce poste",
  };
  const participants = new Map<string, string>();
  const rendus: string[] = [];
  for (const message of messages) {
    if (message.chatId !== chat.id) continue;
    const premier = message.parts[0];
    const routine = message.author.kind === "user" && premier?.type === "text"
      ? DEPART_ROUTINE.exec(premier.text.replace(/\r\n/g, "\n")) : null;
    const corps = corpsMessage(message, agent, routine?.[0].length ?? 0);
    if (corps === null) continue;
    let auteur: string;
    if (routine) {
      auteur = `Routine « ${routine[1]} »`;
      participants.set(`routine:${routine[1]}`, echapper(auteur));
    } else if (message.author.kind === "user") {
      auteur = moi.name.trim() || "Moi";
      participants.set("user", echapper(auteur));
    } else {
      const role = agent(message.author.roleId);
      auteur = role.name;
      participants.set(`role:${role.id}`, `${echapper(role.name)} (${echapper(role.title)})`);
    }
    const date = new Date(message.createdAt);
    const quand = Number.isFinite(date.getTime()) ? ` · ${jour.format(date)} à ${formatTime(message.createdAt)}` : "";
    rendus.push(`---\n\n**${echapper(auteur)}**${quand}\n\n${corps}`);
  }
  if (!rendus.length) return null;
  const avec = agent(chat.roleIds[0] ?? "principal");
  const titre = chat.kind === "direct" && !chat.fil ? `Conversation avec ${avec.name}` : chat.title;
  const contexte: string[] = [];
  if (chat.fil) contexte.push(`- Fil avec ${echapper(avec.name)}`);
  else if (chat.kind === "equipe" && project) contexte.push(`- Projet : ${echapper(project.name)}`);
  contexte.push(`- Participants : ${[...participants.values()].join(", ")}`);
  contexte.push(`- Exporté depuis KLYRA le ${formatDateComplete(maintenant.toISOString())}`);
  return {
    contenu: `# ${echapper(titre)}\n\n${contexte.join("\n")}\n\n${rendus.join("\n\n")}\n`,
    nomPropose: nomExport(titre, maintenant),
  };
}
