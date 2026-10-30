"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
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
import { cn } from "@/lib/cn";
import { consigne, lienDe } from "@/lib/lien-bibliotheque";
import { comparerAuModele, fusionnerAvecModele, remplacerParModele, versionsDuModele, type Changement, type Choix, type Conflit } from "@/lib/maj-modele";
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
  const { appliquer, changerOrigine, definitionRecue, canEdit } = useAgents();
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

  /* ─── Modèle KLYRA (§6) : nouvelle version du modèle, ou personnalisation. */
  if (modele) return <MiseAJourModele agent={agent} modeleKlyra={modele.modele} ignoree={modele.ignoree} />;

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

const listeChangements = (liste: Changement[]) =>
  liste.map((c) => (c.etat === "ajoutee" ? `${c.titre} (nouvelle)` : c.etat === "retiree" ? `${c.titre} (retirée)` : c.titre)).join(", ");

/** Une partie modifiée des deux côtés : la sienne ou celle du modèle (la sienne par défaut). */
function ChoixConflit({ conflit, choix, onChoisir }: { conflit: Conflit; choix: Choix; onChoisir: (choix: Choix) => void }) {
  const options: [Choix, string][] = [
    ["mienne", conflit.mienne === null ? "La laisser retirée" : "Garder la mienne"],
    ["modele", conflit.modele === null ? "La retirer, comme le modèle" : "Prendre celle du modèle"],
  ];
  return (
    <li className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0" data-conflit={conflit.cle}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-ui font-medium text-texte-principal">{conflit.titre}</span>
        <div role="radiogroup" aria-label={`Version de « ${conflit.titre} » à garder`} className="flex flex-wrap gap-0.5 rounded-sm bg-fond-surface-grise p-0.5">
          {options.map(([valeur, libelle]) => (
            <button
              key={valeur}
              type="button"
              role="radio"
              aria-checked={choix === valeur}
              onClick={() => onChoisir(valeur)}
              className={cn(
                "h-8 cursor-pointer rounded-2xs border-0 px-3 text-ui-xs font-medium transition-colors duration-[220ms] ease-sortie",
                choix === valeur ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "bg-transparent text-texte-secondaire hover:text-texte-principal",
              )}
            >
              {libelle}
            </button>
          ))}
        </div>
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none text-ui-xs text-texte-tertiaire">Voir les deux versions</summary>
        <DiffView before={conflit.mienne ?? ""} after={conflit.modele ?? ""} className="mt-2" />
      </details>
    </li>
  );
}

/**
 * Un agent venu d'un modèle KLYRA face au modèle de cette version de l'app (§6) :
 * - fiche d'une version antérieure, jamais modifiée : « Mettre à jour » ou « Plus tard » ;
 * - fiche modifiée depuis une version antérieure : la mise à jour reprend ce qui n'a pas été touché,
 *   garde ses modifications, et chaque partie modifiée des deux côtés se choisit ;
 * - fiche modifiée depuis le modèle actuel : ce sont ses modifications, à garder ou à remplacer.
 * L'en-tête de la fiche (prénom, modèle d'IA, mémoire, outils) et les réglages ne bougent jamais ;
 * la version remplacée va dans l'historique, et une fiche changée entre-temps n'est pas écrite.
 */
