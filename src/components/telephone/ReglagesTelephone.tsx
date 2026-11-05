"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { estSection, type IdSection } from "@/components/reglages/catalogue";
import { ancreReglage } from "@/components/reglages/ui";
import { Bouton } from "@/components/ui/Bouton";
import { useServeursRelies } from "@/lib/lieux";
import { majuscule } from "@/lib/poste-texte";
import { groupesReglages, resultatsTelephone, sectionAuPoste, titreSection, type LigneCatalogue } from "@/lib/telephone/reglages";
import paquet from "../../../package.json";
import { CeTelephone } from "./CeTelephone";
import { ChampRecherche } from "./Controles";
import { EnteteTelephone } from "./EnteteTelephone";
import { EtatEcran } from "./etats";
import { Etiquette, GroupeListe, LigneListe, SectionListe, SousSection, TuileIcone, ValeurLigne } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { EquipeTelephone, ProfilTelephone } from "./ReglagesCompteTelephone";
import { LignesSurPoste, Pile } from "./ReglagesCommun";
import { AgentsReglagesTelephone, ClaudeTelephone, ComputerUseTelephone, MisesAJourTelephone, NotificationsPosteTelephone } from "./ReglagesPosteTelephone";

/**
 * Réglages sur le téléphone (lot 8, T-22) : `/reglages` liste les sections par source (ce téléphone et
 * le compte, ce qui se lit sur l'ordinateur, ce qui y reste), avec la recherche du catalogue du bureau ;
 * `/reglages?section=…` ouvre une section, `&reglage=…` mène à une ligne et l'éclaire.
 */

export function ReglagesTelephone() {
  const params = useSearchParams();
  const section = params.get("section");
  const serveur = params.get("serveur");
  if (estSection(section)) return <PageSection key={section} id={section} reglage={params.get("reglage")} />;
  if (serveur) return <ReglagesServeur nom={serveur} />;
  return <ListeReglages />;
}

/* ─── La liste ─────────────────────────────────────────────────── */

function Lignes({ lignes, sur }: { lignes: LigneCatalogue[]; sur: string }) {
  return (
    <GroupeListe>
      {lignes.map((l) => (
        <LigneListe key={l.id} href={`/reglages?section=${l.id}`} debut={<TuileIcone icone={l.icone} />} retrait="tuile" nom={l.titre} ligne2={l.detail(sur)} uneLigne fin="chevron" />
      ))}
    </GroupeListe>
  );
}

/** La liste des sections, et la recherche des réglages en haut (E8-15 à E8-18). */
function ListeReglages() {
  const [requete, setRequete] = useState("");
  const sur = useSupport();
  const { postes } = usePostes();
  const serveurs = useServeursRelies();
  const resultats = useMemo(() => resultatsTelephone(requete, sur), [requete, sur]);
  const groupes = useMemo(() => groupesReglages(), []);
  const cherche = requete.trim().length > 0;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Réglages" parent="/plus" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <Pile>
          <ChampRecherche valeur={requete} onChange={setRequete} libelle="Rechercher dans les réglages" placeholder="Rechercher dans les réglages" />
          {cherche ? (
            resultats.length ? (
              <SectionListe titre="Résultats" compte={resultats.length}>
                <GroupeListe>
                  {resultats.map((r) => (
                    <LigneListe key={r.cle} href={r.href} debut={<TuileIcone icone={r.icone} />} retrait="tuile" nom={r.titre} etiquette={r.surPoste ? <Etiquette>{`Sur ${sur}`}</Etiquette> : null} ligne2={r.ligne2} uneLigne fin="chevron" />
                  ))}
                </GroupeListe>
              </SectionListe>
            ) : (
              <EtatEcran
                forme="encadre"
                className="px-0"
                icone="search-01"
                titre={`Aucun réglage pour « ${requete.trim()} »`}
                texte="Essaie un autre mot, ou parcours la liste des réglages."
                action={
                  <Bouton variant="blanc" taille="md" onClick={() => setRequete("")}>
                    Effacer la recherche
                  </Bouton>
                }
              />
            )
          ) : (
            <>
              <SectionListe titre="Ce téléphone et ton compte">
                <Lignes lignes={groupes.compte} sur={sur} />
              </SectionListe>
              {postes?.length === 0 ? (
                <SectionListe titre="Ton ordinateur">
                  <EtatEcran
                    forme="encadre"
                    className="px-0 pb-0"
                    icone="computer"
                    bleue
                    titre="Aucun ordinateur relié"
                    texte="Claude, les agents, leurs notifications et les mises à jour se règlent ici une fois ton ordinateur relié : ouvre KLYRA dessus, puis Réglages › Équipe."
                  />
                </SectionListe>
              ) : (
                <>
                  <SectionListe titre={majuscule(sur)}>
                    <SousSection>Se lisent et se changent quand KLYRA y est ouverte.</SousSection>
                    <Lignes lignes={groupes.poste} sur={sur} />
                  </SectionListe>
                  <SectionListe titre={`Restent sur ${sur}`}>
                    <GroupeListe>
                      {groupes.restent.map((l) => (
                        <LigneListe key={l.id} href={`/reglages?section=${l.id}`} debut={<TuileIcone icone={l.icone} />} retrait="tuile" nom={l.titre} ligne2={l.detail(sur)} uneLigne fin="chevron" />
                      ))}
                      {serveurs.map((s) => (
                        <LigneListe key={s.id} href={`/reglages?serveur=${encodeURIComponent(s.nom)}`} debut={<TuileIcone icone="globe-01" />} retrait="tuile" nom={`Réglages de ${s.nom}`} ligne2="Ses fournisseurs et leurs clés" uneLigne fin="chevron" />
                      ))}
                    </GroupeListe>
                  </SectionListe>
                </>
              )}
            </>
          )}
        </Pile>
      </div>
    </div>
  );
}

