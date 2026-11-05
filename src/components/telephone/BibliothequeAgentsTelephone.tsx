"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { MODELES, roleFromContent } from "@/lib/agents";
import { useBibliotheque, type DefinitionComplete } from "@/lib/bibliotheque";
import { dateCourte, teinteDefinition } from "@/lib/bibliotheque-ui";
import { useLecturePoste } from "@/lib/poste/client";
import { agentDeLaBibliotheque, roleLisible, type EtatAgentPoste, type EtatsAgentsPoste } from "@/lib/telephone/agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import type { RoleTeinte } from "@/types/domain";
import { ErreurGeste, HeroAgent, LigneAvecGeste, RondAgentTelephone, useCartesAgents } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille } from "./Feuille";
import { Etiquette, GroupeListe, LigneListe, SectionListe } from "./Liste";
import { SectionsFiche } from "./FicheAgentTelephone";
import { NotePoste, VueLecture } from "./etats";
import { useSupport } from "./poste";

/**
 * La Bibliothèque KLYRA sur le téléphone (spec mobile T-08) : la liste et la lecture des fiches
 * viennent du compte (agents partagés) ou de l'app (modèles KLYRA) ; « Ajouter », « Réactiver » et
 * « Ajouter toute la collection » écrivent sur l'ordinateur ouvert (P-7 fermé).
 */

/** Ce qu'on ajoute : une définition partagée ou un modèle KLYRA. */
type Ajout = { type: "partage"; definitionId: string; nom: string; auteur: string; aConfigurer: string[] } | { type: "modele"; nom: string; modele: string };

type Plan = { retenus: { id: string; nom: string; tag: string }[]; ecartes: { id: string; nom: string; raison: string }[] };

/** Où en est une définition sur l'ordinateur ; poste fermé, d'après les cartes du compte. */
function useEtatsBibliotheque() {
  const { cartes } = useCartesAgents();
  const lecture = useLecturePoste<EtatsAgentsPoste>("agents.etats", {});
  const etats = lecture.etat === "ok" ? lecture.data.agents : undefined;
  const local = (source: { definitionId: string } | { modele: string }): EtatAgentPoste | { statut: "actif" | "desactive"; id: string } | null => {
    if (etats) return agentDeLaBibliotheque(etats, source);
    if (!("modele" in source)) return null;
    const carte = cartes?.find((c) => c.origine === source.modele);
    return carte ? { id: carte.origine, statut: carte.actif ? "actif" : "desactive" } : null;
  };
  return { local, relancer: lecture.relancer };
}

