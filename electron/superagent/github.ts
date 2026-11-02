import { execFileSync } from "node:child_process";
import type { DatabaseSync } from "node:sqlite";
import { ROUTEUR_APP } from "./cycle";
import { classerEvenement } from "./decision";
import { tronquerOctets } from "./enveloppe";
import { admettre } from "./filtre";
import { travauxPourReference } from "./liens";
import { fermerLot, ouvrirLot } from "./lots";
import { autoriserPull, lirePolitique } from "./politique";
import { lierReference, lireTravail } from "./travaux";
import type { EntreeSource, Horloge, ModeEntree } from "./types";

/**
 * Lecture d'une pull request déjà liée à un travail. Un commentaire devient `commentaire_pr`,
 * une vérification terminée (verte ou rouge) devient `fin_verification`, les deux sur ce travail.
 * Le même identifiant une seconde fois ne crée rien. Aucune écriture vers GitHub : pas de
 * commentaire, pas de fusion, pas de push, pas de mail.
 */

const DEPOT = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export interface FaitGithub {
  depot: string;
  numero: number;
  kind: "commentaire" | "verification";
  id: string;
  texte?: string;
  nom?: string;
  conclusion?: string;
  url?: string | null;
  mode?: ModeEntree;
}

export interface ResultatGithub {
  ok: boolean;
  work_id: string | null;
  event_id: string | null;
  disposition: string;
  motif: string;
  operations: string[];
}

function vide(motif: string): ResultatGithub {
  return { ok: false, work_id: null, event_id: null, disposition: "ignore", motif, operations: [] };
}

function validerPull(depot: string, numero: number): { depot: string; numero: number } | null {
  if (!DEPOT.test(depot) || !Number.isInteger(numero) || numero < 1) return null;
  return { depot, numero };
}

export function refPull(depot: string, numero: number): string {
  return `${depot}#${numero}`;
}

/** Relie la pull request au travail déjà ouvert. Ne crée pas de travail. */
export function lierPull(
  db: DatabaseSync,
  workId: string,
  depot: string,
  numero: number,
): { ok: true; ref: string } | { ok: false; motif: string } {
  const pull = validerPull(depot, numero);
  if (!pull) return { ok: false, motif: "pull_illisible" };
  const travail = lireTravail(db, workId);
  if (!travail) return { ok: false, motif: "travail_inconnu" };
  const ref = refPull(pull.depot, pull.numero);
  lierReference(db, workId, "github_pr", ref);
  autoriserPull(db, { project_id: travail.project_id, depot: pull.depot, conversation: ref, approval_ref: `lecture-github:${ref}` });
  return { ok: true, ref };
}

