"use client";

import { MODELES } from "@/components/chat/ChoixModele";
import { useAgents } from "@/lib/agents";
import { getBridge, type Reponse } from "@/lib/bridge";
import { dansEspace, lieuParDefaut, useServeursRelies } from "@/lib/lieux";
import { poste } from "@/lib/plateforme";
import { tagLisible } from "@/lib/telephone/agents";
import {
  agentsDesRoutines,
  lireId,
  lireLimite,
  lireRoutineInput,
  lireSchedule,
  patchRoutine,
  routineLue,
  type ExecutionsLues,
  type RoutinesLues,
} from "@/lib/telephone/routines-telephone";
import { lireChantiers } from "@/lib/workflows/chantiers";
import {
  appliquerPatch,
  chantierDuWorkflow,
  chantierLu,
  conflitEtape,
  copieWorkflow,
  enCoursExecution,
  etapeLue,
  grapheLu,
  listeWorkflows,
  lirePatchEtape,
  restaurerVersion,
  resumeExecution,
  type AgentWorkflow,
  type LigneWorkflow,
  type ResumeExecution,
  type VersionLue,
  type WorkflowLu,
} from "@/lib/telephone/workflow-etapes";
import { useWorkspace } from "@/lib/workspace";
import { estEtape, type Workflow } from "@/types/workflows";
import { booleen, chaine, chaineOuNull, ErreurPoste, objet, type Gestes } from "../types";

type MoteurRoutines = NonNullable<NonNullable<ReturnType<typeof getBridge>>["routines"]>;

/** Un appel au moteur des routines. Un refus garde son code : le formulaire du téléphone place l'erreur sous le bon champ. */
async function moteur<T>(appel: (api: MoteurRoutines) => Promise<Reponse<T>>): Promise<T> {
  const api = getBridge()?.routines;
  if (!api) throw new ErreurPoste("moteur", "Le moteur des routines n’est pas disponible.");
  const r = await appel(api);
  if (!r.ok) throw new ErreurPoste(r.code || "moteur", r.message);
  return r.data;
}

const MS_JOUR = 86_400_000;

/**
 * Gestes « automatisations » que l'ordinateur fait pour le téléphone (spec mobile T-14 à T-19).
 * Les routines passent par le moteur du process principal (`getBridge().routines`, relu à chaque
 * demande : celles d'un VPS y sont routées comme au bureau) ; les workflows, par l'état de l'app
 * (`useWorkspace`), qui les planifie et les exécute. Rien n'est créé ni relié ici : la structure
 * d'un workflow reste sur l'ordinateur.
 */
