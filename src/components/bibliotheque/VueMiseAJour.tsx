"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { avecIdentifiant } from "../../../convex/model/definitions";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { DiffView } from "@/components/ui/DiffView";
import { useConfirmation } from "@/components/ui/Modale";
import { getField, parseAgentFile } from "@/lib/agent-file";
import { useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque, type DefinitionComplete } from "@/lib/bibliotheque";
import { avecLibelles, clesDe, dateCourte, libelleDe, lisible, nomModele, raison } from "@/lib/bibliotheque-ui";
import { BridgeError } from "@/lib/bridge";
import { consigne, lienDe, modeleEmbarque } from "@/lib/lien-bibliotheque";
import { poste } from "@/lib/plateforme";
import { jouer } from "@/lib/sons/sons";
import { useSession } from "./commun";

const modeleDe = (contenu: string) => getField(parseAgentFile(contenu).frontmatter, "model") ?? "";

/** L'écran, sur le modèle de l'historique : titre, contenu, puis la barre des choix, toujours visible. */
function Ecran({ titre, sousTitre, children, barre }: { titre: ReactNode; sousTitre?: ReactNode; children?: ReactNode; barre: ReactNode }) {
  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[960px] flex-col gap-5 px-8 pt-8 pb-10">
          <div className="flex flex-col gap-2">
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">{titre}</h1>
            {sousTitre && <p className="m-0 text-ui text-texte-secondaire">{sousTitre}</p>}
          </div>
          {children}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2 border-t border-bordure-subtile bg-fond-surface px-8 py-3">{barre}</div>
    </div>
  );
}

function Erreur({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-4 text-ui text-texte-erreur">
      {children}
    </p>
  );
}

/** « Ce que j'ai changé » : replié, comme le demande la spec. */
function MesChangements({ avant, apres }: { avant: string; apres: string }) {
  return (
    <details className="group rounded-xl border border-bordure-subtile bg-fond-page p-4">
      <summary className="cursor-pointer list-none text-ui-s font-medium text-texte-principal">Voir ce que j’ai changé</summary>
      <DiffView before={avant} after={apres} className="mt-3" />
    </details>
  );
}

/**
 * `&mode=maj` (spec §13.1, §13.2, §13.3, §6) : la nouvelle version d'un agent reçu, d'une copie privée ou
 * d'un modèle KLYRA, comparée à la consigne actuelle. Rien ne change sur le disque avant un choix.
 */
