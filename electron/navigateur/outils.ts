import { readConversations } from "../conversations";
import { lireReglages } from "../reglages";
import {
  apresAction,
  appuyer,
  attendreCalme,
  attendreTexte,
  capturer,
  choisir,
  cliquer,
  connexionsDeLOnglet,
  defiler,
  envoyerFichiers,
  fermerOnglet,
  lireInstantane,
  lireTexte,
  ongletPourAgent,
  ongletsDe,
  ouvrirOnglet,
  pageDeLAgent,
  passerLaMain,
  prendreNotes,
  remplirConnexion,
  survoler,
  taper,
  viser,
} from "./navigateur";
import { consigneNavigateurTexte, estOutilNavigateur, OUTILS_NAVIGATEUR, OUTILS_NAVIGATEUR_LECTURE } from "./definitions";
import { formaterInstantane, normaliserAdresse, trancheTexte } from "./regles";

export { estOutilNavigateur, OUTILS_NAVIGATEUR, OUTILS_NAVIGATEUR_LECTURE };

/**
 * Les outils du navigateur de KLYRA pour les agents (serveur MCP local de
 * l'app, `ia.ts`). Cinq outils seulement, aux descriptions courtes : ils sont
 * relus à chaque appel. Une action rend un état court ; la page se lit avec
 * `navigateur_lire` (ou `relire`), comme dans OpenBot.
 */

export const navigateurActif = (): boolean => lireReglages().navigateur.agents;

/** Ce qui change les outils donnés aux agents : une conversation ouverte se relance quand ça change. */
export const signatureNavigateur = (): string => (navigateurActif() ? "navigateur" : "");

/** La consigne, seulement quand les outils sont là. */
export function consigneNavigateur(): string | null {
  return navigateurActif() ? consigneNavigateurTexte() : null;
}

type Contenu = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
export interface ResultatOutil {
  content: Contenu[];
  isError?: boolean;
}

const texte = (t: string, isError = false): ResultatOutil => ({ content: [{ type: "text", text: t }], ...(isError ? { isError: true } : {}) });
const chaine = (v: unknown): string => (typeof v === "string" ? v : "");
const nombre = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);

function avecNotes(lignes: string[], notes: string[]): string {
  return [...lignes, ...(notes.length ? ["", ...notes] : [])].join("\n");
}