export function BibliothequeAgentsTelephone() {
  const sur = useSupport();
  const biblio = useBibliotheque();
  const { local, relancer } = useEtatsBibliotheque();
  const { agir, occupe, ouvert, bandeau, montrer, erreur } = useGesteTelephone();
  const [ajout, setAjout] = useState<Ajout | null>(null);
  const [collection, setCollection] = useState(false);
  const partages = useMemo(() => [...biblio.definitions].sort((a, b) => b.majLe - a.majLe), [biblio.definitions]);
  const modeles = useMemo(() => [...MODELES].sort((a, b) => a.role.name.localeCompare(b.role.name, "fr")), []);
  const aAjouter = modeles.filter((m) => !local({ modele: m.name })).length;

  const reactiver = (id: string, nom: string) => void agir("agents.activer", { id, actif: true }, `${nom} réactivé.`).then((ok) => ok && relancer());

  /** À droite d'une ligne : son état, ou le geste (désactivé poste fermé, P-7 dessous). */
  const etatLigne = (etat: ReturnType<typeof local>, nom: string, onAjouter: () => void, deMoi = false) => {
    if (deMoi) return <span className="text-ui-xs text-texte-secondaire">De toi</span>;
    if (etat?.statut === "actif") return <span className="text-ui-xs text-texte-secondaire">Ajouté</span>;
    const reactivable = etat?.statut === "desactive";
    return (
      <Bouton
        variant="blanc"
        disabled={!ouvert || occupe}
        aria-label={reactivable ? `Réactiver ${nom}` : `Ajouter ${nom} à tes agents`}
        onClick={reactivable ? () => reactiver(etat.id, nom) : onAjouter}
      >
        {reactivable ? "Réactiver" : "Ajouter"}
      </Bouton>
    );
  };

  const etatPartages = (() => {
    switch (biblio.etat) {
      case "chargement":
        return "Chargement des agents partagés…";
      case "hors-ligne":
        return "Hors ligne : la bibliothèque attend le réseau. Tes agents marchent.";
      case "retire":
        return "Ce compte ne fait plus partie de l’équipe.";
      case "erreur":
        return "Impossible de charger les agents partagés pour l’instant. Tes agents marchent normalement.";
      case "pret":
        return partages.length ? null : "Rien n’est encore partagé. Ouvre la fiche d’un de tes agents, puis « ⋯ » › Partager avec l’équipe.";
      default:
        return "Connecte-toi à ton compte d’équipe pour voir les agents que les membres partagent.";
    }
  })();

  return (
    <>
      <p className="mt-4 px-1 text-ui text-texte-secondaire">Les agents que les membres de ton équipe ont choisi de partager, et les modèles de KLYRA.</p>
      {ouvert ? null : (
        <div role="status" className="mt-3 flex items-start gap-2.5 rounded-xl bg-fond-surface-grise p-3 text-ui text-texte-principal">
          <Icon name="clock-01" size={20} className="mt-px shrink-0 text-icone-secondaire" />
          <p className="min-w-0">Tu peux lire les fiches. Les ajouter attend que KLYRA soit ouverte sur {sur}.</p>
        </div>
      )}

      <SectionListe titre="Partagés par l’équipe" compte={partages.length || undefined} className="mt-4">
        {etatPartages ? <p className="px-1 text-ui text-texte-secondaire">{etatPartages}</p> : null}
        {biblio.etat === "erreur" ? (
          <Bouton variant="blanc" taille="md" className="mt-2" onClick={biblio.reessayer}>
            Réessayer
          </Bouton>
        ) : null}
        {partages.length ? (
          <GroupeListe>
            {partages.map((d) => (
              <LigneDefinition
                key={d._id}
                href={`/equipe?definition=${encodeURIComponent(d._id)}`}
                slug={d.slug}
                nom={d.nom}
                teinte={teinteDefinition(d.slug, false)}
                tag={roleLisible(d.role, d.slug)}
                detail={`Par ${d.auteur.nom} · v${d.version} · ${dateCourte(d.majLe)}`}
                etat={etatLigne(local({ definitionId: d._id }), d.nom, () => setAjout({ type: "partage", definitionId: d._id, nom: d.nom, auteur: d.auteur.nom, aConfigurer: d.dependances.map((x) => x.libelle) }), d.deMoi)}
              />
            ))}
          </GroupeListe>
        ) : null}
      </SectionListe>

      <SectionListe titre="Modèles KLYRA" compte={modeles.length} className="mt-6">
        <p className="mb-2 px-1 text-ui text-texte-secondaire">Les agents de départ de KLYRA. Ajoute seulement ceux qui te servent.</p>
        {aAjouter >= 2 ? (
          <Bouton variant="blanc" taille="md" className="mb-3 w-full" iconeGauche={<Icon name="plus-01" size={20} />} disabled={!ouvert} onClick={() => setCollection(true)}>
            Ajouter toute la collection
          </Bouton>
        ) : null}
        <GroupeListe>
          {modeles.map((m) => (
            <LigneDefinition
              key={m.name}
              href={`/equipe?definition=${encodeURIComponent(`klyra:${m.name}`)}`}
              slug={m.name}
              nom={m.role.name}
              teinte={m.role.teinte}
              tag={m.role.tag}
              detail={m.role.title}
              etat={etatLigne(local({ modele: m.name }), m.role.name, () => setAjout({ type: "modele", nom: m.role.name, modele: m.name }))}
            />
          ))}
        </GroupeListe>
      </SectionListe>
      <ErreurGeste message={erreur?.message} className="mt-3" />

      {ajout ? (
        <FeuilleAjout
          ajout={ajout}
          sur={sur}
          onFermer={() => setAjout(null)}
          onAjouter={() =>
            void agir<{ nom: string; aConfigurer: string[] }>(
              "agents.ajouterDefinition",
              ajout.type === "modele" ? { type: "modele", nom: ajout.modele } : { type: "partage", definitionId: ajout.definitionId },
              (r) => (r.aConfigurer.length ? `${r.nom} ajouté. À configurer sur ${sur}.` : `${r.nom} ajouté à tes agents.`),
            ).then((ok) => ok && relancer())
          }
        />
      ) : null}
      {collection ? (
        <FeuilleCollection
          onFermer={() => setCollection(false)}
          onFait={(texte) => {
            montrer(texte);
            relancer();
          }}
        />
      ) : null}
      {bandeau}
    </>
  );
}

