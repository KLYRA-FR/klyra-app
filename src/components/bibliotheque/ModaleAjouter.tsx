"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { Modale } from "@/components/ui/Modale";
import { MODELES, useAgents, type AgentLocal } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useBibliotheque, type DefinitionComplete, type DefinitionResume } from "@/lib/bibliotheque";
import {
  abreger,
  clesDe,
  colleguesCites,
  enumerer,
  libelleDe,
  nomLibre,
  raison,
  teinteDefinition,
} from "@/lib/bibliotheque-ui";
import { BridgeError } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { nomDejaPris, nomPropre } from "@/lib/noms-agents";
import { poste } from "@/lib/plateforme";
import { jouer } from "@/lib/sons/sons";
import { agentDeDefinition, choisirDossier, etatCollegue, MODALE_DEFILANTE, texteCollegue, type EtatCollegue } from "./commun";

const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Ce qu'on demande d'ajouter, depuis une carte ou la fiche d'une définition. */
export type DemandeAjout = { type: "partage"; resume: DefinitionResume } | { type: "modele"; nom: string };

type Cible =
  | { type: "partage"; definition: DefinitionComplete }
  /** `existant` : la fiche est déjà sur l'ordinateur, hors de Mes agents ; elle y revient telle quelle. */
  | { type: "modele"; nom: string; existant: AgentLocal | null }
  | { type: "erreur"; nom: string; message: string };

/**
 * Ajouter une définition à Mes agents (spec §10.3). Déjà dans Mes agents : rien à faire ;
 * désactivé : réactivé, jamais un second exemplaire. Sinon, la fenêtre « Ajouter … à tes agents ? ».
 */
export function useAjout(): {
  ajouter: (demande: DemandeAjout) => Promise<void>;
  reactiver: (agent: AgentLocal) => Promise<void>;
  /** La définition en cours de lecture avant d'ouvrir la fenêtre. */
  enCours: string | null;
  fenetre: ReactNode;
} {
  const { tous, activer } = useAgents();
  const { lire } = useBibliotheque();
  const [cible, setCible] = useState<Cible | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);

  const reactiver = useCallback(
    async (agent: AgentLocal) => {
      await activer(agent.role.id, true);
      annoncer(`${agent.role.name} réactivé.`);
    },
    [activer],
  );

  const ajouter = useCallback(
    async (demande: DemandeAjout) => {
      if (demande.type === "modele") {
        const local = tous.find((a) => a.role.id === demande.nom) ?? null;
        if (local?.statut === "actif") return;
        if (local?.statut === "desactive") return reactiver(local);
        setCible({ type: "modele", nom: demande.nom, existant: local });
        return;
      }
      const local = agentDeDefinition(tous, demande.resume._id);
      if (local) {
        if (local.statut === "desactive") await reactiver(local);
        return;
      }
      setEnCours(demande.resume._id);
      try {
        const definition = await lire(demande.resume._id);
        setCible(
          definition
            ? { type: "partage", definition }
            : { type: "erreur", nom: demande.resume.nom, message: "Cette définition n’est plus dans la bibliothèque." },
        );
      } catch (e) {
        setCible({ type: "erreur", nom: demande.resume.nom, message: `Impossible de lire cette définition : ${raison(e)}.` });
      } finally {
        setEnCours(null);
      }
    },
    [tous, lire, reactiver],
  );

  const fermer = () => setCible(null);
  const fenetre =
    cible?.type === "erreur" ? (
      <Modale
        titre={`Ajouter ${cible.nom} à tes agents ?`}
        onFermer={fermer}
        actions={
          <Bouton variant="blanc" taille="md" data-autofocus onClick={fermer}>
            Fermer
          </Bouton>
        }
      >
        <p role="alert" className="m-0">
          {cible.message}
        </p>
      </Modale>
    ) : cible ? (
      <ModaleAjouter cible={cible} onFermer={fermer} />
    ) : null;

  return { ajouter, reactiver, enCours, fenetre };
}

interface Ajout {
  slug: string;
  nomPublie: string;
  contenu: string;
  tag: string;
  teinte: ReturnType<typeof teinteDefinition>;
  auteur: string;
}

