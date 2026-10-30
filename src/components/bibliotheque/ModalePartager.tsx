"use client";

import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Input } from "klyra-ui";
import { LIMITES, preparerPublication } from "../../../convex/model/definitions";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { DiffView } from "@/components/ui/DiffView";
import { Markdown } from "@/components/ui/Markdown";
import { Modale } from "@/components/ui/Modale";
import { useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque, type DefinitionComplete } from "@/lib/bibliotheque";
import { clesDe, decouperFiche, libelleInitial, ligneMasquee, nomModele, outilsDemandes, raison } from "@/lib/bibliotheque-ui";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { lienDe } from "@/lib/lien-bibliotheque";
import { poste } from "@/lib/plateforme";
import { jouer } from "@/lib/sons/sons";
import { MODALE_DEFILANTE, useSession } from "./commun";

type Mode = "partager" | "mettre-a-jour";

/**
 * « Partager avec l'équipe » et « Publier une mise à jour » (spec §12) : l'aperçu exact de ce qui
 * part (`preparerPublication`), les chemins de l'ordinateur remplacés par des dépendances nommées,
 * ce qui reste ici. Un secret bloque. Focus initial sur Annuler : Entrée ne publie pas par accident.
 */
export function ModalePartager({ agent, mode, ouvert, onFermer }: { agent: AgentLocal; mode: Mode; ouvert: boolean; onFermer: () => void }) {
  if (!ouvert) return null;
  return <FenetrePartage agent={agent} mode={mode} onFermer={onFermer} />;
}

/** Une ligne de « Ce qui part ». */
function Part({ titre, children, action }: { titre: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <Icon name="check-01" size={16} className="mt-0.5 shrink-0 text-icone-defaut" />
      <span className="min-w-0 flex-1 text-ui-s leading-[1.5] text-texte-principal">
        <span className="font-medium">{titre}</span>
        {children && <span className="text-texte-secondaire"> · {children}</span>}
      </span>
      {action}
    </li>
  );
}

function Deplier({ ouvert, controle, onClick, children }: { ouvert: boolean; controle: string; onClick: () => void; children: ReactNode }) {
  return (
    <Bouton variant="discret" taille="mini" aria-expanded={ouvert} aria-controls={controle} onClick={onClick}>
      {children}
    </Bouton>
  );
}