function LigneDefinition({ href, slug, nom, teinte, tag, detail, etat }: { href: string; slug: string; nom: string; teinte: RoleTeinte; tag: string; detail: string; etat: ReactNode }) {
  return <LigneAvecGeste href={href} debut={<RondAgentTelephone agentId={slug} nom={nom} teinte={teinte} taille={40} />} nom={nom} etiquette={tag ? <Etiquette>{tag}</Etiquette> : null} ligne2={detail} geste={etat} />;
}

/** « Ajouter … à tes agents ? » : la même phrase qu'au bureau, les dossiers à choisir restent sur l'ordinateur. */
function FeuilleAjout({ ajout, sur, onFermer, onAjouter }: { ajout: Ajout; sur: string; onFermer: () => void; onAjouter: () => void }) {
  const note =
    ajout.type === "partage"
      ? `Tu recevras les nouvelles versions de ${ajout.auteur} sous forme de proposition. Tes conversations avec lui restent sur ${sur}.${
          ajout.aConfigurer.length ? ` À configurer ensuite sur ${sur} : ${ajout.aConfigurer.join(", ")}. D’ici là, il arrive « À configurer ».` : ""
        }`
      : `Les nouvelles versions du modèle arriveront avec l’app, sous forme de proposition. Tes conversations avec lui restent sur ${sur}.`;
  return <ConfirmationFeuille titre={`Ajouter ${ajout.nom} à tes agents ?`} texte={note} confirmer="Ajouter" onConfirmer={onAjouter} onFermer={onFermer} />;
}

/** « Ajouter toute la collection ? » : ce qui sera ajouté, ce qui ne le sera pas et pourquoi, calculé sur l'ordinateur. */
function FeuilleCollection({ onFermer, onFait }: { onFermer: () => void; onFait: (texte: string) => void }) {
  const plan = useLecturePoste<Plan>("agents.planCollection", {});
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  const [message, setMessage] = useState<string | null>(null);
  const n = plan.etat === "ok" ? plan.data.retenus.length : 0;
  const ajouter = async () => {
    const r = await agir<{ faits: number; message: string | null }>("agents.ajouterCollection", {});
    if (!r) return;
    if (r.message) {
      setMessage(r.message);
      return;
    }
    onFermer();
    onFait(`${r.faits} modèles ajoutés à tes agents.`);
  };
  return (
    <Feuille
      titre="Ajouter toute la collection ?"
      sousTitre="Modèles KLYRA"
      onFermer={onFermer}
      pied={
        message ? (
          <Bouton variant="sombre" taille="md" className="w-full" onClick={onFermer}>
            Fermer
          </Bouton>
        ) : (
          <>
            <Bouton variant="sombre" taille="md" className="w-full" disabled={!ouvert || occupe || !n} onClick={() => void ajouter()}>
              {occupe ? "Ajout…" : `Ajouter les ${n}`}
            </Bouton>
            {ouvert ? null : <NotePoste />}
          </>
        )
      }
    >
      <div className="-mx-4">
        <VueLecture lecture={plan} ferme={(sur) => `tes agents sont sur ${sur}. La collection s’ajoute quand KLYRA y est ouverte.`}>
          {(p) => (
            <div className="flex flex-col gap-4 px-4">
              <SectionListe titre="Seront ajoutés" compte={p.retenus.length}>
                <GroupeListe>
                  {p.retenus.map((r) => {
                    const m = MODELES.find((x) => x.name === r.id);
                    return <LigneListe key={r.id} debut={<RondAgentTelephone agentId={r.id} nom={r.nom} teinte={m?.role.teinte ?? teinteDefinition(r.id, false)} taille={32} />} retrait="tuile" nom={r.nom} etiquette={r.tag ? <Etiquette>{r.tag}</Etiquette> : null} />;
                  })}
                </GroupeListe>
              </SectionListe>
              {p.ecartes.length ? (
                <SectionListe titre="Ne seront pas ajoutés" compte={p.ecartes.length}>
                  <GroupeListe>
                    {p.ecartes.map((r) => (
                      <LigneListe key={r.id} nom={r.nom} ligne2={r.raison} />
                    ))}
                  </GroupeListe>
                </SectionListe>
              ) : null}
              <ErreurGeste message={message ?? erreur?.message} />
            </div>
          )}
        </VueLecture>
      </div>
    </Feuille>
  );
}