/** Exécute un outil du navigateur pour un agent, dans sa conversation. */
export async function executerOutilNavigateur(nom: string, args: Record<string, unknown>, appelant: { chatId: string; roleId: string }): Promise<ResultatOutil> {
  if (!navigateurActif()) return texte("Le navigateur de KLYRA est coupé pour les agents (Réglages › Navigateur).", true);
  if (!appelant.chatId) return texte("Conversation inconnue : le navigateur de KLYRA n'est utilisable que depuis une conversation.", true);
  try {
    switch (nom) {
      case "navigateur_onglets": {
        if (chaine(args.fermer)) {
          ongletPourAgent(appelant.chatId, args.fermer);
          fermerOnglet(chaine(args.fermer));
        }
        const liste = ongletsDe(appelant.chatId);
        if (!liste.length) return texte("Aucun onglet dans cette conversation. Ouvre une page avec navigateur_aller.");
        return texte(
          liste
            .map((o) => {
              const main = o.main?.type === "personne" ? " · la personne a la main" : o.main?.type === "demandee" ? " · main passée à la personne" : "";
              return `${o.id} : ${o.titre} — ${o.url}${o.chargement ? " · chargement" : ""}${o.erreur ? ` · erreur : ${o.erreur}` : ""}${main}`;
            })
            .join("\n"),
        );
      }
      case "navigateur_aller": {
        const url = chaine(args.url).trim();
        const geste = chaine(args.historique);
        if (!url && !geste) return texte("Donne une adresse (url) ou un geste (historique).", true);
        const existant = ongletsDe(appelant.chatId).length > 0;
        const nouveau = !!url && (args.nouvel_onglet === true || !existant) && !chaine(args.onglet);
        const o = nouveau ? ouvrirOnglet(appelant.chatId, url) : ongletPourAgent(appelant.chatId, args.onglet);
        const wc = pageDeLAgent(o, appelant.roleId, url ? `Ouvre ${url}` : geste, true);
        if (url && !nouveau) void wc.loadURL(normaliserAdresse(url)).catch(() => undefined);
        else if (geste === "retour") wc.navigationHistory.goBack();
        else if (geste === "suivant") wc.navigationHistory.goForward();
        else if (geste === "recharger") wc.reload();
        await attendreCalme(wc);
        apresAction(o);
        if (o.erreur) return texte(avecNotes([`Onglet ${o.id} : ${o.erreur} — ${o.url}`], prendreNotes(o)), true);
        const page = formaterInstantane(await lireInstantane(o, wc));
        return texte(avecNotes([`Onglet ${o.id}.`, page], prendreNotes(o)));
      }
      case "navigateur_lire": {
        const o = ongletPourAgent(appelant.chatId, args.onglet);
        const wc = pageDeLAgent(o, appelant.roleId, "Lit la page", false);
        await attendreCalme(wc, 8_000);
        const attendu = chaine(args.attendre_texte).trim();
        const trouve = attendu ? await attendreTexte(wc, attendu, 15_000) : true;
        const debut = attendu && !trouve ? [`« ${attendu} » n'est pas apparu en 15 s.`] : [];
        if (args.mode === "texte") {
          const t = await lireTexte(wc);
          return texte(avecNotes([...debut, `Onglet ${o.id} : ${o.titre} — ${o.url}`, "", trancheTexte(t, nombre(args.depuis) ?? 0)], prendreNotes(o)));
        }
        const page = formaterInstantane(await lireInstantane(o, wc), { requete: chaine(args.requete) });
        const coffre = connexionsDeLOnglet(o, true);
        const indice = coffre.length
          ? [`Coffre : ${coffre.length > 1 ? "connexions enregistrées" : "une connexion enregistrée"} pour ${[...new Set(coffre.map((c) => c.hote))].join(", ")} (${coffre.map((c) => c.identifiant || "sans identifiant").join(", ")}) : navigateur_agir, action remplir_connexion.`]
          : [];
        return texte(avecNotes([...debut, `Onglet ${o.id}.`, page, ...(indice.length ? ["", ...indice] : [])], prendreNotes(o)));
      }
      case "navigateur_capture": {
        const o = ongletPourAgent(appelant.chatId, args.onglet);
        const wc = pageDeLAgent(o, appelant.roleId, "Regarde la page", false);
        const c = await capturer(o, wc);
        return {
          content: [
            { type: "image", data: c.base64, mimeType: "image/jpeg" },
            { type: "text", text: `Onglet ${o.id} : ${o.titre} — ${o.url}. Capture ${c.largeur}×${c.hauteur} px${c.echelle !== 1 ? ` (page réduite ×${(1 / c.echelle).toFixed(2)})` : ""} : x et y de navigateur_agir sont en pixels de cette image.` },
          ],
        };
      }
      case "navigateur_agir":
        return await agir(args, appelant);
      default:
        return texte("Outil inconnu.", true);
    }
  } catch (e) {
    return texte(e instanceof Error ? e.message : String(e), true);
  }
}