function ModaleAjouter({ cible, onFermer }: { cible: Exclude<Cible, { type: "erreur" }>; onFermer: () => void }) {
  const { roles, tous, dir, canEdit, installer, ajouter, changerOrigine, saveReglage, identifiantLibre } = useAgents();
  const { moiId, definitions, lire } = useBibliotheque();

  const ajout = useMemo<Ajout>(() => {
    if (cible.type === "partage") {
      const d = cible.definition;
      return { slug: d.slug, nomPublie: d.nom, contenu: d.contenu, tag: d.role, teinte: teinteDefinition(d.slug, false), auteur: d.auteur.nom };
    }
    const modele = MODELES.find((m) => m.name === cible.nom);
    const role = cible.existant?.role ?? modele?.role;
    return {
      slug: cible.nom,
      nomPublie: role?.name ?? cible.nom,
      contenu: cible.existant?.role.file?.content ?? modele?.content ?? "",
      tag: role?.tag ?? cible.nom,
      teinte: role?.teinte ?? teinteDefinition(cible.nom, true),
      auteur: "KLYRA",
    };
  }, [cible]);
  const dependances = cible.type === "partage" ? cible.definition.dependances : [];

  const nomPris = (n: string) => !!nomDejaPris(n, roles);
  const [nomInitial] = useState(() => nomLibre(ajout.nomPublie, nomPris));
  const [nom, setNom] = useState(nomInitial);
  const [id, setId] = useState(() => (cible.type === "partage" ? identifiantLibre(ajout.slug) : ajout.slug));
  const [montrerId, setMontrerId] = useState(() => cible.type === "partage" && identifiantLibre(ajout.slug) !== ajout.slug);
  const [valeurs, setValeurs] = useState<Record<string, string>>({});
  const [coches, setCoches] = useState<Set<string>>(() => new Set());
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  /* Ajouté, mais un collègue coché n'a pas pu l'être : il ne reste qu'à fermer. */
  const [fini, setFini] = useState(false);

  const collegues = useMemo(
    () => colleguesCites(ajout.contenu, ajout.slug).map((c) => ({ c, etat: etatCollegue(c, tous, definitions) })),
    [ajout, tous, definitions],
  );
  const cles = clesDe(ajout.contenu);

  const pris = nomDejaPris(nom, roles);
  const erreurNom = !nomPropre(nom)
    ? "Donne-lui un nom."
    : nomPropre(nom).length > 60
      ? "60 caractères au plus."
      : pris
        ? `Tu as déjà un agent qui s’appelle ${pris.name}. Choisis un autre nom pour les distinguer dans les chats.`
        : undefined;
  const erreurId = !montrerId
    ? undefined
    : !NOM_VALIDE.test(id)
      ? "Minuscules, chiffres et tirets seulement, sans espace ni accent."
      : identifiantLibre(id) !== id
        ? "Cet identifiant est déjà pris."
        : undefined;
  const [focusNom] = useState(() => !!erreurNom);
  const possible = canEdit && !erreurNom && !erreurId && !occupe;

  const choisir = async (cle: string) => {
    try {
      const dossier = await choisirDossier();
      if (dossier) setValeurs((v) => ({ ...v, [cle]: dossier }));
    } catch (e) {
      setMessage(`Le dossier n’a pas pu être choisi : ${raison(e)}.`);
    }
  };

  const basculer = (cle: string, oui: boolean) =>
    setCoches((avant) => {
      const apres = new Set(avant);
      if (oui) apres.add(cle);
      else apres.delete(cle);
      return apres;
    });

  /** Un collègue coché : le modèle KLYRA, sinon la définition partagée, sous son propre identifiant. */
  const ajouterCollegue = async (cleId: string, etat: EtatCollegue) => {
    if (etat.type === "modele") {
      const modele = MODELES.find((m) => m.name === cleId);
      if (!modele) return;
      await installer(
        { _id: `klyra:${modele.name}`, slug: modele.name, contenu: modele.content, version: 1, auteur: { nom: "KLYRA" } },
        { id: modele.name, origine: { type: "modele", modele: modele.name } },
      );
      return;
    }
    if (etat.type !== "partage" || !moiId) return;
    const d = await lire(etat.definition._id);
    if (!d) throw new Error("cette définition n’est plus dans la bibliothèque");
    const idCollegue = identifiantLibre(d.slug);
    await installer(d, {
      id: idCollegue,
      origine: { type: "bibliotheque", definitionId: d._id, version: d.version, auteur: d.auteur.nom, compte: moiId, valeurs: {}, ignoree: null },
    });
    await saveReglage(idCollegue, { tag: d.role, teinte: teinteDefinition(d.slug, false) });
  };

  const confirmer = async () => {
    if (!possible) return;
    setOccupe(true);
    setMessage(null);
    const nomFinal = nomPropre(nom);
    const nomPerso = nomFinal !== ajout.nomPublie ? nomFinal : undefined;
    const idFinal = cible.type === "partage" ? id : cible.nom;
    try {
      if (cible.type === "partage") {
        if (!moiId) throw new Error("Connecte-toi à ton compte d’équipe pour ajouter un agent partagé");
        const d = cible.definition;
        const choisies = Object.fromEntries(Object.entries(valeurs).filter(([, v]) => v.trim()));
        await installer(d, {
          id,
          origine: { type: "bibliotheque", definitionId: d._id, version: d.version, auteur: d.auteur.nom, compte: moiId, valeurs: choisies, ignoree: null },
          valeurs: choisies,
        });
      } else if (cible.existant) {
        /* Déjà sur l'ordinateur : remise dans Mes agents telle quelle, sans `-2`. */
        await ajouter(cible.nom);
        await changerOrigine(cible.nom, { type: "modele", modele: cible.nom });
      } else {
        await installer(
          { _id: `klyra:${cible.nom}`, slug: cible.nom, contenu: ajout.contenu, version: 1, auteur: { nom: "KLYRA" } },
          { id: cible.nom, origine: { type: "modele", modele: cible.nom } },
        );
      }
    } catch (e) {
      setOccupe(false);
      if (e instanceof BridgeError && e.code === "existe-deja") {
        setMontrerId(cible.type === "partage");
        setMessage(`Un agent « ${id} » existe déjà sur ${poste.ce} : rien n’a été écrasé.${cible.type === "partage" ? " Choisis un autre identifiant." : ""}`);
      } else {
        setMessage(`L’ajout n’a pas abouti : ${raison(e)}.`);
      }
      return;
    }

    const ajoutes = [nomFinal];
    const rates: string[] = [];
    let raisonRate = "";
    /* Son rôle court et sa couleur, comme sur la carte ; le nom choisi ne coupe pas le lien. */
    if (cible.type === "partage" || nomPerso) {
      try {
        await saveReglage(idFinal, { tag: ajout.tag, teinte: ajout.teinte, nom: nomPerso });
      } catch (e) {
        rates.push(`son nom « ${nomFinal} »`);
        raisonRate = raison(e);
      }
    }
    for (const { c, etat } of collegues) {
      if (!coches.has(c.id) || (etat.type !== "modele" && etat.type !== "partage")) continue;
      try {
        await ajouterCollegue(c.id, etat);
        ajoutes.push(etat.nom);
      } catch (e) {
        rates.push(etat.nom);
        raisonRate = raison(e);
      }
    }
    annoncer(`${enumerer(ajoutes)} ${ajoutes.length > 1 ? "ajoutés" : "ajouté"} à tes agents.`);
    jouer("validation");
    if (rates.length) {
      setOccupe(false);
      setFini(true);
      setMessage(`${enumerer(ajoutes)} ${ajoutes.length > 1 ? "sont ajoutés" : "est ajouté"}, mais pas ${enumerer(rates)} : ${raisonRate}.`);
      return;
    }
    onFermer();
  };

  const note =
    cible.type === "partage"
      ? `Tu recevras les nouvelles versions de ${ajout.auteur} sous forme de proposition. Tes conversations avec lui restent sur ${poste.ce}.`
      : cible.existant
        ? `Sa fiche revient telle qu’elle est sur ${poste.ce} : rien n’est réécrit. Tes conversations avec lui restent sur ${poste.ce}.`
        : `Les nouvelles versions du modèle arriveront avec l’app, sous forme de proposition. Tes conversations avec lui restent sur ${poste.ce}.`;

  return (
    <Modale
      titre={`Ajouter ${ajout.nomPublie} à tes agents ?`}
      onFermer={onFermer}
      className={cn("w-[min(520px,calc(100%-48px))]", MODALE_DEFILANTE)}
      actions={
        fini ? (
          <Bouton variant="sombre" taille="md" onClick={onFermer}>
            Fermer
          </Bouton>
        ) : (
          <>
            <Bouton variant="blanc" taille="md" onClick={onFermer}>
              Annuler
            </Bouton>
            <Bouton
              variant="sombre"
              taille="md"
              data-autofocus={focusNom ? undefined : true}
              disabled={!possible}
              title={canEdit ? undefined : "Dans l’app de bureau"}
              onClick={() => void confirmer()}
            >
              {occupe ? "Ajout…" : "Ajouter"}
            </Bouton>
          </>
        )
      }
    >
      <div className="flex flex-col gap-5 pt-2 text-ui text-texte-principal">
        <Champ
          label="Nom affiché"
          erreur={erreurNom}
          aide={
            nomInitial !== ajout.nomPublie && nom === nomInitial
              ? `Tu as déjà un agent qui s’appelle ${ajout.nomPublie} : celui-ci s’appellera ${nomInitial}. Tu peux choisir un autre nom.`
              : "Le nom que tu lui donnes dans tes chats. Il ne coupe pas le lien avec la bibliothèque."
          }
        >
          <Input size="sm" value={nom} data-autofocus={focusNom ? true : undefined} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        </Champ>

        {montrerId && (
          <Champ label="Identifiant" erreur={erreurId} aide={`« ${ajout.slug} » existe déjà sur ${poste.ce} : rien ne sera écrasé.`}>
            <Input size="sm" value={id} onChange={(e) => setId(e.target.value.toLowerCase())} className={cn(CHAMP, "klyra-mono")} />
          </Champ>
        )}

        {collegues.length > 0 && (
          <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
            <legend className="mb-2 p-0 text-ui-s font-medium text-texte-principal">Il passe la main à</legend>
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-ui-s">
              {collegues.map(({ c, etat }) => {
                const ajoutable = etat.type === "modele" || etat.type === "partage";
                const nomCollegue = ajoutable ? etat.nom : "";
                if (ajoutable && !nomDejaPris(nomCollegue, roles)) {
                  return (
                    <li key={c.id}>
                      <label className="flex cursor-pointer items-start gap-2.5 text-texte-principal">
                        <input
                          type="checkbox"
                          checked={coches.has(c.id)}
                          onChange={(e) => basculer(c.id, e.target.checked)}
                          className="mt-0.5 size-4 accent-[var(--color-bleu-k1-500)]"
                        />
                        <span>
                          Ajouter aussi {nomCollegue} ({c.id}) <span className="text-texte-tertiaire">· dans la bibliothèque</span>
                        </span>
                      </label>
                    </li>
                  );
                }
                return (
                  <li key={c.id} className="flex items-start gap-2.5 text-texte-secondaire">
                    {etat.type === "actif" ? (
                      <Icon name="check-01" size={16} className="mt-0.5 shrink-0 text-icone-defaut" />
                    ) : (
                      <span aria-hidden="true" className="w-4 shrink-0 text-center text-texte-tertiaire">
                        —
                      </span>
                    )}
                    <span>{ajoutable ? `${nomCollegue} (${c.id}) · nom déjà pris : ajoute-le seul` : texteCollegue(c, etat)}</span>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        )}

        {cles.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-ui-s font-medium text-texte-principal">À configurer sur {poste.ce}</h3>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {cles.map((cle) => (
                <li key={cle} className="flex items-center justify-between gap-3 rounded-md bg-fond-page px-3 py-2">
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="text-ui-s font-medium text-texte-principal">{libelleDe(cle, dependances)}</span>
                    {valeurs[cle] ? (
                      <span className="klyra-mono truncate text-ui-xs text-texte-secondaire" title={valeurs[cle]}>
                        {abreger(valeurs[cle], dir)}
                      </span>
                    ) : (
                      <span className="text-ui-xs text-texte-tertiaire">Facultatif maintenant : sans choix, il arrive « À configurer ».</span>
                    )}
                  </span>
                  <Bouton variant="blanc" taille="compact" disabled={!canEdit || occupe} onClick={() => void choisir(cle)}>
                    {valeurs[cle] ? "Changer" : "Choisir un dossier"}
                  </Bouton>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="m-0 text-ui-s leading-[1.5] text-texte-secondaire">{note}</p>

        {message && (
          <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
            {message}
          </p>
        )}
      </div>
    </Modale>
  );
}