/** La fiche d'une définition de la bibliothèque (`?definition=<id>`, `klyra:<nom>` pour un modèle), lue sur le compte. */
export function DefinitionAgentTelephone({ id }: { id: string }) {
  const sur = useSupport();
  const biblio = useBibliotheque();
  const { local, relancer } = useEtatsBibliotheque();
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const [ajout, setAjout] = useState(false);
  const modele = id.startsWith("klyra:") ? (MODELES.find((m) => m.name === id.slice("klyra:".length)) ?? null) : null;
  const [partagee, setPartagee] = useState<{ pour: string; definition: DefinitionComplete | null; erreur: string | null } | null>(null);
  const lire = biblio.lire;

  useEffect(() => {
    if (modele || biblio.etat !== "pret") return;
    let actif = true;
    lire(id)
      .then((definition) => actif && setPartagee({ pour: id, definition, erreur: null }))
      .catch((e: unknown) => actif && setPartagee({ pour: id, definition: null, erreur: e instanceof Error ? e.message : String(e) }));
    return () => {
      actif = false;
    };
  }, [id, modele, lire, biblio.etat]);

  const lue = partagee?.pour === id ? partagee : null;
  const contenu = modele?.content ?? lue?.definition?.contenu ?? null;
  const slug = modele?.name ?? lue?.definition?.slug ?? id;
  const role = contenu ? roleFromContent(slug, contenu, {}, null) : null;
  const nom = modele?.role.name ?? lue?.definition?.nom ?? "Bibliothèque KLYRA";
  const teinte = modele ? modele.role.teinte : teinteDefinition(slug, false);
  const etat = local(modele ? { modele: modele.name } : { definitionId: id });
  const auteur = modele ? "KLYRA" : lue?.definition ? `Par ${lue.definition.auteur.nom} · v${lue.definition.version}` : "";
  const deMoi = lue?.definition?.deMoi ?? false;

  const ajouter = () =>
    void agir<{ nom: string }>("agents.ajouterDefinition", modele ? { type: "modele", nom: modele.name } : { type: "partage", definitionId: id }, (r) => `${r.nom} ajouté à tes agents.`).then(
      (ok) => ok && relancer(),
    );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={nom} parent="/equipe?vue=bibliotheque" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {!role ? (
          <p className="pt-6 text-ui text-texte-secondaire">
            {lue?.erreur
              ? `Impossible de lire cette définition : ${lue.erreur}`
              : lue && !lue.definition
                ? "Cette définition n’est plus dans la bibliothèque."
                : biblio.etat === "pret" || biblio.etat === "chargement"
                  ? "Chargement de la définition…"
                  : "Connecte-toi à ton compte d’équipe pour voir les agents que les membres partagent."}
          </p>
        ) : (
          <>
            <div className="pt-1">
              <HeroAgent
                agentId={slug}
                nom={nom}
                teinte={teinte}
                role={role.tag}
                titre={role.title}
                etiquettes={
                  <>
                    <Etiquette>{modele ? "Modèle KLYRA" : auteur}</Etiquette>
                    {lue?.definition?.dependances.length ? (
                      <Etiquette>
                        {lue.definition.dependances.length} dossier{lue.definition.dependances.length > 1 ? "s" : ""} à choisir
                      </Etiquette>
                    ) : null}
                  </>
                }
                pied={lue?.definition ? `Partagé le ${dateCourte(lue.definition.majLe)}` : null}
                actions={
                  deMoi ? (
                    <p className="text-ui text-texte-secondaire">Tu l’as partagé avec l’équipe.</p>
                  ) : etat?.statut === "actif" ? (
                    <p className="text-ui text-texte-secondaire">Dans tes agents.</p>
                  ) : (
                    <BoutonPrincipal
                      className="flex-1"
                      disabled={!ouvert || occupe}
                      onClick={() => (etat?.statut === "desactive" ? void agir("agents.activer", { id: etat.id, actif: true }, `${nom} réactivé.`).then((ok) => ok && relancer()) : setAjout(true))}
                    >
                      {etat?.statut === "desactive" ? "Réactiver" : "Ajouter à mes agents"}
                    </BoutonPrincipal>
                  )
                }
              />
              {ouvert ? null : <NotePoste className="mt-2 px-1" />}
              <ErreurGeste message={erreur?.message} className="mt-2" />
            </div>
            <div className="mt-4">
              <SectionsFiche role={role} />
            </div>
          </>
        )}
      </div>
      {ajout ? (
        <FeuilleAjout
          ajout={
            modele
              ? { type: "modele", nom, modele: modele.name }
              : { type: "partage", definitionId: id, nom, auteur: lue?.definition?.auteur.nom ?? "", aConfigurer: (lue?.definition?.dependances ?? []).map((d) => d.libelle) }
          }
          sur={sur}
          onFermer={() => setAjout(false)}
          onAjouter={ajouter}
        />
      ) : null}
      {bandeau}
    </div>
  );
}