async function agir(args: Record<string, unknown>, appelant: { chatId: string; roleId: string }): Promise<ResultatOutil> {
  const action = chaine(args.action);
  const o = ongletPourAgent(appelant.chatId, args.onglet);
  if (action === "passer_la_main") {
    const raison = chaine(args.raison).trim() || "à toi de jouer dans cet onglet";
    passerLaMain(o, appelant.roleId, raison);
    return texte(`La personne voit ta demande sur l'onglet ${o.id} (« ${raison} »). Dis-lui dans ta réponse ce qu'elle doit faire, puis termine ton tour : elle te dira quand c'est fait.`);
  }
  const ref = chaine(args.ref) || undefined;
  const libelle: Record<string, string> = {
    cliquer: "Clique",
    double_clic: "Double-clique",
    clic_droit: "Clic droit",
    survoler: "Survole",
    taper: "Tape",
    touche: `Appuie sur ${chaine(args.touche)}`,
    defiler: "Fait défiler",
    choisir: `Choisit « ${chaine(args.valeur)} »`,
    envoyer_fichiers: "Envoie des fichiers",
    remplir_connexion: "Remplit la connexion",
  };
  if (!libelle[action]) return texte("Action inconnue.", true);
  const wc = pageDeLAgent(o, appelant.roleId, libelle[action], true);
  let fait = libelle[action];
  let note: string | null = null;

  switch (action) {
    case "cliquer":
    case "double_clic":
    case "clic_droit":
    case "survoler": {
      const c = await viser(o, wc, { ref, x: nombre(args.x), y: nombre(args.y) });
      note = c.note;
      if (action === "survoler") await survoler(wc, c.x, c.y);
      else await cliquer(wc, c.x, c.y, { double: action === "double_clic", bouton: action === "clic_droit" ? "right" : "left" });
      fait = `${libelle[action]} ${ref ? `sur ${ref}` : `en ${c.x},${c.y}`}`;
      break;
    }
    case "taper": {
      const t = typeof args.texte === "string" ? args.texte : "";
      if (!ref && (nombre(args.x) !== undefined || nombre(args.y) !== undefined)) {
        const c = await viser(o, wc, { x: nombre(args.x), y: nombre(args.y) });
        await cliquer(wc, c.x, c.y);
      }
      note = await taper(o, wc, ref ?? null, t, args.effacer === true);
      if (args.entree === true) await appuyer(wc, "Enter");
      fait = `Tapé ${t.length} caractère${t.length > 1 ? "s" : ""}${ref ? ` dans ${ref}` : ""}${args.entree === true ? ", puis Entrée" : ""}`;
      break;
    }
    case "touche":
      if (!chaine(args.touche)) return texte("Donne la touche (ex. Enter, Tab, Escape, Control+A).", true);
      await appuyer(wc, chaine(args.touche));
      fait = `Appuyé sur ${chaine(args.touche)}`;
      break;
    case "defiler": {
      const dir = chaine(args.direction) || "bas";
      const q = nombre(args.quantite) ?? 600;
      const dx = dir === "droite" ? q : dir === "gauche" ? -q : 0;
      const dy = dir === "bas" ? q : dir === "haut" ? -q : 0;
      const r = await defiler(o, wc, ref ?? null, dx, dy);
      fait = r.bouge ? `Défilé vers le ${dir} (à ${Math.round(r.y)} sur ${Math.round(r.max)} px)` : `Rien n'a défilé (déjà au bout : ${Math.round(r.y)} sur ${Math.round(r.max)} px)`;
      break;
    }
    case "envoyer_fichiers":
      if (!ref) return texte("Donne la référence (ref) du champ ou du bouton qui joint les fichiers.", true);
      fait = await envoyerFichiers(o, wc, ref, args.chemins);
      break;
    case "remplir_connexion":
      fait = await remplirConnexion(o, wc, {
        identifiant: chaine(args.identifiant) || null,
        refMotDePasse: ref ?? null,
        refIdentifiant: chaine(args.ref_identifiant) || null,
        valider: args.valider === true,
        parAgent: true,
      });
      break;
    case "choisir":
      if (!ref) return texte("Donne la référence (ref) de la liste.", true);
      fait = `Choisi « ${await choisir(o, wc, ref, chaine(args.valeur))} » dans ${ref}`;
      break;
  }

  await attendreCalme(wc, 10_000);
  apresAction(o);
  const lignes = [`${fait}. Page : ${wc.getTitle() || o.titre} — ${wc.getURL() || o.url}${o.erreur ? ` · erreur : ${o.erreur}` : ""}`];
  if (note) lignes.push(note);
  if (args.relire === true) lignes.push("", formaterInstantane(await lireInstantane(o, wc)));
  return texte(avecNotes(lignes, prendreNotes(o)));
}

/**
 * Un outil appelé par un agent d'un VPS relié (cf. agents-distants.ts et serveur/navigateur.mjs) :
 * exécuté ici seulement pour une conversation de ce serveur, dans ses onglets.
 */
export async function executerPourServeur(origine: string, appel: { nom: string; arguments: Record<string, unknown>; agent: string; conversation: string }): Promise<ResultatOutil> {
  const donnees = (await readConversations().catch(() => null)) as { chats?: { id?: unknown; lieu?: unknown }[] } | null;
  const chat = donnees?.chats?.find((c) => c.id === appel.conversation);
  if (!chat || chat.lieu !== origine) return texte("Cette conversation n’est pas une conversation de ce serveur sur l’ordinateur de la personne.", true);
  return executerOutilNavigateur(appel.nom, appel.arguments, { chatId: appel.conversation, roleId: appel.agent });
}
