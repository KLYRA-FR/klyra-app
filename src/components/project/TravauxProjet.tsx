"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { Input } from "klyra-ui";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { useWorkspace } from "@/lib/workspace";

/** Lecture seule du journal local. Ouvrir cet écran ne lance aucun travail. */

interface LigneTravail {
  work_id: string;
  fil_id: string | null;
  titre: string;
  owner_agent_id: string | null;
  status: string;
  state_ref: string;
  deadline_at: string | null;
  mesures_cout: string | null;
}

interface Alerte {
  work_id: string;
  type: string;
  motif: string;
  prochain_geste: string;
}

interface Projection {
  travaux: LigneTravail[];
  alertes: Alerte[];
  blocages: { point: string; texte: string }[];
  evenements?: { event_id: string; work_id: string; type: string; resume: string }[];
  couverture: string;
}

interface Preuve {
  status: string;
  owner_agent_id: string | null;
  owner_epoch: number;
  state_ref: string;
  objective_revision: number;
  operations: { operation_id: string; status: string; attempts: number; effect_check_ref: string | null }[];
  checkpoints: { preuve_ref: string; observed_at: string }[];
  alertes: { type: string; motif: string; resolved_at: string | null }[];
}

const STATUTS: Record<string, string> = {
  active: "En cours",
  waiting: "En attente",
  waiting_machine: "En attente d’une machine",
  suspended: "Suspendu",
  cancelled: "Annulé",
  done: "Terminé",
  blocked: "Bloqué",
  reconciliation_required: "À rapprocher",
  unknown: "Inconnu",
  planned: "Prévu",
  inflight: "Parti",
  succeeded: "Constaté",
  failed: "Absent",
};

const libelle = (status: string) => STATUTS[status] ?? status;

function estProjection(valeur: unknown): valeur is Projection {
  return !!valeur && typeof valeur === "object" && Array.isArray((valeur as Projection).travaux);
}

function estPreuve(valeur: unknown): valeur is Preuve {
  return !!valeur && typeof valeur === "object" && Array.isArray((valeur as Preuve).operations);
}