function urlHttp(valeur: string | null | undefined): string | null {
  if (!valeur || !/^https:\/\//.test(valeur)) return null;
  return valeur;
}

function entreeDe(fait: FaitGithub, depot: string, ref: string, projectId: string, workId: string): EntreeSource | null {
  if (!fait.id || fait.id.length > 500 || /[\r\n]/.test(fait.id)) return null;
  const localRef = `github:${ref}:${fait.kind}:${fait.id}`;
  const url = urlHttp(fait.url);
  if (fait.kind === "verification") {
    const conclusion = (fait.conclusion ?? "").toLowerCase();
    if (conclusion !== "success" && conclusion !== "failure") return null;
    const nom = (fait.nom ?? "contrôle").replace(/\s+/g, " ").trim().slice(0, 120) || "contrôle";
    const resume = `${conclusion === "success" ? "verte" : "rouge"} : ${nom}`;
    return {
      source_app: "github",
      source_account: depot,
      source_conversation_id: ref,
      source_message_id: `verification:${fait.id}`,
      source_revision: 1,
      type: "fin_verification",
      mode: fait.mode ?? "fixture",
      project_id: projectId,
      work_id: workId,
      source_url: url,
      local_ref: localRef,
      payload: resume,
      resume,
    };
  }
  const brut = fait.texte ?? "";
  const coupe = tronquerOctets(brut);
  const resume = coupe.texte || "Commentaire sans texte";
  const payload = brut || resume;
  return {
    source_app: "github",
    source_account: depot,
    source_conversation_id: ref,
    source_message_id: `commentaire:${fait.id}`,
    source_revision: 1,
    type: "commentaire_pr",
    mode: fait.mode ?? "fixture",
    project_id: projectId,
    work_id: workId,
    source_url: url,
    local_ref: localRef,
    payload_ref: coupe.tronque ? url ?? localRef : null,
    payload,
    resume,
  };
}

/**
 * Admet le fait dans le journal du travail lié à cette pull request, puis le classe.
 * Aucune livraison : le journal enregistre, il n'écrit pas au-dehors.
 */
export async function ingererFaitGithub(db: DatabaseSync, fait: FaitGithub, maintenant: Horloge = Date.now): Promise<ResultatGithub> {
  const pull = validerPull(fait.depot, fait.numero);
  if (!pull || (fait.kind !== "commentaire" && fait.kind !== "verification")) return vide("fait_illisible");
  if (fait.kind === "verification") {
    const conclusion = (fait.conclusion ?? "").toLowerCase();
    if (conclusion !== "success" && conclusion !== "failure") return vide("verification_non_terminee");
  }
  const ref = refPull(pull.depot, pull.numero);
  const travaux = travauxPourReference(db, "github_pr", ref);
  if (travaux.length === 0) return vide("pull_non_liee");
  if (travaux.length > 1) return vide("pull_ambigu");
  const workId = travaux[0];
  const travail = lireTravail(db, workId);
  if (!travail) return vide("travail_inconnu");
  const entree = entreeDe({ ...fait, depot: pull.depot, numero: pull.numero }, pull.depot, ref, travail.project_id, workId);
  if (!entree) return vide("fait_illisible");
  const politique = lirePolitique(db, travail.project_id);
  const admission = admettre(db, entree, politique, maintenant);
  if (admission.disposition === "doublon" || admission.disposition === "conflit") {
    return {
      ok: true,
      work_id: workId,
      event_id: admission.event_id,
      disposition: admission.disposition,
      motif: admission.disposition === "doublon" ? "tuple_source_existant" : admission.motif,
      operations: [],
    };
  }
  if (admission.disposition !== "accepte") return { ok: false, work_id: workId, event_id: null, disposition: admission.disposition, motif: admission.motif, operations: [] };

  const lot = ouvrirLot(db, { router_id: ROUTEUR_APP, project_id: travail.project_id, policy_version: politique?.version ?? 0 }, maintenant);
  if (lot.etat !== "ouvert") {
    return {
      ok: true,
      work_id: workId,
      event_id: admission.event_id,
      disposition: lot.etat,
      motif: lot.etat === "occupe" ? "lot_occupe" : "rien_a_decider",
      operations: [],
    };
  }
  const decisions = lot.evenements
    .filter((e) => e.type === "commentaire_pr" || e.type === "fin_verification")
    .map((e) => {
      const classe = classerEvenement(db, e.event_id);
      return {
        event_id: e.event_id,
        disposition: classe.disposition,
        work_id: classe.work_id,
        owner_epoch_attendu: classe.owner_epoch_attendu,
        motif: classe.motif,
      };
    });
  const ferme = fermerLot(db, { decision_id: lot.decision_id, decisions, authorization_ref: `lecture-github:${ref}` }, maintenant);
  const classe = classerEvenement(db, admission.event_id);
  return {
    ok: true,
    work_id: workId,
    event_id: admission.event_id,
    disposition: classe.disposition,
    motif: classe.motif,
    operations: ferme.operations,
  };
}

interface CommentaireGh {
  id?: string;
  body?: string;
  url?: string;
}

interface ControleGh {
  __typename?: string;
  name?: string | null;
  conclusion?: string | null;
  detailsUrl?: string | null;
  status?: string | null;
}

/** Lit les commentaires et les vérifications terminées avec `gh` déjà connecté. N'écrit rien. */
export function lirePull(depot: string, numero: number): { faits: FaitGithub[]; motif: string | null } {
  const pull = validerPull(depot, numero);
  if (!pull) return { faits: [], motif: "pull_illisible" };
  let brut: string;
  try {
    // FORCE_COLOR colore le JSON et le rend illisible. On garde GH_CONFIG_DIR, on coupe la couleur.
    const env = { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", CLICOLOR_FORCE: "0", GH_FORCE_TTY: "0" };
    brut = execFileSync("gh", ["pr", "view", String(pull.numero), "--repo", pull.depot, "--json", "comments,statusCheckRollup"], {
      timeout: 20_000,
      maxBuffer: 2_000_000,
      encoding: "utf8",
      env,
    });
  } catch {
    return { faits: [], motif: "lecture_absente" };
  }
  let json: { comments?: CommentaireGh[]; statusCheckRollup?: ControleGh[] };
  try {
    json = JSON.parse(brut.replace(/\u001b\[[0-9;]*m/g, "")) as { comments?: CommentaireGh[]; statusCheckRollup?: ControleGh[] };
  } catch {
    return { faits: [], motif: "lecture_absente" };
  }
  const faits: FaitGithub[] = [];
  for (const commentaire of json.comments ?? []) {
    if (!commentaire?.id) continue;
    faits.push({
      depot: pull.depot,
      numero: pull.numero,
      kind: "commentaire",
      id: String(commentaire.id),
      texte: typeof commentaire.body === "string" ? commentaire.body : "",
      url: commentaire.url ?? null,
      mode: "natif",
    });
  }
  for (const controle of json.statusCheckRollup ?? []) {
    if (controle?.__typename !== "CheckRun" || !controle.name) continue;
    const conclusion = String(controle.conclusion ?? "").toLowerCase();
    if (conclusion !== "success" && conclusion !== "failure") continue;
    const id = `${controle.name}|${controle.detailsUrl ?? ""}`;
    faits.push({
      depot: pull.depot,
      numero: pull.numero,
      kind: "verification",
      id,
      nom: controle.name,
      conclusion,
      url: controle.detailsUrl ?? null,
      mode: "natif",
    });
  }
  return { faits, motif: null };
}
