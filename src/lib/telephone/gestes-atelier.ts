import {
  appliquerAjouts,
  casEpreuve,
  comparable,
  ficheAgent,
  identifiantPropose,
  manques,
  plierAteliers,
  type EtatAtelier,
} from "@/lib/atelier-agent";
import { jouerEpreuve, type EssayerAtelier, type MarquerAtelier } from "@/lib/epreuve-atelier";
import { nomDejaPris } from "@/lib/noms-agents";
import { chaine, ErreurPoste, objet, type Gestes } from "@/lib/poste/types";
import { ROLE_TEINTES, type Message, type Role, type RoleTeinte } from "@/types/domain";
import type { TypeCas } from "../../../electron/epreuve";

/**
 * L'atelier d'un agent depuis le téléphone (gestes `atelier.*`, faits par l'ordinateur ouvert) :
 * choisir sa couleur, lancer son épreuve, ajouter une correction à sa fiche, le créer. Le téléphone
 * n'envoie que la conversation et l'appel de l'atelier (`etapeId`) : la carte est repliée ici, depuis
 * la conversation de l'ordinateur, jamais d'après ce que le téléphone a affiché. Mêmes règles que la
 * carte du bureau (src/components/chat/CarteAtelier.tsx).
 */

export interface DepsAtelier {
  /** Les messages de la conversation ; null : elle n'est plus sur l'ordinateur. */
  messages: (conversation: string) => Message[] | null;
  /** La machine de la conversation (VPS) : l'épreuve y tourne. */
  lieu: (conversation: string) => string | null;
  /** Les agents actifs (l'assistant compris). */
  roles: Role[];
  identifiantLibre: (propose: string) => string;
  create: (id: string, content: string, reglage: { tag: string; teinte: RoleTeinte }) => Promise<void>;
  marquer: MarquerAtelier;
  /** L'essai par Claude Code ; null hors de l'app de bureau. */
  essayer: EssayerAtelier | null;
  teinteDe: (id: string) => RoleTeinte;
}

const TYPES_CAS: TypeCas[] = ["normal", "floue", "hors-metier"];

interface Carte {
  conversation: string;
  etapeId: string;
  messageId: string;
  etat: EtatAtelier;
}