export function TravauxProjet({ projectId }: { projectId: string }) {
  const { moi } = useWorkspace();
  const [projection, setProjection] = useState<Projection | null>(null);
  const horsApp = useSyncExternalStore(
    () => () => {},
    () => !getBridge()?.superagent,
    () => false,
  );
  const [erreur, setErreur] = useState<string | null>(null);
  const [preuve, setPreuve] = useState<{ workId: string; preuve: Preuve | null } | null>(null);
  const [requete, setRequete] = useState("");
  const [trouves, setTrouves] = useState<{ identifiant: string; extrait: string }[] | null>(null);

  useEffect(() => {
    const pont = getBridge()?.superagent;
    if (!pont) return;
    let ignore = false;
    void pont.projection(projectId).then((reponse) => {
      if (ignore) return;
      if (!reponse.ok || !estProjection(reponse.data)) {
        setErreur(reponse.ok ? "Projection illisible." : reponse.message);
        return;
      }
      setProjection(reponse.data);
    });
    return () => {
      ignore = true;
    };
  }, [projectId]);

  const chercher = () => {
    const pont = getBridge()?.superagent;
    if (!pont || !requete.trim()) return;
    void pont.chercher(requete.trim(), moi.id || "local", projectId).then((reponse) => {
      if (!reponse.ok) {
        setErreur(reponse.message);
        return;
      }
      setTrouves(reponse.data.resultats.map((r) => ({ identifiant: r.identifiant, extrait: r.extrait })));
    });
  };

  const ouvrirPreuves = (workId: string) => {
    const pont = getBridge()?.superagent;
    if (!pont) return;
    void pont.preuves(workId).then((reponse) => {
      if (!reponse.ok) {
        setErreur(reponse.message);
        return;
      }
      setPreuve({ workId, preuve: estPreuve(reponse.data) ? reponse.data : null });
    });
  };

  /* Rien encore dans le journal pour ce projet : pas de section vide ni de recherche sans objet. */
  const vide = !!projection && projection.couverture === "ok" && projection.travaux.length === 0 && projection.blocages.length === 0;
  if (!erreur && !horsApp && (!projection || vide)) return null;

  return (
    <section aria-labelledby="travaux-titre" className="flex flex-col gap-3">
      <h2 id="travaux-titre" className="m-0 px-1 text-ui font-semibold text-texte-principal">
        Travaux
      </h2>
      {horsApp && (
        <p className="m-0 px-1 text-ui text-texte-tertiaire">Le journal des travaux est tenu par l’app de bureau. Cette page, ouverte sans elle, ne le lit pas.</p>
      )}
      {erreur && <p className="m-0 px-1 text-ui text-texte-secondaire">{erreur}</p>}
      {projection?.couverture === "journal_illisible" && (
        <p className="m-0 px-1 text-ui text-texte-secondaire">Le journal n’a pas pu être lu. Rien n’a été lancé.</p>
      )}
      {projection && projection.travaux.length > 0 && (
        <div className="flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-page p-3">
          {projection.travaux.map((travail) => (
            <article key={travail.work_id} className="flex flex-col gap-1 border-b border-bordure-subtile pb-2 last:border-b-0 last:pb-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-ui font-medium text-texte-principal">{travail.titre || "Sans titre"}</span>
                <span className="text-ui-xs text-texte-tertiaire">{libelle(travail.status)}</span>
                {travail.owner_agent_id && <span className="text-ui-xs text-texte-tertiaire">{travail.owner_agent_id}</span>}
              </div>
              <p className="m-0 text-ui-xs text-texte-tertiaire">
                {travail.deadline_at ? `Échéance ${travail.deadline_at}` : "Pas d’échéance"}
                {" · "}
                {travail.mesures_cout ?? "Coût non mesuré"}
              </p>
              <p className="m-0 text-ui-xs text-texte-tertiaire [overflow-wrap:anywhere]">État : {travail.state_ref}</p>
              <span className="flex flex-wrap items-center gap-3">
                {travail.fil_id && (
                  <Link href={`/chat?id=${travail.fil_id}`} className="text-ui-s text-texte-accent no-underline">
                    Ouvrir le fil
                  </Link>
                )}
                <Bouton variant="discret" taille="compact" onClick={() => ouvrirPreuves(travail.work_id)}>
                  Preuves
                </Bouton>
              </span>
              {(projection.evenements ?? [])
                .filter((evenement) => evenement.work_id === travail.work_id)
                .map((evenement) => (
                  <p key={evenement.event_id} className="m-0 text-ui-s text-texte-secondaire">
                    {evenement.type === "fin_verification" ? "Vérification" : "Commentaire"} · {evenement.resume}
                  </p>
                ))}
              {projection.alertes
                .filter((a) => a.work_id === travail.work_id)
                .map((alerte) => (
                  <p key={`${alerte.type}-${alerte.motif}`} className="m-0 text-ui-s text-texte-secondaire">
                    {alerte.type} — {alerte.motif} {alerte.prochain_geste}
                  </p>
                ))}
              {preuve?.workId === travail.work_id && (
                <div className="flex flex-col gap-1 text-ui-xs text-texte-secondaire">
                  {!preuve.preuve && <p className="m-0">Preuves absentes pour ce travail.</p>}
                  {preuve.preuve?.operations.map((op) => (
                    <p key={op.operation_id} className="m-0">
                      Opération {libelle(op.status)}
                      {op.status === "unknown" ? " : effet à constater, pas à refaire" : ""}
                      {op.effect_check_ref ? ` · ${op.effect_check_ref}` : " · pas d’accusé"}
                    </p>
                  ))}
                  {preuve.preuve && preuve.preuve.operations.length === 0 && <p className="m-0">Aucune opération.</p>}
                  {preuve.preuve?.checkpoints.map((point) => (
                    <p key={`${point.observed_at}-${point.preuve_ref}`} className="m-0">
                      Checkpoint {point.observed_at} · {point.preuve_ref}
                    </p>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      )}
      {projection && projection.travaux.length > 0 && (
        <form
          className="flex flex-wrap items-center gap-2 px-1"
          onSubmit={(event) => {
            event.preventDefault();
            chercher();
          }}
        >
          <label className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-ui-xs text-texte-tertiaire">Chercher un travail de ce projet</span>
            <Input value={requete} onChange={(event) => setRequete(event.target.value)} />
          </label>
          <Bouton type="submit" variant="blanc" taille="compact">
            Chercher
          </Bouton>
        </form>
      )}
      {trouves && (
        <div className="flex flex-col gap-1 px-1">
          {trouves.length === 0 && <p className="m-0 text-ui-s text-texte-tertiaire">Aucun pointeur.</p>}
          {trouves.map((ligne) => (
            <p key={ligne.identifiant} className="m-0 text-ui-s text-texte-secondaire">
              {ligne.extrait}
            </p>
          ))}
        </div>
      )}
      {projection && projection.blocages.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-1 px-1">
          {projection.blocages.map((blocage) => (
            <li key={blocage.point} className="text-ui-xs text-texte-tertiaire">
              Point {blocage.point}. {blocage.texte}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
