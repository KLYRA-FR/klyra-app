"use client";

import { useConvexAuth, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Input } from "klyra-ui";
import { api } from "../../../convex/_generated/api";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge } from "@/lib/bridge";
import { relancerCircuit, useSuiviCircuit } from "@/lib/collaboration";
import { useReglages } from "@/lib/reglages";
import type { Project } from "@/types/domain";
import { COLLABORATION_PAR_DEFAUT, compteGithubValable } from "../../../electron/collaboration/reglages";

/**
 * Le circuit des Issues pour ce projet : les agents prennent les Issues marquées `agent:prêt` et ouvrent
 * une PR. Ils ne fusionnent jamais. Coupé tant que la personne ne l'active pas.
 */

const ETATS: Record<string, string> = {
  reserver: "À prendre",
  reprendre: "À reprendre",
  executer: "Agent en cours de lancement",
  en_cours_ici: "Un agent de ce poste travaille",
  a_un_autre_poste: "Prise par un autre poste",
  reservation_en_cours: "Réservation en cours",
  verifications_en_cours: "Vérifications en cours",
  fusion_demandee: "Attend ta décision",
  demander_fusion: "Attend ta décision",
  reviewer: "Attend ta relecture",
  bloquee: "Bloquée",
  bloquer: "Bloquée",
  corriger_ci: "Bloquée : vérifications rouges",
  corriger_revue: "Bloquée : corrections demandées",
  cloturer: "Terminée",
  deja_terminee: "Terminée",
  en_attente_de_place: "En attente d’une place",
  pas_prete: "Pas encore prête",
  fermee: "Fermée",
};

export function CircuitProjet({ project }: { project: Project }) {
  const pont = getBridge()?.collaboration;
  const { isAuthenticated } = useConvexAuth();
  const { reglages, changerCollaboration } = useReglages();
  const mesDepots = useQuery(api.jetonsDepot.mesDepots, isAuthenticated ? {} : "skip");
  const suivi = useSuiviCircuit(project.id);
  const [depot, setDepot] = useState<string | null | undefined>(undefined);
  const circuit = reglages?.collaboration ?? COLLABORATION_PAR_DEFAUT;
  /* Ce que la personne tape, sinon le compte enregistré. */
  const [saisie, setSaisie] = useState<string | null>(null);
  const compte = saisie ?? circuit.compteGithub;

  useEffect(() => {
    if (!pont || !project.folder || project.lieu) return;
    let ignore = false;
    void pont.depot(project.folder).then((r) => {
      if (!ignore) setDepot(r.ok ? r.data : null);
    });
    return () => {
      ignore = true;
    };
  }, [pont, project.folder, project.lieu]);

  if (!pont) return null;

  const actif = circuit.projets.includes(project.id);
  const autorise = !!depot && !!mesDepots?.includes(depot);
  const compteValable = compteGithubValable(compte);

  const basculer = () => {
    void changerCollaboration({
      compteGithub: compte,
      poste: circuit.poste || crypto.randomUUID(),
      projets: actif ? circuit.projets.filter((id) => id !== project.id) : [...circuit.projets, project.id],
    });
    if (!actif) setTimeout(relancerCircuit, 300);
  };

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-bordure-subtile p-4">
      <div className="flex flex-col gap-1">
        <h2 className="m-0 text-ui font-medium text-texte-principal">Circuit GitHub</h2>
        <p className="m-0 text-ui-s text-texte-secondaire">
          Les agents prennent les Issues marquées <code className="klyra-mono">agent:prêt</code>, travaillent à part et ouvrent une pull request. Ils ne fusionnent jamais.
        </p>
      </div>

      {project.lieu ? (
        <p className="m-0 text-ui-s text-texte-tertiaire">Pas encore disponible pour un projet sur un VPS.</p>
      ) : depot === undefined ? null : depot === null ? (
        <p className="m-0 text-ui-s text-texte-tertiaire">Ce projet n’est pas relié à un dépôt de KLYRA-FR.</p>
      ) : !autorise ? (
        <p className="m-0 text-ui-s text-texte-tertiaire">Tu n’as pas encore accès à {depot} pour les agents. Un admin peut te l’accorder.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-48 flex-1 flex-col gap-1">
              <span className="text-ui-xs text-texte-tertiaire">Ton compte GitHub</span>
              <Input value={compte} disabled={actif} onChange={(event) => setSaisie(event.target.value.trim())} />
            </label>
            <Bouton variant={actif ? "blanc" : "sombre"} taille="compact" disabled={!actif && !compteValable} onClick={basculer}>
              {actif ? "Couper" : "Activer"}
            </Bouton>
            {actif && (
              <Bouton variant="blanc" taille="compact" onClick={relancerCircuit}>
                Vérifier maintenant
              </Bouton>
            )}
          </div>
          {actif && <p className="m-0 text-ui-xs text-texte-tertiaire">Ce poste vérifie toutes les 2 minutes tant que l’app est ouverte. Ses agents travaillent avec l’accès « projet ».</p>}
          {suivi?.erreur && <p className="m-0 text-ui-s text-texte-accent">{suivi.erreur}</p>}
          {actif && suivi?.bilan && (
            suivi.bilan.lignes.length === 0 ? (
              <p className="m-0 text-ui-s text-texte-tertiaire">Aucune Issue dans le circuit.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {suivi.bilan.lignes.map((ligne) => (
                  <li key={ligne.numero} className="flex items-baseline justify-between gap-3 text-ui-s">
                    <span className="min-w-0 truncate text-texte-principal">
                      #{ligne.numero} {ligne.titre}
                    </span>
                    <span className="shrink-0 text-texte-tertiaire">
                      {ETATS[ligne.etat] ?? ligne.etat}
                      {ligne.pull ? ` · PR #${ligne.pull}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )
          )}
        </>
      )}
    </section>
  );
}
