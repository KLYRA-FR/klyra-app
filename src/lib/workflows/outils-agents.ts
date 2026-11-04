import { GRAPHE_VIDE, type ExecutionWorkflow, type SourceExecution, type Workflow } from "@/types/workflows";
import { chantierDe, poserChantier, type Chantier } from "./chantiers";
import {
  construire,
  decrireWorkflow,
  etatsSuccessifs,
  ligneWorkflow,
  lireDemande,
  reponseConstruction,
  type Construction,
  type ContexteConstruction,
  type Demande,
} from "./construction";

/**
 * Les outils des workflows appelés par les agents (cf. `electron/workflows-outils.ts`), exécutés là
 * où vivent les workflows : l'écran. `workspace.tsx` donne l'état et ses gestes ; ce module répond à
 * l'agent et tient le chantier que la page Workflows montre en direct. Les mêmes réponses pour un
 * agent de ce PC et pour un agent d'un VPS (relayé par le journal).
 */

export interface Appelant {
  chatId: string;
  roleId: string;
}

export interface DependancesWorkflows {
  etat: () => { workflows: Workflow[]; executions: ExecutionWorkflow[]; projets: { id: string; name: string }[] };
  /** Les agents actifs (l'assistant compris). */
  agents: () => { id: string; nom: string }[];
  enregistrer: (wf: Workflow) => void;
  lancer: (
    id: string,
    o: { declencheurId?: string | null; source?: SourceExecution; charge?: string; lancePar?: { roleId: string; chatId: string } },
  ) => string | null;
  /** Une étape posée, puis la suivante : la durée entre deux, pour la voir se construire. */
  attendre?: (ms: number) => Promise<void>;
  maintenant?: () => number;
  nouvelId?: () => string;
}

/** Le temps qu'une construction finie reste à l'écran (le « c'est prêt » de la page). */
export const FIN_VISIBLE_MS = 2600;
/** La durée totale, au plus, d'une construction jouée geste par geste. */
const POSE_TOTALE_MS = 4200;

const cleDe = (a: Appelant) => `${a.chatId}:${a.roleId}`;