export function useGestesAutomatisations(): Gestes {
  const { roles, tous } = useAgents();
  const { state, enregistrerWorkflow, supprimerWorkflow, lancerWorkflow, arreterExecution, deciderApprobation } = useWorkspace();
  const serveurs = useServeursRelies();

  const routineDe = async (id: string) => {
    const routine = (await moteur((api) => api.lister())).find((r) => r.id === id);
    if (!routine) throw new ErreurPoste("introuvable", `Cette routine n’existe plus sur ${poste.ton}.`);
    return routine;
  };
  const agentActif = (id: string) => roles.some((r) => r.id === id);

  const workflowDe = (args: Record<string, unknown>): Workflow => {
    const id = chaine(args, "id", 200);
    const wf = state.workflows.find((w) => w.id === id);
    if (!wf) throw new ErreurPoste("introuvable", `Ce workflow n’existe plus sur ${poste.ton}.`);
    return wf;
  };
  /** Les agents que le téléphone affiche : l'équipe active, et ceux d'une étape qui ne le sont plus. */
  const agentsDuGraphe = (noeuds: Workflow["graphe"]["noeuds"]): AgentWorkflow[] => {
    const cites = new Set(noeuds.filter((n) => n.type === "agent").map((n) => String(n.champs.agent ?? "")));
    return [
      ...roles.map((r) => ({ id: r.id, name: r.name, tag: tagLisible(r), teinte: r.teinte, actif: true })),
      ...tous.filter((a) => cites.has(a.role.id) && !agentActif(a.role.id)).map(({ role: r }) => ({ id: r.id, name: r.name, tag: tagLisible(r), teinte: r.teinte, actif: false })),
    ];
  };
  /** Le nom et la teinte de l'agent qui construit, pour la bannière du téléphone. */
  const agentDe = (id: string) => {
    const r = roles.find((x) => x.id === id) ?? tous.find((a) => a.role.id === id)?.role;
    return r ? { name: r.name, teinte: r.teinte } : null;
  };
  const executionsDe = (id: string) => state.executions.filter((e) => e.workflowId === id).sort((a, b) => b.debut.localeCompare(a.debut));
  /* « Voir la conversation » seulement si elle existe encore, comme au bureau. */
  const avecChat = <R extends ResumeExecution>(r: R): R => ({ ...r, chatId: r.chatId && state.chats.some((c) => c.id === r.chatId) ? r.chatId : null });

  return {
    /* ─── Routines ─── */

    /** T-14 et T-15 : la colonne des agents, les routines, et avec un agent leurs dernières exécutions. */
    "routines.liste": async (brut): Promise<RoutinesLues> => {
      const args = objet(brut);
      const agentId = chaineOuNull(args, "agentId", 64);
      const contexte = {
        fuseau: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        lieu: lieuParDefaut(),
        serveurs: serveurs.map((s) => ({ adresse: s.adresse, nom: s.nom })),
        projets: state.projects.map((p) => ({ id: p.id, name: p.name, lieu: p.lieu ?? null })),
      };
      const etat = await moteur((api) => api.etat());
      if (!etat.actif || etat.erreur) {
        return { actif: false, erreur: etat.erreur ?? "Le moteur des routines est indisponible.", agents: agentsDesRoutines(roles, tous, []), routines: [], enCours: [], ...contexte };
      }
      const [routines, enCours] = await Promise.all([moteur((api) => api.lister()), moteur((api) => api.enCours())]);
      const lues: RoutinesLues = { actif: true, erreur: null, agents: agentsDesRoutines(roles, tous, routines), routines: routines.map(routineLue), enCours, ...contexte };
      if (!agentId) return lues;
      const dernieres = await Promise.all(
        routines
          .filter((r) => r.agentId === agentId)
          .map(async (r) => {
            try {
              const runs = await moteur((api) => api.historique(r.id, 1));
              return [r.id, { run: runs[0] ?? null }] as const;
            } catch (err) {
              return [r.id, { erreur: err instanceof Error ? err.message : String(err) }] as const;
            }
          }),
      );
      return { ...lues, dernieres: Object.fromEntries(dernieres) };
    },

    "routines.executer": async (brut) => {
      const id = lireId(objet(brut), "id");
      const routine = await routineDe(id);
      if (!agentActif(routine.agentId)) throw new ErreurPoste("agent-indisponible", "Choisis un agent actif avant de lancer cette routine.");
      await moteur((api) => api.executer(id));
      return null;
    },

    /** « Mettre en pause » / « Reprendre ». */
    "routines.pause": async (brut) => {
      const args = objet(brut);
      const id = lireId(args, "id");
      const active = booleen(args, "active");
      const routine = await routineDe(id);
      if (active && routine.relais?.length) throw new ErreurPoste("relais-incompatibles", "Choisis d’abord quoi conserver de cette ancienne chaîne.");
      if (active && !agentActif(routine.agentId)) throw new ErreurPoste("agent-indisponible", "Choisis un agent actif avant de lancer cette routine.");
      if (routine.active !== active) await moteur((api) => api.modifier(id, { active }));
      return null;
    },

    /** « Garder seulement {agent} » : l'ancienne chaîne reprend avec sa première consigne. */
    "routines.simplifier": async (brut) => {
      const id = lireId(objet(brut), "id");
      const routine = await routineDe(id);
      if (!agentActif(routine.agentId)) throw new ErreurPoste("agent-indisponible", "Choisis un agent actif avant de lancer cette routine.");
      await moteur((api) => api.modifier(id, { relais: [], active: true }));
      return null;
    },

    /** « Interrompre » ou « Annuler le départ ». */
    "routines.interrompre": async (brut) => {
      const runId = lireId(objet(brut), "runId");
      await moteur((api) => api.interrompre(runId));
      return null;
    },

    "routines.supprimer": async (brut) => {
      const id = lireId(objet(brut), "id");
      await routineDe(id);
      await moteur((api) => api.supprimer(id));
      return null;
    },

    /** Créer (sans `id`) ou modifier. Refusé si la routine a changé depuis que le téléphone l'a lue. */
    "routines.enregistrer": async (brut) => {
      const args = objet(brut);
      const id = chaineOuNull(args, "id", 200);
      const input = lireRoutineInput(args.input);
      if (!id) return routineLue(await moteur((api) => api.creer(input)));
      const updatedAt = chaine(args, "updatedAt", 40);
      const courante = (await moteur((api) => api.lister())).find((r) => r.id === id);
      if (!courante) throw new ErreurPoste("supprimee", "Cette routine a été supprimée pendant la modification. Copie ta consigne avant de fermer ce formulaire.");
      if (courante.updatedAt !== updatedAt) throw new ErreurPoste("changee", "Cette routine a changé. Recharge-la avant de l’enregistrer pour ne pas écraser ces changements.");
      return routineLue(await moteur((api) => api.modifier(id, patchRoutine(courante, input))));
    },

    /** T-17 : l'historique par paquets de 50 (un de plus pour savoir s'il en reste) et les départs des 7 jours. */
    "routines.executions": async (brut): Promise<ExecutionsLues> => {
      const args = objet(brut);
      const id = lireId(args, "id");
      const limite = lireLimite(args);
      const routine = await routineDe(id);
      const [runs, prochaines] = await Promise.all([
        moteur((api) => api.historique(id, limite + 1)),
        routine.schedule.kind === "manual" ? Promise.resolve([] as string[]) : moteur((api) => api.prochaines(id)),
      ]);
      const maintenant = Date.now();
      return { runs, dates: prochaines.filter((date) => Date.parse(date) >= maintenant && Date.parse(date) <= maintenant + 7 * MS_JOUR).slice(0, 5) };
    },

    /** Les prochains départs du formulaire (`routines:apercu`). */
    "routines.apercu": async (brut) => {
      const args = objet(brut);
      const schedule = lireSchedule(args.schedule);
      const timezone = chaine(args, "timezone", 100);
      return await moteur((api) => api.apercu(schedule, timezone));
    },

    /* ─── Workflows ─── */

    /** T-18 : « Tes workflows », le dernier modifié en tête ; en tête aussi, celui qu'un agent crée en ce moment. */
    "workflows.liste": async (brut): Promise<LigneWorkflow[]> => {
      /* Le téléphone dit le serveur qu'il affiche ; sans lui (ancienne version) : tous. */
      const args = objet(brut);
      const lieu = "lieu" in args ? (typeof args.lieu === "string" ? args.lieu : null) : undefined;
      const workflows = lieu === undefined ? state.workflows : state.workflows.filter((w) => dansEspace(w.lieu, lieu));
      return listeWorkflows(workflows, state.executions, Object.values(lireChantiers()), agentDe, new Date().toISOString());
    },

    /** T-19 : le graphe sans le dessin, les exécutions, et le détail de celle regardée. Un agent le construit : son graphe en cours. */
    "workflows.lire": async (brut): Promise<WorkflowLu> => {
      const args = objet(brut);
      const c = chantierDuWorkflow(Object.values(lireChantiers()), chaine(args, "id", 200));
      const enConstruction = c && c.nouveau && !state.workflows.some((w) => w.id === c.workflowId) ? c : null;
      if (enConstruction) {
        return {
          id: enConstruction.workflowId,
          titre: enConstruction.titre,
          majLe: new Date().toISOString(),
          ...grapheLu(enConstruction.graphe),
          prochaines: {},
          version: null,
          executions: [],
          plus: 0,
          vue: null,
          enCours: null,
          agents: agentsDuGraphe(enConstruction.graphe.noeuds),
          chantier: chantierLu(enConstruction, agentDe(enConstruction.roleId)),
        };
      }
      const wf = workflowDe(args);
      const versionId = chaineOuNull(args, "version", 200);
      const executionId = chaineOuNull(args, "execution", 200);
      const limite = args.limite === undefined ? 12 : lireLimite(args);
      const version = versionId ? wf.versions.find((v) => v.id === versionId) : null;
      if (versionId && !version) throw new ErreurPoste("introuvable", "Cette version n’existe plus.");
      const graphe = version?.graphe ?? wf.graphe;
      const siennes = executionsDe(wf.id);
      const enCours = siennes.find(enCoursExecution) ?? null;
      const choisie = executionId ? siennes.find((e) => e.id === executionId) : (enCours ?? siennes[0] ?? null);
      if (executionId && !choisie) throw new ErreurPoste("introuvable", "Cette exécution n’existe plus.");
      /* Un agent le modifie : le téléphone voit son graphe en cours (pas sur une version d'avant). */
      const construit = !version && c ? c : null;
      const montre = construit && construit.phase !== "fini" ? construit.graphe : graphe;
      return {
        id: wf.id,
        titre: construit && construit.phase !== "fini" ? construit.titre : wf.titre,
        majLe: wf.majLe,
        ...grapheLu(montre),
        prochaines: wf.prochaines ?? {},
        version: version ? { id: version.id, at: version.at, raison: version.raison } : null,
        executions: siennes.slice(0, limite).map((e) => avecChat(resumeExecution(e, wf.graphe.noeuds))),
        plus: Math.max(0, siennes.length - limite),
        vue: version || !choisie ? null : { ...avecChat(resumeExecution(choisie, wf.graphe.noeuds)), etapes: choisie.etapes.map(etapeLue) },
        enCours: enCours?.id ?? null,
        agents: agentsDuGraphe(montre.noeuds),
        ...(construit ? { chantier: chantierLu(construit, agentDe(construit.roleId)) } : {}),
      };
    },

    /** « Lancer le workflow » : tout le workflow, comme le bouton de la barre au bureau. */
    "workflows.lancer": async (brut) => {
      const wf = workflowDe(objet(brut));
      if (executionsDe(wf.id).some(enCoursExecution)) throw new ErreurPoste("en-cours", "Une exécution de ce workflow est déjà en cours.");
      const execution = lancerWorkflow(wf.id, { declencheurId: null });
      if (!execution) throw new ErreurPoste("introuvable", `Ce workflow n’existe plus sur ${poste.ton}.`);
      return { execution };
    },

    "workflows.arreter": async (brut) => {
      const id = chaine(objet(brut), "execution", 200);
      if (!state.executions.some((e) => e.id === id && enCoursExecution(e))) throw new ErreurPoste("terminee", "Cette exécution est déjà terminée.");
      arreterExecution(id);
      return null;
    },

    /** « Approuver » ou « Refuser » une étape d'approbation qui attend. */
    "workflows.approuver": async (brut) => {
      const args = objet(brut);
      const etapeId = chaine(args, "etapeId", 200);
      const approuver = booleen(args, "approuver");
      const attend = state.executions.some((e) => e.etapes.some((s) => s.id === etapeId && s.statut === "approbation"));
      if (!attend) throw new ErreurPoste("expiree", "Cette approbation n’attend plus de réponse.");
      deciderApprobation(etapeId, approuver);
      return null;
    },

    /** Le contenu d'une étape (texte, agent, consigne…). Refusé si ces champs ont changé depuis la lecture. */
    "workflows.modifierEtape": async (brut) => {
      const args = objet(brut);
      const wf = workflowDe(args);
      const noeudId = chaine(args, "noeudId", 200);
      const noeud = wf.graphe.noeuds.find((n) => n.id === noeudId);
      if (!noeud || !estEtape(noeud.type)) throw new ErreurPoste("introuvable", `Cette étape n’existe plus sur ${poste.ton}.`);
      const patch = lirePatchEtape(noeud.type, args.patch, { agents: roles.map((r) => r.id), modeles: MODELES.map((m) => m.id) });
      const avant = objet(args.avant);
      if (conflitEtape(noeud, patch, { champs: objet(avant.champs), frequence: avant.frequence })) {
        throw new ErreurPoste("conflit", `Cette étape a changé sur ${poste.ton} depuis son ouverture. Relis-la avant de l’enregistrer.`);
      }
      enregistrerWorkflow({ ...wf, graphe: { ...wf.graphe, noeuds: wf.graphe.noeuds.map((n) => (n.id === noeudId ? appliquerPatch(n, patch) : n)) } });
      return null;
    },

    "workflows.renommer": async (brut) => {
      const args = objet(brut);
      const wf = workflowDe(args);
      enregistrerWorkflow({ ...wf, titre: chaine(args, "titre", 200).trim() || "Workflow sans titre" });
      return null;
    },

    "workflows.dupliquer": async (brut) => {
      const copie = copieWorkflow(workflowDe(objet(brut)), crypto.randomUUID(), new Date().toISOString());
      enregistrerWorkflow(copie);
      return { id: copie.id };
    },

    "workflows.supprimer": async (brut) => {
      supprimerWorkflow(workflowDe(objet(brut)).id);
      return null;
    },

    "workflows.versions": async (brut): Promise<VersionLue[]> =>
      workflowDe(objet(brut)).versions.map((v) => ({ id: v.id, at: v.at, raison: v.raison, etapes: v.graphe.noeuds.filter((n) => estEtape(n.type)).length })),

    /** « Rendre actuelle » une version de l'historique. */
    "workflows.restaurer": async (brut) => {
      const args = objet(brut);
      enregistrerWorkflow(restaurerVersion(workflowDe(args), chaine(args, "version", 200), crypto.randomUUID(), new Date().toISOString()));
      return null;
    },
  };
}