export function VueMiseAJour({ agent }: { agent: AgentLocal }) {
  const router = useRouter();
  const { appliquer, changerOrigine, save, definitionRecue, meta, canEdit } = useAgents();
  const biblio = useBibliotheque();
  const session = useSession();
  const [demander, fenetre] = useConfirmation();

  const id = agent.role.id;
  const nom = agent.role.name;
  const origine = agent.entree?.origine;
  const lien = lienDe(agent, session);
  const fichier = agent.role.file;
  const actuel = fichier?.content ?? "";
  const retour = () => router.push(`/equipe?agent=${encodeURIComponent(id)}`);

  const recu = origine?.type === "bibliotheque" && lien.type === "recu" ? origine : null;
  const copie = origine?.type === "copie" && lien.type === "copie" && lien.auteur !== null ? origine : null;
  const modele = origine?.type === "modele" ? origine : null;

  /* La dernière version partagée, lue pour la session qui l'a ajoutée. */
  const definitionId = recu?.definitionId ?? copie?.definitionId ?? null;
  const versionServeur = definitionId ? (session.etats.get(definitionId)?.version ?? 0) : 0;
  const [derniere, setDerniere] = useState<DefinitionComplete | null | undefined>(undefined);
  const [erreurLecture, setErreurLecture] = useState<string | null>(null);
  const [tour, setTour] = useState(0);
  const lire = biblio.lire;
  useEffect(() => {
    if (!definitionId) return;
    let actif = true;
    lire(definitionId)
      .then((d) => {
        if (!actif) return;
        setDerniere(d);
        setErreurLecture(null);
      })
      .catch((e: unknown) => actif && setErreurLecture(raison(e)));
    return () => {
      actif = false;
    };
  }, [lire, definitionId, versionServeur, tour]);

  /* La définition reçue, à la version suivie : pour « Voir ce que j'ai changé » et les nouvelles dépendances. */
  const [recue, setRecue] = useState<string | null>(null);
  const versionSuivie = recu?.version ?? null;
  useEffect(() => {
    if (versionSuivie === null) return;
    let actif = true;
    definitionRecue(id)
      .then((t) => actif && setRecue(t))
      .catch(() => undefined);
    return () => {
      actif = false;
    };
  }, [definitionRecue, id, versionSuivie]);

  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /* L'app a refusé d'écrire : la fiche a changé ici entre-temps. On passe aux trois choix. */
  const [modifieDetecte, setModifieDetecte] = useState(false);

  const agir = async (action: () => Promise<void>, apres: () => void) => {
    setOccupe(true);
    setMessage(null);
    try {
      await action();
      apres();
      retour();
    } catch (e) {
      setOccupe(false);
      if (e instanceof BridgeError && e.code === "modifie-localement") {
        setModifieDetecte(true);
        setMessage(`La fiche de ${nom} vient d’être modifiée sur ${poste.ce} : rien n’a été écrit. Choisis ce que tu veux en faire.`);
      } else {
        setMessage(`Rien n’a changé : ${raison(e)}.`);
      }
    }
  };

  const barreRetour = (
    <Bouton variant="blanc" taille="md" onClick={retour}>
      Retour à la fiche
    </Bouton>
  );
  const simple = (texte: ReactNode) => (
    <Ecran titre={<span className="font-semibold">{nom}</span>} barre={barreRetour}>
      <p className="m-0 text-ui text-texte-secondaire">{texte}</p>
    </Ecran>
  );

  const ligneModele = (nouveau: string) => {
    const avant = modeleDe(actuel);
    if (avant === nouveau) return null;
    return nouveau
      ? `Le modèle passe à ${nomModele(nouveau)} : c’est celui de cette version.`
      : "Cette version ne demande pas de modèle : il prendra celui par défaut.";
  };

  /* ─── Modèle KLYRA (§6) : on ne sait pas si l'écart est une personnalisation ou une ancienne version. */
  if (modele) {
    const reference = modeleEmbarque(modele.modele);
    if (!reference) return simple("Ce modèle KLYRA n’existe plus dans cette version de l’app.");
    if (lien.type === "modele" && lien.aJour) return simple(`${nom} est identique au modèle KLYRA de cette version de l’app.`);
    const texte = modele.modele === id ? reference : avecIdentifiant(reference, id);
    const autreModele = ligneModele(modeleDe(reference));
    return (
      <Ecran
        titre={
          <>
            <span className="font-semibold">Modèle KLYRA</span> <span className="font-normal">de {nom}</span>
          </>
        }
        sousTitre={`Ta version diffère du modèle KLYRA de cette version de l’app. Ce peut être une personnalisation ou une ancienne version : compare, puis choisis.`}
        barre={
          <>
            <Bouton variant="blanc" taille="md" disabled={occupe} onClick={retour}>
              Garder ma version
            </Bouton>
            <Bouton
              variant="blanc"
              taille="md"
              disabled={occupe || !canEdit}
              onClick={() => void agir(() => changerOrigine(id, { type: "local" }), () => annoncer(`${nom} est maintenant ta copie privée.`))}
            >
              Copier en privé
            </Bouton>
            <span className="flex flex-col items-end gap-0.5">
              <Bouton
                variant="sombre"
                taille="md"
                disabled={occupe || !canEdit || !fichier}
                onClick={() =>
                  void agir(
                    () => save(id, texte, { tag: agent.role.tag, teinte: agent.role.teinte, nom: meta[id]?.nom }, fichier?.modifiedAt ?? null),
                    () => {
                      annoncer(`${nom} remplacé par le modèle KLYRA.`);
                      jouer("validation");
                    },
                  )
                }
              >
                Remplacer
              </Bouton>
              <span className="text-ui-xs text-texte-tertiaire">Ta version va dans l’historique.</span>
            </span>
          </>
        }
      >
        {message && <Erreur>{message}</Erreur>}
        <DiffView before={consigne(actuel)} after={consigne(texte)} />
        <p className="m-0 text-ui-s text-texte-tertiaire">
          Tu gardes ton nom pour lui ({nom}), ta couleur, ton rôle court et ses conversations.{autreModele ? ` ${autreModele}` : ""}
        </p>
      </Ecran>
    );
  }

  /* ─── Agent reçu ou copie privée : il faut la session qui l'a ajouté. */
  if (origine?.type === "bibliotheque" && !recu) {
    return simple("Le lien avec la bibliothèque est suspendu sous cette session : ses mises à jour ne se voient qu’avec le compte qui l’a ajouté.");
  }
  if (origine?.type === "copie" && !copie) {
    return simple("Ta copie privée ne se compare qu’avec le compte qui l’a reçue.");
  }
  const lie = recu ?? copie;
  if (!lie) return simple(`Pas de mise à jour pour ${nom}.`);

  if (erreurLecture) {
    return (
      <Ecran
        titre={<span className="font-semibold">{nom}</span>}
        barre={
          <>
            {barreRetour}
            <Bouton variant="sombre" taille="md" onClick={() => setTour((t) => t + 1)}>
              Réessayer
            </Bouton>
          </>
        }
      >
        <Erreur>La nouvelle version n’a pas pu être lue : {erreurLecture}.</Erreur>
      </Ecran>
    );
  }
  if (derniere === undefined) return simple("Lecture de la nouvelle version…");
  if (derniere === null) return simple("Cette définition n’est plus dans la bibliothèque.");

  if (derniere.version <= lie.version) return simple(`${nom} suit déjà la dernière version (version ${lie.version}).`);

  const valeurs = recu?.valeurs ?? {};
  const nouvelle = lisible(derniere.contenu, valeurs, derniere.dependances);
  const autreModele = ligneModele(modeleDe(derniere.contenu));
  const titre = (
    <>
      <span className="font-semibold">Version {derniere.version}</span> <span className="font-normal">de {nom}</span>
    </>
  );

  /* ─── Copie privée (§13.3) : le seul chemin de retour vers la version de l'auteur. */
  if (copie) {
    const revenir = async () => {
      const oui = await demander({
        titre: `Revenir à la version de ${derniere.auteur.nom} ?`,
        texte: `Ta consigne sera remplacée par la version ${derniere.version}. L’actuelle reste dans l’historique.${
          derniere.dependances.length ? " Ses dossiers seront à choisir de nouveau." : ""
        }`,
        confirmer: "Revenir à cette version",
      });
      if (!oui) return;
      await agir(
        () =>
          appliquer(
            id,
            derniere.contenu,
            {
              type: "bibliotheque",
              definitionId: copie.definitionId,
              version: derniere.version,
              auteur: derniere.auteur.nom,
              compte: copie.compte,
              valeurs: {},
              ignoree: null,
            },
            true,
          ),
        () => {
          annoncer(`${nom} mis à jour (version ${derniere.version}).`);
          jouer("validation");
        },
      );
    };
    return (
      <Ecran
        titre={titre}
        sousTitre={`Publiée par ${derniere.auteur.nom} le ${dateCourte(derniere.majLe)} · ta copie privée part de la version ${copie.version}`}
        barre={
          <>
            <Bouton variant="blanc" taille="md" disabled={occupe} onClick={retour}>
              Garder ma copie
            </Bouton>
            <Bouton variant="sombre" taille="md" disabled={occupe || !canEdit || !fichier} onClick={() => void revenir()}>
              Revenir à la version de {derniere.auteur.nom}
            </Bouton>
          </>
        }
      >
        {fenetre}
        {message && <Erreur>{message}</Erreur>}
        <DiffView before={consigne(actuel)} after={consigne(nouvelle)} />
      </Ecran>
    );
  }

  /* ─── Agent reçu (§13.1, §13.2). */
  if (!recu) return null;
  const r = recu;
  const modifie = agent.modifie || modifieDetecte;
  const connues = new Set([...clesDe(recue ?? ""), ...Object.keys(r.valeurs), ...agent.manquantes]);
  const nouvellesDependances = derniere.dependances.filter((d) => !connues.has(d.cle));
  const origineMaj = { ...r, version: derniere.version, auteur: derniere.auteur.nom, ignoree: null };
  const mettreAJour = (forcer: boolean) =>
    void agir(
      () => appliquer(id, derniere.contenu, origineMaj, forcer),
      () => {
        annoncer(`${nom} mis à jour (version ${derniere.version}).`);
        jouer("validation");
      },
    );

  return (
    <Ecran
      titre={titre}
      sousTitre={`Publiée par ${derniere.auteur.nom} le ${dateCourte(derniere.majLe)} · tu as la version ${r.version}`}
      barre={
        modifie ? (
          <>
            <Bouton
              variant="blanc"
              taille="md"
              disabled={occupe || !canEdit}
              onClick={() =>
                void agir(() => changerOrigine(id, { ...r, ignoree: derniere.version }), () => annoncer(`Tu gardes ta version de ${nom}.`))
              }
            >
              Garder ma version
            </Bouton>
            <Bouton
              variant="blanc"
              taille="md"
              disabled={occupe || !canEdit}
              onClick={() =>
                void agir(
                  () => changerOrigine(id, { type: "copie", definitionId: r.definitionId, version: r.version, auteur: r.auteur, compte: r.compte }),
                  () => annoncer(`${nom} est maintenant ta copie privée.`),
                )
              }
            >
              Copier en privé
            </Bouton>
            <span className="flex flex-col items-end gap-0.5">
              <Bouton variant="sombre" taille="md" disabled={occupe || !canEdit || !fichier} onClick={() => mettreAJour(true)}>
                Remplacer
              </Bouton>
              <span className="text-ui-xs text-texte-tertiaire">Ta version va dans l’historique.</span>
            </span>
          </>
        ) : (
          <>
            <Bouton variant="blanc" taille="md" disabled={occupe} onClick={retour}>
              Plus tard
            </Bouton>
            <BoutonPrincipal disabled={occupe || !canEdit || !fichier} onClick={() => mettreAJour(false)}>
              Mettre à jour
            </BoutonPrincipal>
          </>
        )
      }
    >
      {message && <Erreur>{message}</Erreur>}
      {modifie && (
        <div className="flex flex-col gap-3">
          <p className="m-0 text-ui text-texte-principal">Ta version a été modifiée sur {poste.ce} depuis la version {r.version}.</p>
          {recue && <MesChangements avant={consigne(lisible(recue, r.valeurs, derniere.dependances))} apres={consigne(actuel)} />}
        </div>
      )}
      <DiffView before={consigne(avecLibelles(actuel, derniere.dependances))} after={consigne(nouvelle)} />
      {nouvellesDependances.length > 0 && (
        <p className="m-0 text-ui text-texte-principal">
          Cette version demande aussi : {nouvellesDependances.map((d) => `${libelleDe(d.cle, derniere.dependances)} (à configurer)`).join(", ")}.
        </p>
      )}
      <p className="m-0 text-ui-s text-texte-tertiaire">
        Tu gardes ton nom pour lui ({nom}), ta couleur, ton rôle court{autreModele ? "" : ", ton modèle"}, ses dépendances configurées et ses
        conversations.{autreModele ? ` ${autreModele}` : ""}
      </p>
    </Ecran>
  );
}