export function creerOutilsWorkflows(d: DependancesWorkflows) {
  const attendre = d.attendre ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const maintenant = d.maintenant ?? Date.now;
  const nouvelId = d.nouvelId ?? (() => crypto.randomUUID());
  const ctx = (): ContexteConstruction => ({ agents: d.agents() });
  const nomAgent = (id: string) => d.agents().find((a) => a.id === id)?.nom ?? id;
  const projetDe = (id: string | null) => (id ? (d.etat().projets.find((p) => p.id === id)?.name ?? id) : null);
  const trouver = (id: unknown) => {
    const wf = d.etat().workflows.find((w) => w.id === String(id ?? "").trim());
    if (!wf) throw new Error(`Aucun workflow « ${String(id ?? "")} ». lister_workflows donne les identifiants.`);
    return wf;
  };
  const enCoursDe = (wfId: string) => d.etat().executions.find((e) => e.workflowId === wfId && (e.statut === "en-cours" || e.statut === "approbation"));

  /** Le chantier tel que la page le montre, d'après une construction. */
  const chantier = (a: Appelant, base: Partial<Chantier>, wfId: string, nouveau: boolean, titre: string, c: Construction, phase: Chantier["phase"]): Chantier => ({
    cle: cleDe(a),
    roleId: a.roleId,
    chatId: a.chatId,
    etapeId: base.etapeId ?? null,
    workflowId: wfId,
    nouveau,
    titre,
    graphe: c.graphe,
    nouveaux: c.nouveaux,
    modifies: c.modifies,
    liensNouveaux: c.liensNouveaux,
    gestes: c.gestes,
    enEcriture: c.enEcriture,
    phase,
    debut: base.debut ?? maintenant(),
  });

  /** Le workflow visé par une demande : celui donné, ou un nouveau (son id est gardé d'un aperçu à l'autre). */
  const cible = (demande: Demande, precedent: Chantier | null) => {
    const existant = demande.workflow ? (d.etat().workflows.find((w) => w.id === demande.workflow) ?? null) : null;
    const id = existant?.id ?? (precedent?.nouveau ? precedent.workflowId : nouvelId());
    return { existant, id };
  };

  /**
   * L'entrée de `construire_workflow` pendant que le modèle l'écrit : la page montre déjà les étapes
   * posées. Un workflow inconnu, ou une étape qui ne va pas, est laissé de côté sans bruit.
   */
  function apercu(a: Appelant, etapeId: string, entree: Record<string, unknown>): void {
    const avant = chantierDe(cleDe(a));
    if (avant?.phase === "pose") return;
    /* Une construction finie juste avant reste un instant à l'écran : la nouvelle la remplace. */
    const precedent = avant?.phase === "ecrit" ? avant : null;
    const demande = lireDemande(entree, true);
    if (demande.workflow && !d.etat().workflows.some((w) => w.id === demande.workflow)) return;
    if (a.chatId.startsWith("wf-") && demande.workflow && a.chatId === `wf-${demande.workflow}`) return;
    const { existant, id } = cible(demande, precedent);
    const c = construire(existant?.graphe ?? GRAPHE_VIDE, demande, ctx(), true);
    poserChantier(cleDe(a), chantier(a, { etapeId, debut: precedent?.debut }, id, !existant, demande.titre ?? existant?.titre ?? "Nouveau workflow", c, "ecrit"));
  }

  /** Un outil refusé, ou une réponse finie sans l'appeler : l'aperçu part. */
  function abandonner(a: Appelant, etapeId?: string): void {
    const c = chantierDe(cleDe(a));
    if (c && c.phase === "ecrit" && (!etapeId || !c.etapeId || c.etapeId === etapeId)) poserChantier(c.cle, null);
  }

  async function construireWorkflow(args: Record<string, unknown>, a: Appelant): Promise<string> {
    const demande = lireDemande(args);
    const avant = chantierDe(cleDe(a));
    const precedent = avant?.phase === "ecrit" ? avant : null;
    const existant = demande.workflow ? trouver(demande.workflow) : null;
    if (existant && a.chatId === `wf-${existant.id}`) throw new Error("Tu travailles dans une exécution de ce workflow : tu ne le modifies pas pendant qu'il tourne.");
    if (!existant && !demande.titre) throw new Error("Donne un titre au nouveau workflow (titre).");
    if (demande.projet && !d.etat().projets.some((p) => p.id === demande.projet)) throw new Error(`Aucun projet « ${demande.projet} ».`);
    const base = existant?.graphe ?? GRAPHE_VIDE;
    const c = construire(base, demande, ctx());
    if (c.problemes.length) {
      abandonner(a);
      throw new Error(`Rien n'a été enregistré :\n${c.problemes.map((p) => `- ${p}`).join("\n")}`);
    }
    if (!c.gestes.length && !demande.projet) {
      abandonner(a);
      throw new Error("Rien à construire : donne des étapes, des liens ou des retraits.");
    }
    const { id } = cible(demande, existant ? null : precedent);
    const titre = demande.titre ?? existant?.titre ?? "Nouveau workflow";
    const debut = precedent?.debut ?? maintenant();
    /* Vu en train de s'écrire : les cartes sont déjà là. Sinon, la page les voit se poser une à une. */
    const vu = !!precedent && precedent.workflowId === id;
    if (!vu) {
      const etats = etatsSuccessifs(base, c);
      const pas = Math.max(140, Math.min(420, Math.round(POSE_TOTALE_MS / Math.max(1, etats.length))));
      const gestes = c.gestes.filter((g) => g.type !== "titre");
      for (let i = 0; i < etats.length; i++) {
        const geste = gestes[i];
        const enEcriture = !geste ? null : geste.type === "lien" ? geste.id : "id" in geste ? geste.id : null;
        poserChantier(cleDe(a), chantier(a, { etapeId: null, debut }, id, !existant, titre, { ...c, graphe: etats[i], gestes: c.gestes.slice(0, i + 1), enEcriture }, "pose"));
        await attendre(pas);
      }
    }
    const date = new Date(maintenant()).toISOString();
    const projectId = demande.projet ?? existant?.projectId ?? null;
    const wf: Workflow = existant
      ? {
          ...existant,
          titre,
          graphe: c.graphe,
          projectId,
          majLe: date,
          versions: [{ id: nouvelId(), at: date, raison: "agent" as const, par: a.roleId, graphe: existant.graphe }, ...existant.versions].slice(0, 50),
        }
      : { id, titre, graphe: c.graphe, projectId, creeLe: date, majLe: date, versions: [] };
    d.enregistrer(wf);
    const fini = chantier(a, { etapeId: null, debut }, id, !existant, titre, { ...c, enEcriture: null }, "fini");
    poserChantier(cleDe(a), fini);
    void attendre(FIN_VISIBLE_MS).then(() => {
      if (chantierDe(cleDe(a)) === fini) poserChantier(cleDe(a), null);
    });
    return reponseConstruction(wf, c, !existant, ctx());
  }

  function lancerWorkflow(args: Record<string, unknown>, a: Appelant): string {
    const wf = trouver(args.workflow);
    if (a.chatId.startsWith("wf-")) throw new Error("Une étape d'un workflow ne lance pas de workflow : dis-le dans ta réponse, la personne choisira.");
    const encours = enCoursDe(wf.id);
    if (encours) throw new Error(`« ${wf.titre} » tourne déjà (exécution n°${encours.numero}, id ${encours.id}) : suis-la avec lire_workflow.`);
    const declencheurId = typeof args.declencheur === "string" && args.declencheur.trim() ? args.declencheur.trim() : null;
    if (declencheurId && !wf.graphe.noeuds.some((n) => n.id === declencheurId && n.type === "declencheur"))
      throw new Error(`« ${declencheurId} » n'est pas un déclencheur de ce workflow.`);
    const charge = typeof args.entree === "string" ? args.entree.slice(0, 100_000) : undefined;
    const execId = d.lancer(wf.id, { declencheurId, source: "agent", charge, lancePar: { roleId: a.roleId, chatId: a.chatId } });
    if (!execId) throw new Error("Le workflow n'a pas pu partir.");
    const exec = d.etat().executions.find((e) => e.id === execId);
    return `Exécution${exec ? ` n°${exec.numero}` : ""} de « ${wf.titre} » lancée (id ${execId}). La personne la suit en direct sur sa page Workflows. Suis-la avec lire_workflow (workflow ${wf.id}) : une étape agent prend souvent plusieurs minutes, une approbation attend la personne.`;
  }

  /** Répond à un outil des workflows ; lève une erreur à dire à l'agent. */
  async function executer(nom: string, args: Record<string, unknown>, a: Appelant): Promise<string> {
    switch (nom) {
      case "lister_workflows": {
        const { workflows, executions } = d.etat();
        if (!workflows.length) return "Aucun workflow pour l'instant. construire_workflow en crée un.";
        const tries = [...workflows].sort((x, y) => y.majLe.localeCompare(x.majLe));
        return tries.map((w) => ligneWorkflow(w, executions, projetDe(w.projectId))).join("\n");
      }
      case "lire_workflow": {
        const wf = trouver(args.workflow);
        const siennes = d.etat().executions.filter((e) => e.workflowId === wf.id);
        const voulue = typeof args.execution === "string" && args.execution.trim() ? args.execution.trim() : null;
        const exec = voulue ? siennes.find((e) => e.id === voulue) : siennes[0];
        if (voulue && !exec) throw new Error(`Aucune exécution « ${voulue} » pour ce workflow.`);
        return decrireWorkflow(wf, exec ?? null, { ctx: ctx(), projet: projetDe(wf.projectId), nomAgent });
      }
      case "construire_workflow":
        return construireWorkflow(args, a);
      case "lancer_workflow":
        return lancerWorkflow(args, a);
      default:
        throw new Error("Outil inconnu.");
    }
  }

  return { executer, apercu, abandonner };
}
