import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ingererMessageFil, marquerTravailFil, ouvrirTravailFil, placesLibres, travailDuFil, type ContexteCycle } from "./cycle";
import type { Effet } from "./operations";
import type { MessageNatif } from "./ingestion";
import { lireTravail } from "./travaux";

/**
 * Les outils des fils (`ouvrir_fil`, `lister_fils`, `lire_fil`, `ecrire_dans_fil`) vus par le journal.
 * L'écran les exécute dans `workspace.tsx` et appelle les mêmes fonctions de `cycle.ts`.
 * Ici, un registre en mémoire joue le fil : les tests s'en servent, le watchdog n'y écrit pas.
 */

export interface MessageFil {
  id: string;
  auteur: "user" | "role";
  roleId?: string;
  texte: string;
  at: string;
  statut?: "fait" | "erreur";
  erreur?: string;
}

export interface FilAgent {
  id: string;
  roleId: string;
  titre: string;
  statut: "ouvert" | "archive";
  etape: "a-faire" | "en-cours" | "bloque" | "a-valider";
  raison: string | null;
  projetId: string | null;
  priorite: number;
  echeance: string | null;
  lancePar: { roleId: string; chatId: string } | null;
  messages: MessageFil[];
}

export interface RegistreFils {
  fils: FilAgent[];
  /** Écritures dans un fil. Le watchdog doit laisser ce compteur inchangé. */
  ecritures: number;
}

export function creerRegistre(): RegistreFils {
  return { fils: [], ecritures: 0 };
}

const PREFIXE = "klyra-fil-";

function messageNatif(fil: FilAgent, message: MessageFil): MessageNatif {
  return {
    id: message.id,
    chatId: fil.id,
    author: message.auteur === "user" ? { kind: "user" } : { kind: "role", roleId: message.roleId ?? fil.roleId },
    createdAt: message.at,
    parts: [{ type: "text", text: message.texte }],
    statut: message.statut ?? "fait",
    erreur: message.erreur,
  };
}

/** Transport : le message source est déjà dans le fil. On ne l'écrit pas une seconde fois. */
export function transportFil(registre: RegistreFils, filId: string, messageId: string): Effet {
  const present = () => registre.fils.find((f) => f.id === filId)?.messages.some((m) => m.id === messageId) ?? false;
  return {
    async appliquer() {
      if (!present()) {
        const fil = registre.fils.find((f) => f.id === filId);
        if (fil) {
          fil.messages.push({ id: messageId, auteur: "user", texte: "", at: new Date().toISOString(), statut: "fait" });
          registre.ecritures += 1;
        }
      }
      return { receipt_ref: `fil:${filId}#${messageId}` };
    },
    async constater() {
      return present()
        ? { constat: "present", preuve_ref: `fil:${filId}#${messageId}` }
        : { constat: "absent", preuve_ref: `fil:${filId}#${messageId}:absent` };
    },
  };
}

export interface Annuaire {
  agents: { id: string; name: string }[];
  projets: { id: string; name: string }[];
}

export interface ContexteOutil extends ContexteCycle {
  maintenant?: () => number;
}

function ligne(fil: FilAgent): string {
  return `${fil.titre} (${fil.id}) · ${fil.roleId} · ${fil.etape}${fil.raison ? ` · ${fil.raison}` : ""}`;
}

/**
 * Exécute un outil de fil. Le journal et le registre bougent ensemble.
 * Un quatrième travail n'ouvre pas de fil. Une précision reste sur le fil déjà ouvert.
 */
