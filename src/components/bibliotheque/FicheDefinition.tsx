"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { preparerPublication, type Dependance } from "../../../convex/model/definitions";
import { Icon } from "@/components/icons/Icon";
import { LigneRole } from "@/components/team/AgentCard";
import { Bloc } from "@/components/team/AgentDetail";
import { AgentVisuel, couleurAgent } from "@/components/team/AgentVisuel";
import { QuandAppeler, SectionFiche } from "@/components/team/FicheSections";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { MODELES, roleFromContent, useAgents } from "@/lib/agents";
import { useBibliotheque, type DefinitionComplete } from "@/lib/bibliotheque";
import {
  abreger,
  avecLibelles,
  clesDe,
  colleguesCites,
  dateCourte,
  libelleDe,
  nomModele,
  outilsDemandes,
  raison,
  teinteDefinition,
} from "@/lib/bibliotheque-ui";
import { poste } from "@/lib/plateforme";
import type { Role } from "@/types/domain";
import {
  agentDeDefinition,
  agentPublie,
  etatCollegue,
  Meta,
  ParlerEnEquipe,
  rangSection,
  texteCollegue,
  useSession,
} from "./commun";
import { useAjout, type DemandeAjout } from "./ModaleAjouter";
import { ModalePartager } from "./ModalePartager";
import { ouvrirRetrait } from "./useRetirerDeBibliotheque";

const RETOUR = "/equipe?vue=bibliotheque";

function Centre({ children }: { children: ReactNode }) {
  const router = useRouter();
  return (
    <div className="flex h-full items-center justify-center p-12">
      <div role="status" className="flex max-w-[520px] flex-col items-center gap-4 text-center">
        <p className="m-0 text-ui text-texte-secondaire">{children}</p>
        <Bouton variant="blanc" taille="compact" onClick={() => router.push(RETOUR)}>
          Retour à la bibliothèque
        </Bouton>
      </div>
    </div>
  );
}

/** Ce que la fiche montre d'une définition, d'où qu'elle vienne. */
interface Vue {
  slug: string;
  role: Role;
  /** Le texte partagé, `{{chemin:…}}` compris. */
  contenu: string;
  dependances: Dependance[];
  origine: string;
  demande: DemandeAjout;
  partagee: DefinitionComplete | null;
}

/**
 * La fiche d'une définition de la bibliothèque, `?definition=<id>` (spec §10.2) : un id Convex pour un
 * agent partagé, `klyra:<nom>` pour un modèle KLYRA. En lecture seule : pas encore un agent de la personne.
 */
export function FicheDefinition({ id }: { id: string }) {
  const nomDuModele = id.startsWith("klyra:") ? id.slice("klyra:".length) : null;
  const modele = nomDuModele ? MODELES.find((m) => m.name === nomDuModele) : undefined;
  const biblio = useBibliotheque();

  const [definition, setDefinition] = useState<DefinitionComplete | null | undefined>(undefined);
  const [erreur, setErreur] = useState<string | null>(null);
  const [tour, setTour] = useState(0);
  const pret = biblio.etat === "pret";
  const lire = biblio.lire;
  /* Relue quand une nouvelle version paraît (liste ou état suivi par le serveur). */
  const version = biblio.definitions.find((d) => d._id === id)?.version ?? biblio.etats.get(id)?.version ?? 0;
  useEffect(() => {
    if (nomDuModele !== null || !pret) return;
    let actif = true;
    lire(id)
      .then((d) => {
        if (!actif) return;
        setDefinition(d);
        setErreur(null);
      })
      .catch((e: unknown) => actif && setErreur(raison(e)));
    return () => {
      actif = false;
    };
  }, [nomDuModele, pret, lire, id, version, tour]);

  const vue = useMemo<Vue | null>(() => {
    if (modele) {
      return { slug: modele.name, role: modele.role, contenu: modele.content, dependances: [], origine: "Modèle KLYRA", demande: { type: "modele", nom: modele.name }, partagee: null };
    }
    if (!definition) return null;
    const lu = roleFromContent(definition.slug, avecLibelles(definition.contenu, definition.dependances), {}, null);
    const teinte = teinteDefinition(definition.slug, false);
    return {
      slug: definition.slug,
      role: { ...lu, name: definition.nom, initial: definition.nom.charAt(0).toUpperCase(), tag: definition.role, teinte },
      contenu: definition.contenu,
      dependances: definition.dependances,
      origine: `Par ${definition.auteur.nom} · version ${definition.version} · publiée le ${dateCourte(definition.majLe)}`,
      demande: { type: "partage", resume: definition },
      partagee: definition,
    };
  }, [modele, definition]);

  if (nomDuModele !== null && !modele) return <Centre>Ce modèle KLYRA n’existe pas dans cette version de l’app.</Centre>;
  if (!vue) {
    if (definition === null) return <Centre>Cette définition n’est plus dans la bibliothèque.</Centre>;
    if (erreur) {
      return (
        <div className="flex h-full items-center justify-center p-12">
          <div role="alert" className="flex max-w-[520px] flex-col items-center gap-4 text-center">
            <p className="m-0 text-ui text-texte-secondaire">Impossible de lire cette définition pour l’instant : {erreur}.</p>
            <Bouton variant="blanc" taille="compact" onClick={() => setTour((t) => t + 1)}>
              Réessayer
            </Bouton>
          </div>
        </div>
      );
    }
    switch (biblio.etat) {
      case "indisponible":
        return <Centre>Les agents partagés par l’équipe s’affichent dans l’app de bureau, connectée à ton compte d’équipe.</Centre>;
      case "deconnecte":
        return <Centre>Connecte-toi à ton compte d’équipe pour voir les agents que les membres partagent.</Centre>;
      case "retire":
        return <Centre>Ce compte ne fait plus partie de l’équipe.</Centre>;
      case "hors-ligne":
        return <Centre>Tes agents marchent. La bibliothèque attend le réseau.</Centre>;
      case "erreur":
        return <Centre>Impossible de charger les agents partagés pour l’instant. Tes agents marchent normalement.</Centre>;
      default:
        return <Centre>Chargement de la définition…</Centre>;
    }
  }
  return <Fiche key={`${id}-${vue.partagee?.version ?? 0}`} id={id} vue={vue} />;
}