export function gestesAtelier(d: DepsAtelier): Gestes {
  /** La carte en cours de la conversation, relue sur l'ordinateur ; refusée si elle n'est plus la dernière. */
  const carteDe = (args: Record<string, unknown>): Carte => {
    const conversation = chaine(args, "conversation", 200);
    const etapeId = chaine(args, "etapeId", 200);
    const messages = d.messages(conversation);
    if (!messages) throw new ErreurPoste("conversation_absente", "Cette conversation n’est plus sur l’ordinateur.");
    const etat = plierAteliers(messages).get(etapeId);
    const message = messages.find((m) => m.parts.some((p) => p.type === "atelier-agent" && p.etapeId === etapeId));
    if (!etat || !message) throw new ErreurPoste("carte_absente", "Cette carte n’existe plus.");
    if (!etat.dernier || (!etat.courante && !etat.cree)) throw new ErreurPoste("remplacee", "L’assistant a écrit une carte plus récente : agis sur celle-ci.");
    return { conversation, etapeId, messageId: message.id, etat };
  };

  /** Créé depuis cette carte, ou déjà dans l'équipe sous ce nom (comme au bureau). */
  const creeDe = (etat: EtatAtelier) => {
    const b = etat.apres;
    return etat.cree ?? d.roles.find((r) => r.id === identifiantPropose(b) && comparable(r.name) === comparable(b.nom))?.id ?? null;
  };

  const modifiable = (c: Carte) => {
    if (creeDe(c.etat)) throw new ErreurPoste("deja_cree", "Cet agent est déjà dans ton équipe.");
    if (c.etat.provisoire) throw new ErreurPoste("provisoire", "L’assistant écrit encore sa carte.");
  };

  const lancer = (c: Carte, b: EtatAtelier["apres"], ajouts: EtatAtelier["ajouts"], types: TypeCas[]) => {
    const essayer = d.essayer;
    if (!essayer) throw new ErreurPoste("indisponible", "L’épreuve se lance avec Claude Code, dans l’app de bureau.");
    const cas = casEpreuve(b)?.filter((x) => types.includes(x.type)) ?? [];
    if (!cas.length) throw new ErreurPoste("sans_epreuve", "L’assistant n’a pas encore proposé de demandes pour l’épreuve.");
    if (cas.some((x) => c.etat.essais.includes(x.type))) throw new ErreurPoste("en_cours", "L’épreuve tourne déjà.");
    /* Plusieurs minutes : l'ordinateur répond tout de suite, les résultats arrivent sur la carte (copie du compte). */
    void jouerEpreuve(essayer, d.marquer, {
      b,
      id: identifiantPropose(b),
      cas,
      ajouts,
      lieu: d.lieu(c.conversation),
      conversation: c.conversation,
      messageId: c.messageId,
      etapeId: c.etapeId,
      depart: c.etat.resultats ?? [],
    });
  };

  return {
    "atelier.teinte": async (args) => {
      const a = objet(args);
      const teinte = chaine(a, "teinte", 20);
      if (!(ROLE_TEINTES as readonly string[]).includes(teinte)) throw new ErreurPoste("arguments", "Demande illisible.");
      const c = carteDe(a);
      modifiable(c);
      d.marquer(c.messageId, c.etapeId, { teinte: teinte as RoleTeinte });
      return { ok: true };
    },

    "atelier.essayer": async (args) => {
      const c = carteDe(objet(args));
      modifiable(c);
      const manque = manques(c.etat.apres);
      if (manque.length) throw new ErreurPoste("incomplet", `Il lui manque ${manque.join(", ")}.`);
      lancer(c, c.etat.apres, c.etat.ajouts, TYPES_CAS);
      return { ok: true };
    },

    "atelier.corriger": async (args) => {
      const a = objet(args);
      const type = chaine(a, "type", 20) as TypeCas;
      if (!TYPES_CAS.includes(type)) throw new ErreurPoste("arguments", "Demande illisible.");
      const c = carteDe(a);
      modifiable(c);
      const correction = c.etat.resultats?.find((r) => r.type === type && r.verdict === "ko")?.correction ?? null;
      if (!correction) throw new ErreurPoste("sans_correction", "Cet essai n’a plus de correction à ajouter.");
      if (c.etat.ajouts.some((x) => comparable(x.texte) === comparable(correction.texte))) throw new ErreurPoste("deja_ajoutee", "Cette phrase est déjà dans sa fiche.");
      if (c.etat.essais.includes(type)) throw new ErreurPoste("en_cours", "Cet essai tourne déjà.");
      d.marquer(c.messageId, c.etapeId, (part) => ({ ajouts: [...(part.ajouts ?? []), correction] }));
      lancer(c, appliquerAjouts(c.etat.apres, [correction]), [...c.etat.ajouts, correction], [type]);
      return { ok: true };
    },

    "atelier.creer": async (args) => {
      const c = carteDe(objet(args));
      modifiable(c);
      const b = c.etat.apres;
      const manque = manques(b);
      if (manque.length) throw new ErreurPoste("incomplet", `Il lui manque ${manque.join(", ")}.`);
      const pris = nomDejaPris(b.nom, d.roles);
      if (pris) throw new ErreurPoste("nom_pris", `Tu as déjà un agent qui s’appelle ${pris.name} : demande un autre prénom.`);
      const propose = identifiantPropose(b);
      const id = d.identifiantLibre(propose);
      const teinte = c.etat.teinte ?? d.teinteDe(propose);
      await d.create(id, ficheAgent(b, id), { tag: b.role, teinte });
      d.marquer(c.messageId, c.etapeId, { cree: id });
      return { id };
    },
  };
}