export async function executerOutilFil(
  db: DatabaseSync,
  registre: RegistreFils,
  annuaire: Annuaire,
  nom: string,
  args: Record<string, unknown>,
  appelant: { chatId: string; roleId: string },
  ctx: ContexteOutil,
): Promise<string> {
  const maintenant = ctx.maintenant ?? Date.now;
  const filDe = (id: unknown) => {
    const fil = registre.fils.find((f) => f.id === String(id ?? "").trim());
    if (!fil) throw new Error(`Aucun fil « ${String(id)} ».`);
    return fil;
  };

  if (nom === "lister_fils") {
    const agent = typeof args.agent === "string" && args.agent ? args.agent : null;
    const ouverts = registre.fils.filter((f) => f.statut === "ouvert" && (!agent || f.roleId === agent));
    return ouverts.length ? ouverts.map((f) => `- ${ligne(f)}`).join("\n") : "Aucun fil ouvert.";
  }

  if (nom === "lire_fil") {
    const fil = filDe(args.id);
    const derniere = [...fil.messages].reverse().find((m) => m.auteur === "role");
    return `${ligne(fil)}\n\n${derniere ? `Dernière réponse :\n${derniere.texte.slice(-8000)}` : "Pas encore de réponse."}`;
  }

  if (nom === "ouvrir_fil") {
    const agent = String(args.agent ?? "").trim();
    const titre = String(args.titre ?? "").trim();
    const brief = String(args.brief ?? "").trim();
    if (!annuaire.agents.some((a) => a.id === agent)) throw new Error(`« ${agent} » n’est pas dans Mes agents.`);
    if (!brief) throw new Error("Le brief est vide : le fil ne voit pas ta conversation, il lui faut tout.");
    const projetId = typeof args.projet === "string" && args.projet.trim() ? args.projet.trim() : ctx.project_id;
    if (args.projet && !annuaire.projets.some((p) => p.id === projetId)) throw new Error(`Aucun projet « ${projetId} ».`);
    if (placesLibres(db) < 1) return "En attente : trois travaux sont déjà ouverts. Celui-ci démarre quand une place se libère.";
    const id = `${PREFIXE}${randomUUID().slice(0, 8)}`;
    const messageId = randomUUID();
    const at = new Date(maintenant()).toISOString();
    const fil: FilAgent = {
      id,
      roleId: agent,
      titre: titre || brief.slice(0, 80),
      statut: "ouvert",
      etape: "a-faire",
      raison: null,
      projetId,
      priorite: Number(args.priorite ?? 0) || 0,
      echeance: typeof args.echeance === "string" ? args.echeance : null,
      lancePar: { roleId: appelant.roleId, chatId: appelant.chatId },
      messages: [{ id: messageId, auteur: "user", texte: brief, at, statut: "fait" }],
    };
    registre.fils.push(fil);
    registre.ecritures += 1;
    const ouvert = ouvrirTravailFil(
      db,
      {
        ...ctx,
        project_id: projetId,
        fil_id: id,
        role_id: agent,
        titre: fil.titre,
        priority: fil.priorite,
        deadline_at: fil.echeance,
      },
      maintenant,
    );
    if (!ouvert.ok) {
      registre.fils.pop();
      registre.ecritures -= 1;
      return ouvert.motif === "capacite_atteinte"
        ? "En attente : trois travaux sont déjà ouverts. Celui-ci démarre quand une place se libère."
        : `Travail non ouvert : ${ouvert.motif}.`;
    }
    const issue = await ingererMessageFil(
      db,
      {
        ...ctx,
        project_id: projetId,
        fil_id: id,
        message: messageNatif(fil, fil.messages[0]),
        transport: transportFil(registre, id, messageId),
        typeMessage: "demande",
      },
      maintenant,
    );
    const nomAgent = annuaire.agents.find((a) => a.id === agent)?.name ?? agent;
    return `Fil ouvert : ${fil.titre} (${id}). ${nomAgent} y travaille. Travail ${ouvert.work_id}, événement ${issue.event_id ?? "aucun"} (${issue.disposition}).`;
  }

  if (nom === "ecrire_dans_fil") {
    const fil = filDe(args.id);
    const texte = String(args.message ?? "").trim();
    if (!texte) throw new Error("Le message est vide.");
    if (fil.statut === "archive") throw new Error("Ce fil est fermé.");
    const travail = lireTravail(db, travailDuFil(db, fil.id) ?? "");
    if (travail && (travail.status === "suspended" || travail.status === "cancelled" || travail.status === "done")) {
      throw new Error("Ce travail est suspendu ou clos : aucun nouveau départ.");
    }
    const message: MessageFil = { id: randomUUID(), auteur: "user", texte, at: new Date(maintenant()).toISOString(), statut: "fait" };
    fil.messages.push(message);
    registre.ecritures += 1;
    const issue = await ingererMessageFil(
      db,
      { ...ctx, project_id: fil.projetId ?? ctx.project_id, fil_id: fil.id, message: messageNatif(fil, message), transport: transportFil(registre, fil.id, message.id) },
      maintenant,
    );
    return `Envoyé dans ${fil.id}. Travail ${issue.work_id ?? "aucun"}, événement ${issue.event_id ?? "aucun"} (${issue.disposition}${issue.motif ? `, ${issue.motif}` : ""}).`;
  }

  if (nom === "mettre_a_jour_fil") {
    const fil = filDe(args.id);
    const etat = String(args.etat ?? "");
    const raison = typeof args.raison === "string" ? args.raison.trim() : "";
    if (etat === "bloque" && !raison) throw new Error("Dis pourquoi c’est bloqué.");
    if (etat === "bloque") {
      fil.etape = "bloque";
      fil.raison = raison;
      const marque = marquerTravailFil(db, { fil_id: fil.id, status: "blocked" }, maintenant);
      if (!marque.ok) throw new Error(marque.motif);
    } else if (etat === "a-valider" || etat === "a-faire" || etat === "en-cours") {
      fil.etape = etat;
    }
    return `À jour : ${ligne(fil)}`;
  }

  if (nom === "arreter_fil") {
    const fil = filDe(args.id);
    const marque = marquerTravailFil(db, { fil_id: fil.id, status: "suspended" }, maintenant);
    if (!marque.ok && marque.motif !== "travail_clos") throw new Error(marque.motif);
    return "Arrêté. Le fil reste ouvert. Aucun nouveau départ tant qu’il n’est pas repris après contrôle.";
  }

  if (nom === "reprendre_fil") {
    const fil = filDe(args.id);
    const controle = typeof args.controle === "string" ? args.controle : "";
    const marque = marquerTravailFil(db, { fil_id: fil.id, status: "active", controle_ref: controle }, maintenant);
    if (!marque.ok) throw new Error(marque.motif);
    return `Repris : ${ligne(fil)}`;
  }

  if (nom === "fermer_fil") {
    const fil = filDe(args.id);
    const marque = marquerTravailFil(db, { fil_id: fil.id, status: "done" }, maintenant);
    if (!marque.ok) throw new Error(marque.motif);
    fil.statut = "archive";
    return `Fil fermé : ${fil.titre} (${fil.id}).`;
  }

  throw new Error("Outil inconnu.");
}