function Fiche({ id, vue }: { id: string; vue: Vue }) {
  const router = useRouter();
  const { tous, canEdit, dir, changerOrigine } = useAgents();
  const biblio = useBibliotheque();
  const session = useSession();
  const { ajouter, reactiver, enCours, fenetre } = useAjout();
  const [miseAJour, setMiseAJour] = useState(false);
  const { role, slug, contenu, partagee } = vue;

  /* L'agent de cet ordinateur qui en vient (ou qui l'a publiée, sous la session en cours). */
  const auteurLocal = partagee ? agentPublie(tous, id, session.moiId) : null;
  const local = partagee ? (agentDeDefinition(tous, id) ?? auteurLocal) : (tous.find((a) => a.role.id === slug) ?? null);
  const dansMesAgents = !!local && local.statut !== "disponible";
  const retiree = !!biblio.etats.get(id)?.retiree;
  const deMoi = !!partagee?.deMoi && !retiree;
  const consigneChangee =
    !!auteurLocal?.role.file &&
    !!partagee &&
    (preparerPublication(auteurLocal.role.file.content).contenu !== partagee.contenu || auteurLocal.role.tag !== partagee.role);

  const collegues = colleguesCites(contenu, slug).map((c) => ({ c, etat: etatCollegue(c, tous, biblio.definitions) }));
  const cles = clesDe(contenu);
  const outils = outilsDemandes(contenu);
  const valeurs = local?.entree?.origine.type === "bibliotheque" ? local.entree.origine.valeurs : {};
  const sections = [...role.sections].sort((a, b) => rangSection(a) - rangSection(b));

  const retirer = async () => {
    const fait = await ouvrirRetrait({
      nom: role.name,
      retirer: async () => {
        await biblio.retirer(id);
        if (auteurLocal) await changerOrigine(auteurLocal.role.id, { type: "local" }).catch(() => undefined);
      },
    });
    if (fait) router.push(RETOUR);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="grid grid-cols-[200px_minmax(0,1fr)] items-stretch gap-6 @3xl:grid-cols-[260px_minmax(0,1fr)]">
          <div className="min-h-[180px] overflow-hidden rounded-xl border border-white/60 shadow-ombre-xs">
            <AgentVisuel agentId={slug} teinte={role.teinte} />
          </div>
          <div className="flex min-w-0 flex-col gap-4">
            {role.skills.length > 0 && <p className="m-0 text-ui-s text-texte-tertiaire">{role.skills.join(" · ")}</p>}
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
              <span className="block font-semibold">{role.name}</span>
              <span className="mt-1 flex items-center gap-2 text-h4 leading-[1.1] font-normal tracking-[-0.03em]">
                <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: couleurAgent(role.teinte) }} />
                <span>
                  <LigneRole tag={role.tag} title={role.title} />
                </span>
              </span>
            </h1>
            <div className="flex flex-wrap items-center gap-2">
              <Meta>{vue.origine}</Meta>
              {retiree && <Meta>Retirée de la bibliothèque</Meta>}
              {role.model && <Meta>Modèle {nomModele(role.model)}</Meta>}
              {outils.length > 0 && <Meta>Outils : {outils.join(", ")}</Meta>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              {dansMesAgents && local ? (
                <BoutonPrincipal href={`/equipe?agent=${encodeURIComponent(local.role.id)}`}>Ouvrir sa fiche</BoutonPrincipal>
              ) : (
                <BoutonPrincipal disabled={!canEdit || enCours !== null} onClick={() => void ajouter(vue.demande)}>
                  Ajouter à mes agents
                </BoutonPrincipal>
              )}
              {local?.statut === "desactive" && (
                <Bouton variant="blanc" taille="md" onClick={() => void reactiver(local)}>
                  Réactiver
                </Bouton>
              )}
              {!canEdit && <span className="text-ui-xs text-texte-tertiaire">Dans l’app de bureau</span>}
              {deMoi && auteurLocal && consigneChangee && (
                <Bouton variant="blanc" taille="md" onClick={() => setMiseAJour(true)}>
                  Publier une mise à jour
                </Bouton>
              )}
              {deMoi && (
                <Bouton variant="discret" taille="md" onClick={() => void retirer()}>
                  Retirer de la bibliothèque
                </Bouton>
              )}
              <Bouton variant="discret" taille="md" iconeGauche={<Icon name="chevron-left" size={20} />} onClick={() => router.push(RETOUR)}>
                Retour à la bibliothèque
              </Bouton>
            </div>
          </div>
        </header>

        <div className="grid grid-flow-row-dense grid-cols-1 gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3 @4xl:grid-cols-2">
          <QuandAppeler role={role} />
          {sections
            .filter((s) => rangSection(s) < 3)
            .map((s) => (
              <SectionFiche key={s.title} section={s} teinte={role.teinte} />
            ))}
        </div>

        <Bloc titre="Ce qu’il lui faut">
          {cles.length === 0 && collegues.length === 0 && outils.length === 0 ? (
            <p className="m-0 text-ui-s text-texte-secondaire">Rien à préparer : ni dossier à choisir, ni collègue cité, ni outil demandé.</p>
          ) : (
            <div className="flex flex-col gap-4">
              {cles.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h4 className="m-0 text-ui-s font-medium text-texte-principal">Dossiers à choisir sur {poste.ce}</h4>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-s text-texte-secondaire">
                    {cles.map((cle) => {
                      const valeur = dansMesAgents && !local?.manquantes.includes(cle) ? valeurs[cle] : undefined;
                      return (
                        <li key={cle}>
                          <span className="font-medium text-texte-principal">{libelleDe(cle, vue.dependances)}</span> ·{" "}
                          {valeur ? (
                            <span className="klyra-mono" title={valeur}>
                              {abreger(valeur, dir)}
                            </span>
                          ) : dansMesAgents ? (
                            "à configurer dans sa fiche"
                          ) : (
                            "à choisir quand tu l’ajoutes, ou plus tard"
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}
              {collegues.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h4 className="m-0 text-ui-s font-medium text-texte-principal">Il passe la main à</h4>
                  <ul className="m-0 flex list-none flex-col gap-1 p-0 text-ui-s text-texte-secondaire">
                    {collegues.map(({ c, etat }) => (
                      <li key={c.id}>{texteCollegue(c, etat)}</li>
                    ))}
                  </ul>
                </section>
              )}
              {outils.length > 0 && (
                <section className="flex flex-col gap-1.5">
                  <h4 className="m-0 text-ui-s font-medium text-texte-principal">Outils demandés</h4>
                  <p className="klyra-mono m-0 text-ui-xs text-texte-secondaire">{outils.join(", ")}</p>
                </section>
              )}
            </div>
          )}
        </Bloc>

        {sections
          .filter((s) => rangSection(s) === 3)
          .map((s) => (
            <ParlerEnEquipe key={s.title} section={s} />
          ))}
      </div>
      {fenetre}
      {auteurLocal && <ModalePartager agent={auteurLocal} mode="mettre-a-jour" ouvert={miseAJour} onFermer={() => setMiseAJour(false)} />}
    </div>
  );
}