/* ─── Une section ──────────────────────────────────────────────── */

function PageSection({ id, reglage }: { id: IdSection; reglage: string | null }) {
  /* Une ligne cherchée défile à l'écran et s'éclaire 1 800 ms (`data-eclaire`, comme au bureau). */
  useEffect(() => {
    if (!reglage) return;
    const minuteur = setTimeout(() => {
      const ligne = document.getElementById(ancreReglage(reglage));
      if (!ligne) return;
      ligne.scrollIntoView({ block: "start" });
      ligne.setAttribute("data-eclaire", "");
      setTimeout(() => ligne.removeAttribute("data-eclaire"), 1800);
    }, 300);
    return () => clearTimeout(minuteur);
  }, [reglage]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titreSection(id)} parent="/reglages" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">{contenu(id)}</div>
    </div>
  );
}

function contenu(id: IdSection): ReactNode {
  switch (id) {
    case "mobile":
      return <CeTelephone />;
    case "general":
      return <General />;
    case "profil":
      return <ProfilTelephone />;
    case "equipe":
      return <EquipeTelephone />;
    case "claude":
      return <ClaudeTelephone />;
    case "agents":
      return <AgentsReglagesTelephone />;
    case "notifications":
      return <NotificationsPosteTelephone />;
    case "computer-use":
      return <ComputerUseTelephone />;
    case "mises-a-jour":
      return <MisesAJourTelephone />;
    default:
      return <SectionAuPoste id={id} />;
  }
}

/** Une section qui reste sur l'ordinateur (E8-42) : l'état du socle (S-29), puis chaque réglage avec sa raison. */
function SectionAuPoste({ id }: { id: IdSection }) {
  const sur = useSupport();
  const etat = sectionAuPoste(id, sur);
  return (
    <>
      {etat ? <EtatEcran className="pt-7 pb-4" icone={SECTION_ICONES[id]} titre={etat.titre} texte={etat.raison} /> : null}
      <Pile className="pt-0">
        <LignesSurPoste section={id} />
      </Pile>
    </>
  );
}

const SECTION_ICONES: Partial<Record<IdSection, "microphone-01" | "layers-01" | "computer" | "boutique-01" | "lock-01">> = {
  voix: "microphone-01",
  "autres-ia": "layers-01",
  navigateur: "computer",
  marketplace: "boutique-01",
  coffre: "lock-01",
};

/** Général : la vraie version de l'app web, le reste règle l'ordinateur. */
function General() {
  return (
    <Pile>
      <GroupeListe>
        <LigneListe id={ancreReglage("version")} nom="Version de l’app web" fin={<ValeurLigne>{paquet.version}</ValeurLigne>} />
      </GroupeListe>
      <LignesSurPoste section="general" />
    </Pile>
  );
}

/** Les réglages d'un serveur relié (E8-15, « Restent sur ton Mac ») : ses fournisseurs et ses clés se règlent sur l'ordinateur. */
function ReglagesServeur({ nom: demande }: { nom: string }) {
  const sur = useSupport();
  const serveur = useServeursRelies().find((s) => s.nom === demande);
  const nom = serveur?.nom ?? "ce serveur";
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={serveur ? `Réglages de ${serveur.nom}` : "Réglages du serveur"} parent="/reglages" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EtatEcran icone="globe-01" titre={`Les réglages de ${nom} se font sur ${sur}`} texte="Ses fournisseurs et leurs clés ne passent pas par ce téléphone." />
      </div>
    </div>
  );
}