function FenetrePartage({ agent, mode, onFermer }: { agent: AgentLocal; mode: Mode; onFermer: () => void }) {
  const router = useRouter();
  const { changerOrigine, canEdit } = useAgents();
  const biblio = useBibliotheque();
  const session = useSession();
  const { moi } = useCompte();
  const idTexte = useId();
  const idChangements = useId();

  const nom = agent.role.name;
  const tag = agent.role.tag;
  const contenuLocal = agent.role.file?.content ?? "";
  const lien = lienDe(agent, session);
  const origine = agent.entree?.origine;

  /* Mise à jour : la version publiée, pour montrer l'écart et ne rien publier s'il n'y en a pas. */
  const publie = mode === "mettre-a-jour" && lien.type === "publie" ? lien : null;
  const [publiee, setPubliee] = useState<DefinitionComplete | null | undefined>(undefined);
  const [erreurLecture, setErreurLecture] = useState<string | null>(null);
  const lire = biblio.lire;
  const definitionPubliee = publie?.definitionId ?? null;
  useEffect(() => {
    if (!definitionPubliee) return;
    let actif = true;
    lire(definitionPubliee)
      .then((d) => actif && setPubliee(d))
      .catch((e: unknown) => actif && setErreurLecture(raison(e)));
    return () => {
      actif = false;
    };
  }, [lire, definitionPubliee]);

  /* Les chemins trouvés, un par dépendance, et les dossiers déjà à configurer (copie d'un agent reçu). */
  const base = useMemo(() => preparerPublication(contenuLocal), [contenuLocal]);
  const chemins = useMemo(() => [...new Map(base.chemins.map((c) => [c.cle, c.chemin])).entries()], [base]);
  const restants = useMemo(() => clesDe(base.contenu).filter((cle) => !base.dependances.some((d) => d.cle === cle)), [base]);
  /* Le nom proposé pour chaque dépendance (celui déjà publié s'il y en a un), puis ce que la personne a écrit. */
  const defauts = useMemo<Record<string, string>>(() => {
    const publies = Object.fromEntries((publiee?.dependances ?? []).map((d) => [d.cle, d.libelle]));
    return {
      ...Object.fromEntries(chemins.map(([cle, chemin]) => [cle, publies[cle] ?? libelleInitial(chemin)])),
      ...Object.fromEntries(restants.map((cle) => [cle, publies[cle] ?? `Dossier « ${cle} »`])),
    };
  }, [chemins, restants, publiee]);
  const [saisis, setSaisis] = useState<Record<string, string>>({});
  const libelles = useMemo(() => ({ ...defauts, ...saisis }), [defauts, saisis]);
  const pub = useMemo(() => preparerPublication(contenuLocal, libelles), [contenuLocal, libelles]);
  const dependances = useMemo(
    () => [...pub.dependances, ...restants.map((cle) => ({ cle, libelle: (libelles[cle] ?? "").trim() }))],
    [pub, restants, libelles],
  );
  const libelleInvalide = (cle: string) => {
    const l = (libelles[cle] ?? "").trim();
    return !l ? "Donne un nom à ce dossier." : l.length > LIMITES.libelle ? `${LIMITES.libelle} caractères au plus.` : null;
  };
  const libellesOk = [...chemins.map(([cle]) => cle), ...restants].every((cle) => !libelleInvalide(cle));
  const identique = !!publiee && publiee.contenu === pub.contenu && publiee.role === tag;

  const [texteOuvert, setTexteOuvert] = useState(false);
  const [changementsOuverts, setChangementsOuverts] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [echec, setEchec] = useState<string | null>(null);
  /* Publié, mais l'app n'a pas pu le noter ici : il ne reste qu'à fermer. */
  const [inacheve, setInacheve] = useState<string | null>(null);

  const indisponible = (() => {
    if (!agent.role.file || !canEdit) return "Dans l’app de bureau.";
    if (mode === "partager") {
      if (origine?.type === "modele" || origine?.type === "bibliotheque") {
        return "Un modèle KLYRA ou un agent reçu de la bibliothèque y est déjà : il ne se partage pas.";
      }
      if (lien.type === "publie") return "Tu l’as déjà partagé : publie plutôt une mise à jour.";
    }
    switch (biblio.etat) {
      case "indisponible":
      case "deconnecte":
        return "Connecte-toi à ton compte d’équipe pour partager.";
      case "retire":
        return "Ce compte ne fait plus partie de l’équipe.";
      case "hors-ligne":
        return "Hors ligne.";
      case "chargement":
        return "Connexion au compte d’équipe…";
      case "erreur":
        return biblio.message ?? "Le serveur de l’équipe ne répond pas pour l’instant.";
      case "pret":
        break;
    }
    if (mode === "mettre-a-jour") {
      if (!publie) return "Seul son auteur peut publier une mise à jour, depuis le compte qui l’a partagé.";
      if (erreurLecture) return `La version publiée n’a pas pu être lue : ${erreurLecture}.`;
      if (publiee === undefined) return "Lecture de la version publiée…";
      if (publiee === null) return "Cette définition n’est plus dans la bibliothèque.";
      if (identique) return `Rien n’a changé depuis la version ${publie.version} publiée : il n’y a rien à publier.`;
    }
    return null;
  })();

  const possible = !indisponible && !pub.secrets.length && libellesOk && !occupe && !inacheve && !!biblio.moiId;

  const envoyer = async () => {
    if (!possible || !biblio.moiId) return;
    setOccupe(true);
    setEchec(null);
    const publication = { contenu: pub.contenu, role: tag, dependances };
    let definitionId: string;
    let version: number;
    try {
      if (publie) {
        definitionId = publie.definitionId;
        version = await biblio.mettreAJour(definitionId, publie.version, publication);
      } else {
        definitionId = await biblio.publier(publication);
        version = 1;
      }
    } catch (e) {
      setOccupe(false);
      setEchec(raison(e));
      return;
    }
    try {
      await changerOrigine(agent.role.id, { type: "local", publie: { definitionId, version, compte: biblio.moiId } });
    } catch (e) {
      setOccupe(false);
      setInacheve(`${nom} est publié (version ${version}), mais l’app n’a pas pu le noter sur ${poste.ce} : ${raison(e)}.`);
      return;
    }
    annoncer(publie ? `${nom} : version ${version} publiée.` : `${nom} partagé avec l’équipe.`);
    jouer("validation");
    onFermer();
  };

  const { entete, corps } = decouperFiche(pub.contenu);
  const lignes = corps.trim() ? corps.trim().split("\n").length : 0;
  const outils = outilsDemandes(pub.contenu);
  const description = pub.description.trim();
  const titre = publie
    ? `Publier la version ${publie.version + 1} de ${nom} ?`
    : mode === "mettre-a-jour"
      ? `Publier une mise à jour de ${nom} ?`
      : `Partager ${nom} avec l’équipe ?`;

  return (
    <Modale
      titre={titre}
      onFermer={onFermer}
      className={cn("w-[min(600px,calc(100%-48px))]", MODALE_DEFILANTE)}
      actions={
        inacheve ? (
          <Bouton variant="sombre" taille="md" onClick={onFermer}>
            Fermer
          </Bouton>
        ) : (
          <>
            <Bouton variant="blanc" taille="md" data-autofocus onClick={onFermer}>
              Annuler
            </Bouton>
            <Bouton variant="sombre" taille="md" disabled={!possible} onClick={() => void envoyer()}>
              {occupe ? "Envoi…" : mode === "partager" ? "Partager" : "Publier"}
            </Bouton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5 pt-1">
        <p className="m-0 text-ui-s leading-[1.5] text-texte-secondaire">
          {mode === "partager"
            ? "Sa définition rejoint la Bibliothèque KLYRA de ton équipe. Chacun choisit de l’ajouter ou non : personne ne la reçoit d’office."
            : "Ceux qui l’ont ajouté la recevront sous forme de proposition : rien ne change chez eux tant qu’ils ne choisissent pas."}
        </p>

        <section className="flex flex-col gap-2">
          <h3 className="m-0 text-ui-s font-semibold text-texte-principal">Ce qui part</h3>
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            <Part titre="Son nom et son rôle court">
              {pub.nom} · {tag}
            </Part>
            {description && (
              <Part
                titre="Quand l’appeler"
                action={
                  <Deplier ouvert={texteOuvert} controle={idTexte} onClick={() => setTexteOuvert((o) => !o)}>
                    {texteOuvert ? "Masquer" : "Voir tout"}
                  </Deplier>
                }
              >
                « {description.length > 70 ? `${description.slice(0, 70).trimEnd()}…` : description} »
              </Part>
            )}
            {pub.capacites.length > 0 && <Part titre="Ses capacités">{pub.capacites.join(" · ")}</Part>}
            {pub.modele && <Part titre="Le modèle demandé">{nomModele(pub.modele)}</Part>}
            {outils.length > 0 && <Part titre="Les outils demandés">{outils.join(", ")}</Part>}
            <Part
              titre="Ses consignes complètes"
              action={
                publie ? (
                  <Deplier ouvert={changementsOuverts} controle={idChangements} onClick={() => setChangementsOuverts((o) => !o)}>
                    {changementsOuverts ? "Masquer" : "Voir les changements"}
                  </Deplier>
                ) : (
                  <Deplier ouvert={texteOuvert} controle={idTexte} onClick={() => setTexteOuvert((o) => !o)}>
                    {texteOuvert ? "Masquer" : "Voir le texte"}
                  </Deplier>
                )
              }
            >
              {lignes} {lignes > 1 ? "lignes" : "ligne"}
            </Part>
          </ul>
          {/* Le texte exact qui part, chemins déjà remplacés : pas un résumé. */}
          <div
            id={idTexte}
            hidden={!texteOuvert}
            className="max-h-[40vh] overflow-auto rounded-md border border-bordure-subtile bg-fond-page p-4"
          >
            {entete && <pre className="klyra-mono m-0 mb-3 text-ui-xs leading-[1.6] whitespace-pre-wrap text-texte-secondaire">{entete}</pre>}
            <Markdown source={corps} className="text-ui-s" />
          </div>
          {publie && (
            <div id={idChangements} hidden={!changementsOuverts}>
              {publiee ? (
                <DiffView before={publiee.contenu} after={pub.contenu} />
              ) : (
                <p className="m-0 text-ui-s text-texte-tertiaire">{erreurLecture ?? "Lecture de la version publiée…"}</p>
              )}
            </div>
          )}
        </section>

        {(chemins.length > 0 || restants.length > 0) && (
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-ui-s font-semibold text-texte-principal">Chemins de ton ordinateur remplacés</h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {[...chemins, ...restants.map((cle): [string, string] => [cle, `{{chemin:${cle}}}`])].map(([cle, chemin]) => {
                const erreur = libelleInvalide(cle);
                return (
                  <li key={cle} className="flex flex-col gap-1">
                    <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
                      <span className="klyra-mono truncate text-ui-xs text-texte-secondaire" title={chemin}>
                        {chemin}
                      </span>
                      <span aria-hidden="true" className="text-texte-tertiaire">
                        →
                      </span>
                      <Input
                        size="sm"
                        value={libelles[cle] ?? ""}
                        aria-label={`Nom de la dépendance qui remplace ${chemin}`}
                        aria-invalid={erreur ? true : undefined}
                        onChange={(e) => setSaisis((l) => ({ ...l, [cle]: e.target.value }))}
                        className={CHAMP}
                      />
                    </div>
                    {erreur && <span className="text-right text-ui-xs text-texte-erreur">{erreur}</span>}
                  </li>
                );
              })}
            </ul>
            <p className="m-0 text-ui-xs text-texte-tertiaire">Chacun choisira son propre dossier. Ta fiche ne change pas.</p>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="m-0 flex items-center gap-2 text-ui-s font-semibold text-texte-secondaire">
            <Icon name="lock-01" size={16} className="text-icone-secondaire" />
            Ce qui reste sur {poste.ce}
          </h3>
          <p className="m-0 text-ui-s leading-[1.5] text-texte-secondaire">
            Sa couleur et ton nom pour lui · ses conversations, ses fils et ses sessions · ses souvenirs (mémoire) · l’historique de sa
            fiche · tes connexions et tes clés · les fichiers de tes projets
            {pub.nonPartages.length > 0 && (
              <>
                {" "}
                · les réglages de son en-tête qui ne se partagent pas (<span className="klyra-mono">{pub.nonPartages.join(", ")}</span>)
              </>
            )}
          </p>
        </section>

        {pub.secrets.length > 0 && (
          <div role="alert" className="flex flex-col gap-3 rounded-md border border-bordure-erreur bg-fond-surface p-4">
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-s text-texte-principal">
              {pub.secrets.map((s) => (
                <li key={s.ligne}>
                  Ligne {s.ligne} : « <span className="klyra-mono">{ligneMasquee(contenuLocal, s)}</span> ».
                </li>
              ))}
            </ul>
            <p className="m-0 text-ui-s text-texte-secondaire">
              {pub.secrets.length > 1
                ? "Cela ressemble à des clés. Retire-les de la fiche avant de partager."
                : "Cela ressemble à une clé. Retire-la de la fiche avant de partager."}
            </p>
            <div>
              <Bouton
                variant="blanc"
                taille="compact"
                onClick={() => {
                  onFermer();
                  router.push(`/equipe?agent=${encodeURIComponent(agent.role.id)}&mode=modifier`);
                }}
              >
                Modifier la fiche
              </Bouton>
            </div>
          </div>
        )}

        {indisponible && <p className="m-0 text-ui-s text-texte-secondaire">{indisponible}</p>}

        {moi && <p className="m-0 text-ui-s text-texte-secondaire">Publié sous ton nom : {moi.nom}.</p>}

        {echec && (
          <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-bordure-erreur bg-fond-surface p-3">
            <p className="m-0 text-ui-s text-texte-erreur">
              {mode === "partager" ? "Le partage" : "La publication"} n’a pas abouti : {echec}. Rien n’a été publié.
            </p>
            <Bouton variant="blanc" taille="compact" disabled={!possible} onClick={() => void envoyer()}>
              Réessayer
            </Bouton>
          </div>
        )}
        {inacheve && (
          <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
            {inacheve}
          </p>
        )}
      </div>
    </Modale>
  );
}
