"use client";

import { useEffect, useState } from "react";
import type { Dependance } from "../../../convex/model/definitions";
import { Bloc } from "@/components/team/AgentDetail";
import { Bouton } from "@/components/ui/Bouton";
import { useAgents, type AgentLocal } from "@/lib/agents";
import { useBibliotheque } from "@/lib/bibliotheque";
import { abreger, clesDe, libelleDe, raison } from "@/lib/bibliotheque-ui";
import { BridgeError } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import { choisirDossier } from "./commun";

/**
 * Le bloc « À configurer » de la fiche d'un agent reçu (spec §8.2, §10.4) : une ligne par dossier
 * à choisir sur cet ordinateur. Choisir un dossier régénère la fiche locale à partir de la définition
 * suivie ; une fiche modifiée ici n'est jamais réécrite sans le dire. Ne rend rien sans dépendance.
 */
export function BlocAConfigurer({ agent }: { agent: AgentLocal }) {
  const { definitionRecue, appliquer, changerOrigine, save, meta, dir, canEdit } = useAgents();
  const { lire, etat, moiId } = useBibliotheque();
  const id = agent.role.id;
  const origine = agent.entree?.origine;
  const recu = origine?.type === "bibliotheque" ? origine : null;

  /* Le texte partagé, à la version suivie : il dit toutes les dépendances, choisies ou non. */
  const [partage, setPartage] = useState<string | null>(null);
  const versionSuivie = recu?.version ?? null;
  useEffect(() => {
    if (versionSuivie === null) return;
    let actif = true;
    definitionRecue(id)
      .then((t) => actif && setPartage(t))
      .catch(() => actif && setPartage(null));
    return () => {
      actif = false;
    };
  }, [definitionRecue, id, versionSuivie]);

  /* Les noms des dépendances viennent de la définition, seulement pour le compte qui l'a ajoutée. */
  const [noms, setNoms] = useState<Dependance[]>([]);
  const definitionId =
    (origine?.type === "bibliotheque" || origine?.type === "copie") && origine.compte === moiId && etat === "pret" ? origine.definitionId : null;
  useEffect(() => {
    if (!definitionId) return;
    let actif = true;
    lire(definitionId)
      .then((d) => actif && d && setNoms(d.dependances))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [lire, definitionId]);

  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /* La fiche a changé ici depuis son ajout : on demande avant de la réécrire. */
  const [conflit, setConflit] = useState<{ cle: string; dossier: string } | null>(null);

  const cles = recu
    ? [...new Set([...clesDe(partage ?? ""), ...agent.manquantes, ...Object.keys(recu.valeurs)])]
    : agent.manquantes;
  if (!cles.length) return null;

  const manquante = (cle: string) => agent.manquantes.includes(cle);
  const valeurDe = (cle: string) => (manquante(cle) ? null : (recu?.valeurs[cle] ?? null));

  /** Écrit le dossier à la place de `{{chemin:cle}}` dans la fiche actuelle, sans rien d'autre. */
  const ecrireDansMaVersion = async (cle: string, dossier: string) => {
    const fichier = agent.role.file;
    if (!fichier) return;
    const contenu = fichier.content.split(`{{chemin:${cle}}}`).join(dossier);
    await save(id, contenu, { tag: agent.role.tag, teinte: agent.role.teinte, nom: meta[id]?.nom }, fichier.modifiedAt);
    if (recu) await changerOrigine(id, { ...recu, valeurs: { ...recu.valeurs, [cle]: dossier } });
  };

  const appliquerDossier = async (cle: string, dossier: string, forcer = false) => {
    setOccupe(cle);
    setMessage(null);
    try {
      if (recu && partage) await appliquer(id, partage, { ...recu, valeurs: { ...recu.valeurs, [cle]: dossier } }, forcer);
      else await ecrireDansMaVersion(cle, dossier);
      setConflit(null);
    } catch (e) {
      if (e instanceof BridgeError && e.code === "modifie-localement") setConflit({ cle, dossier });
      else setMessage(`Le dossier n’a pas pu être enregistré : ${raison(e)}.`);
    } finally {
      setOccupe(null);
    }
  };

  const garderMesChangements = async (cle: string, dossier: string) => {
    setOccupe(cle);
    setMessage(null);
    try {
      await ecrireDansMaVersion(cle, dossier);
      setConflit(null);
    } catch (e) {
      setMessage(`Le dossier n’a pas pu être enregistré : ${raison(e)}.`);
    } finally {
      setOccupe(null);
    }
  };

  const choisir = async (cle: string) => {
    try {
      const dossier = await choisirDossier();
      if (dossier) await appliquerDossier(cle, dossier);
    } catch (e) {
      setMessage(`Le dossier n’a pas pu être choisi : ${raison(e)}.`);
    }
  };

  const reste = cles.some(manquante);

  return (
    <Bloc titre={reste ? "À configurer" : "Ce qu’il lui faut"}>
      <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
        {cles.map((cle) => {
          const valeur = valeurDe(cle);
          const modifiable = canEdit && (manquante(cle) || (!!recu && !!partage));
          return (
            <li key={cle} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-ui font-medium text-texte-principal">{libelleDe(cle, noms)}</span>
                {valeur ? (
                  <span className="klyra-mono truncate text-ui-xs text-texte-secondaire" title={valeur}>
                    {abreger(valeur, dir)}
                  </span>
                ) : (
                  <span className="text-ui-s text-texte-secondaire">Choisis le dossier qui joue ce rôle sur {poste.ce}.</span>
                )}
              </span>
              {modifiable && (
                <Bouton variant="blanc" taille="compact" disabled={occupe !== null} onClick={() => void choisir(cle)}>
                  {occupe === cle ? "Enregistrement…" : valeur ? "Changer" : "Choisir un dossier"}
                </Bouton>
              )}
            </li>
          );
        })}
      </ul>
      {reste && <p className="m-0 text-ui-s text-texte-tertiaire">Tant que ce n’est pas fait, il te dira ce qui lui manque au lieu de deviner.</p>}

      {conflit && (
        <div role="alert" className="flex flex-col gap-3 rounded-md border border-bordure-subtile bg-fond-page p-4">
          <p className="m-0 text-ui-s leading-[1.5] text-texte-principal">
            Sa fiche a été modifiée sur {poste.ce} depuis son ajout : KLYRA ne la réécrit pas sans ton accord.
            {manquante(conflit.cle)
              ? " Tu peux écrire ce dossier dans ta version telle qu’elle est, ou la remplacer par la version reçue."
              : " Pour changer ce dossier, la version reçue doit remplacer la tienne."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {manquante(conflit.cle) && (
              <Bouton variant="sombre" taille="compact" disabled={occupe !== null} onClick={() => void garderMesChangements(conflit.cle, conflit.dossier)}>
                L’écrire dans ma version
              </Bouton>
            )}
            <Bouton variant="blanc" taille="compact" disabled={occupe !== null} onClick={() => void appliquerDossier(conflit.cle, conflit.dossier, true)}>
              Remplacer ma version
            </Bouton>
            <Bouton variant="discret" taille="compact" onClick={() => setConflit(null)}>
              Annuler
            </Bouton>
          </div>
          <p className="m-0 text-ui-xs text-texte-tertiaire">En la remplaçant, ta version va dans l’historique.</p>
        </div>
      )}
      {message && (
        <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
          {message}
        </p>
      )}
    </Bloc>
  );
}