function MiseAJourModele({ agent, modeleKlyra, ignoree }: { agent: AgentLocal; modeleKlyra: string; ignoree?: number }) {
  const router = useRouter();
  const { save, changerOrigine, canEdit } = useAgents();
  const [choix, setChoix] = useState<Record<string, Choix>>({});
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const id = agent.role.id;
  const nom = agent.role.name;
  const fichier = agent.role.file;
  const actuel = fichier?.content ?? "";
  const retour = () => router.push(`/equipe?agent=${encodeURIComponent(id)}`);
  const comparaison = comparerAuModele(modeleKlyra, actuel);
  const fusion = comparaison ? fusionnerAvecModele(modeleKlyra, id, actuel, choix) : null;
  const remplacement = comparaison ? remplacerParModele(modeleKlyra, id, actuel) : null;

  const agir = async (action: () => Promise<void>, apres: () => void) => {
    setOccupe(true);
    setMessage(null);
    try {
      await action();
      apres();
      retour();
    } catch (e) {
      setOccupe(false);
      setMessage(
        e instanceof BridgeError && e.code === "conflit"
          ? `La fiche de ${nom} vient de changer sur ${poste.ce} : rien n’a été écrit. La comparaison ci-dessous est à jour : relis-la avant de choisir.`
          : `Rien n’a changé : ${raison(e)}.`,
      );
    }
  };
  /* Les réglages (nom, couleur, rôle court) ne passent pas : ils restent tels quels. */
  const ecrire = (contenu: string, annonce: string) =>
    void agir(
      async () => {
        await save(id, contenu, {}, fichier?.modifiedAt ?? null);
        if (ignoree !== undefined) await changerOrigine(id, { type: "modele", modele: modeleKlyra });
      },
      () => {
        annoncer(annonce);
        jouer("validation");
      },
    );

  const barreRetour = (
    <Bouton variant="blanc" taille="md" onClick={retour}>
      Retour à la fiche
    </Bouton>
  );
  if (!comparaison || !fusion || !remplacement) {
    return (
      <Ecran titre={<span className="font-semibold">{nom}</span>} barre={barreRetour}>
        <p className="m-0 text-ui text-texte-secondaire">Ce modèle KLYRA n’existe plus dans cette version de l’app.</p>
      </Ecran>
    );
  }
  if (comparaison.identiqueA === comparaison.version) {
    return (
      <Ecran titre={<span className="font-semibold">{nom}</span>} barre={barreRetour}>
        <p className="m-0 text-ui text-texte-secondaire">{nom} est identique au modèle KLYRA de cette version de l’app.</p>
      </Ecran>
    );
  }

  const { version, base } = comparaison;
  const nouvelle = base < version;
  const intacte = comparaison.identiqueA !== null;
  const apres = nouvelle ? fusion.contenu : remplacement;
  const contenuBase = versionsDuModele(modeleKlyra).find((v) => v.version === base)?.content ?? "";
  const modeleIa = getField(parseAgentFile(actuel).frontmatter, "model");
  const ecritureImpossible = occupe || !canEdit || !fichier;

  const garder = () =>
    void agir(
      () => changerOrigine(id, { type: "modele", modele: modeleKlyra, ignoree: version }),
      () => annoncer(`Tu gardes ta version de ${nom}.`),
    );
  const copier = () => void agir(() => changerOrigine(id, { type: "local" }), () => annoncer(`${nom} est maintenant ta copie privée.`));
  const mettreAJour = () => ecrire(fusion.contenu, `${nom} mis à jour (modèle KLYRA, version ${version}).`);

  return (
    <Ecran
      titre={
        nouvelle ? (
          <>
            <span className="font-semibold">Version {version} du modèle KLYRA</span> <span className="font-normal">de {nom}</span>
          </>
        ) : (
          <>
            <span className="font-semibold">Modèle KLYRA</span> <span className="font-normal">de {nom}</span>
          </>
        )
      }
      sousTitre={
        !nouvelle
          ? "Ta fiche diffère du modèle KLYRA de cette version de l’app : ce sont tes modifications. Compare, puis choisis."
          : intacte
            ? `Ta fiche est la version ${base} du modèle, sans modification. Rien ne change tant que tu ne choisis pas.`
            : `Ta fiche a été modifiée depuis la version ${base} du modèle. La mise à jour reprend ce que tu n’as pas touché et garde tes modifications.`
      }
      barre={
        nouvelle && intacte ? (
          <>
            <Bouton variant="blanc" taille="md" disabled={occupe} onClick={retour}>
              Plus tard
            </Bouton>
            <BoutonPrincipal disabled={ecritureImpossible} onClick={mettreAJour}>
              Mettre à jour
            </BoutonPrincipal>
          </>
        ) : (
          <>
            <Bouton variant="blanc" taille="md" disabled={occupe || !canEdit} onClick={garder}>
              Garder ma version
            </Bouton>
            <Bouton variant="blanc" taille="md" disabled={occupe || !canEdit} onClick={copier}>
              Copier en privé
            </Bouton>
            <span className="flex flex-col items-end gap-0.5">
              <Bouton
                variant={nouvelle ? "blanc" : "sombre"}
                taille="md"
                disabled={ecritureImpossible}
                onClick={() => ecrire(remplacement, `${nom} remplacé par le modèle KLYRA.`)}
              >
                Remplacer par le modèle
              </Bouton>
              <span className="text-ui-xs text-texte-tertiaire">Tes modifications vont dans l’historique.</span>
            </span>
            {nouvelle && (
              <BoutonPrincipal disabled={ecritureImpossible} onClick={mettreAJour}>
                Mettre à jour
              </BoutonPrincipal>
            )}
          </>
        )
      }
    >
      {message && <Erreur>{message}</Erreur>}
      {nouvelle && !intacte && (
        <div className="flex flex-col gap-3 rounded-xl border border-bordure-subtile bg-fond-page p-4 text-ui text-texte-principal">
          {fusion.reprises.length > 0 && (
            <p className="m-0">
              <span className="font-medium">Repris du modèle</span>, là où tu n’avais rien changé : {listeChangements(fusion.reprises)}.
            </p>
          )}
          {fusion.gardees.length > 0 && (
            <p className="m-0">
              <span className="font-medium">Tes modifications gardées</span> : {listeChangements(fusion.gardees)}.
            </p>
          )}
          {fusion.conflits.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="m-0">
                <span className="font-medium">Modifiées des deux côtés</span> : choisis pour chacune. Par défaut, ta version est gardée.
              </p>
              <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
                {fusion.conflits.map((c) => (
                  <ChoixConflit key={c.cle} conflit={c} choix={choix[c.cle] ?? "mienne"} onChoisir={(v) => setChoix((x) => ({ ...x, [c.cle]: v }))} />
                ))}
              </ul>
            </div>
          )}
          <MesChangements avant={consigne(contenuBase)} apres={consigne(actuel)} />
        </div>
      )}
      <DiffView before={consigne(actuel)} after={consigne(apres)} />
      <p className="m-0 text-ui-s text-texte-tertiaire">
        Tu gardes son nom ({nom}), sa couleur, son rôle court{modeleIa ? `, son modèle (${nomModele(modeleIa)})` : ""}, le reste de son en-tête et ses
        conversations. Ta version actuelle va dans l’historique.
      </p>
    </Ecran>
  );
}
