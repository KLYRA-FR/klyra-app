"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useLieuActif } from "@/lib/lieux";
import { useLecturePoste } from "@/lib/poste/client";
import type { PassageLu, ResultatsMemoire, SouvenirLu, SouvenirOuvert, SouvenirsRecents } from "@/lib/telephone/gestes-memoire";
import { ChampRecherche } from "./Controles";
import { EnteteTelephone } from "./EnteteTelephone";
import { Feuille } from "./Feuille";
import { Etiquette, GroupeListe, LigneListe, NoteListe, SectionListe, TuileIcone } from "./Liste";
import { BandeauEtat, DemandeEnCours, EtatEcran, VueLecture } from "./etats";

/**
 * La mémoire sur le téléphone : chercher dans le second cerveau (notes, DIGITAL-OS, PDF, décisions) et dans les
 * souvenirs des agents, lire un passage ou un souvenir avec ses liens. Lecture seule, lue par l'ordinateur ouvert
 * dans l'espace choisi (gestes `memoire.*`, src/lib/telephone/gestes-memoire.ts) ; écrire, oublier, entretenir et
 * synchroniser restent sur l'ordinateur.
 */

const TYPES: Record<string, string> = { user: "Préférence", feedback: "Retour", project: "Projet", reference: "Référence" };
type Ouvert = { genre: "passage"; id: string; titre: string } | { genre: "souvenir"; id: string; titre: string };

function date(iso: string | null): string | undefined {
  return iso ? new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short" }) : undefined;
}

export function MemoireTelephone() {
  const lieu = useLieuActif();
  const [saisie, setSaisie] = useState("");
  const [requete, setRequete] = useState("");
  const [ouvert, setOuvert] = useState<Ouvert | null>(null);
  useEffect(() => {
    const t = setTimeout(() => setRequete(saisie.trim().length >= 2 ? saisie.trim() : ""), 400);
    return () => clearTimeout(t);
  }, [saisie]);
  const recents = useLecturePoste<SouvenirsRecents>("memoire.souvenirs", requete ? null : { lieu });
  const resultats = useLecturePoste<ResultatsMemoire>("memoire.chercher", requete ? { lieu, requete } : null, { garder: false, delai: 30_000 });
  const lecture = requete ? resultats : recents;
  const ouvrirSouvenir = (s: SouvenirLu) => setOuvert({ genre: "souvenir", id: s.id, titre: s.nom });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Mémoire" parent="/plus" />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <div className="px-4 pt-2 pb-4">
          <ChampRecherche valeur={saisie} onChange={setSaisie} placeholder="Un client, une décision, un document…" libelle="Chercher dans la mémoire" />
        </div>
        {lecture.etat === "attente" ? (
          <DemandeEnCours lent={lecture.lent} lignes={5} />
        ) : requete ? (
          <VueLecture lecture={resultats} lignes={5} gestes={null} ferme={(sur) => `la mémoire se lit sur ${sur}. Elle s’affiche ici quand KLYRA y est ouverte.`}>
            {(r) => <Resultats r={r} ouvrirPassage={(id, titre) => setOuvert({ genre: "passage", id, titre })} ouvrirSouvenir={ouvrirSouvenir} />}
          </VueLecture>
        ) : (
          <VueLecture lecture={recents} lignes={5} gestes={null} ferme={(sur) => `la mémoire se lit sur ${sur}. Elle s’affiche ici quand KLYRA y est ouverte.`}>
            {(r) => <Recents r={r} ouvrirSouvenir={ouvrirSouvenir} />}
          </VueLecture>
        )}
      </div>
      {ouvert ? <FeuilleLecture lieu={lieu} ouvert={ouvert} ouvrirSouvenir={ouvrirSouvenir} onFermer={() => setOuvert(null)} /> : null}
    </div>
  );
}

function LigneSouvenir({ s, ligne2, onClick }: { s: SouvenirLu; ligne2?: string; onClick: () => void }) {
  return (
    <LigneListe
      onClick={onClick}
      debut={<TuileIcone icone="git-branch-01" />}
      retrait="tuile"
      nom={s.nom}
      etiquette={s.type && TYPES[s.type] ? <Etiquette>{TYPES[s.type]}</Etiquette> : undefined}
      meta={date(s.date)}
      ligne2={ligne2 ?? [s.nomAgent ?? s.agent, s.resume].filter(Boolean).join(" · ")}
      fin="chevron"
    />
  );
}

function Recents({ r, ouvrirSouvenir }: { r: SouvenirsRecents; ouvrirSouvenir: (s: SouvenirLu) => void }) {
  if (!r.souvenirs.length) return <EtatEcran forme="encadre" icone="git-branch-01" titre="Aucun souvenir" texte="Les agents n’ont encore rien noté dans leur mémoire. Cherche quand même : notes, documents et décisions sont aussi dans la mémoire." />;
  return (
    <SectionListe titre="Souvenirs récents des agents" compte={r.total}>
      <GroupeListe>{r.souvenirs.map((s) => <LigneSouvenir key={s.id} s={s} onClick={() => ouvrirSouvenir(s)} />)}</GroupeListe>
      {r.tronque ? <NoteListe>Les plus récents seulement : cherche pour trouver les autres.</NoteListe> : null}
    </SectionListe>
  );
}

function Resultats({ r, ouvrirPassage, ouvrirSouvenir }: { r: ResultatsMemoire; ouvrirPassage: (id: string, titre: string) => void; ouvrirSouvenir: (s: SouvenirLu) => void }) {
  const manques = r.manques.length ? (
    <div className="px-4 pb-3">
      <BandeauEtat ton="info" icone={<Icon name="help-circle-contained" size={20} />}>{r.manques.join(" ")}</BandeauEtat>
    </div>
  ) : null;
  if (!r.notes.length && !r.souvenirs.length) {
    return <>{manques}<EtatEcran forme="encadre" icone="search-01" titre="Rien trouvé" texte={`Ni note, ni document, ni souvenir ne contient « ${r.requete} ». Essaie un autre mot.`} /></>;
  }
  return (
    <>
      {manques}
      {r.notes.length ? (
        <SectionListe titre="Notes et documents" compte={r.notes.length}>
          <GroupeListe>
            {r.notes.map((n) => (
              <LigneListe key={n.id} onClick={() => ouvrirPassage(n.id, n.titre)} debut={<TuileIcone icone="note-01" />} retrait="tuile" nom={n.titre}
                etiquette={n.historique ? <Etiquette>Archive</Etiquette> : undefined} ligne2={[n.origine, n.extrait.replace(/\s+/g, " ")].filter(Boolean).join(" · ")} fin="chevron" />
            ))}
          </GroupeListe>
        </SectionListe>
      ) : null}
      {r.souvenirs.length ? (
        <SectionListe titre="Souvenirs des agents" compte={r.souvenirs.length}>
          <GroupeListe>{r.souvenirs.map((s) => <LigneSouvenir key={s.id} s={s} ligne2={[s.nomAgent ?? s.agent, s.extrait].filter(Boolean).join(" · ")} onClick={() => ouvrirSouvenir(s)} />)}</GroupeListe>
        </SectionListe>
      ) : null}
    </>
  );
}

function FeuilleLecture({ lieu, ouvert, ouvrirSouvenir, onFermer }: { lieu: string | null; ouvert: Ouvert; ouvrirSouvenir: (s: SouvenirLu) => void; onFermer: () => void }) {
  const passage = useLecturePoste<PassageLu>("memoire.lire", ouvert.genre === "passage" ? { lieu, id: ouvert.id } : null, { garder: false });
  const souvenir = useLecturePoste<SouvenirOuvert>("memoire.souvenir", ouvert.genre === "souvenir" ? { lieu, id: ouvert.id } : null, { garder: false });
  const ferme = (sur: string) => `ce texte se lit sur ${sur}, quand KLYRA y est ouverte.`;
  const texte = (t: string) => <p className="px-5 pb-4 text-ui whitespace-pre-wrap text-texte-principal">{t}</p>;
  return (
    <Feuille titre={ouvert.titre} onFermer={onFermer} haute bordee>
      {ouvert.genre === "passage" ? (
        passage.etat === "attente" ? <DemandeEnCours lent={passage.lent} lignes={4} /> : (
          <VueLecture lecture={passage} lignes={4} gestes={null} sansRecours ferme={ferme}>
            {(p) => <>
              {p.origine ? <p className="px-5 pt-1 pb-2 text-ui-xs text-texte-secondaire">{p.origine} · lignes {p.lignes[0]} à {p.lignes[1]}</p> : null}
              {texte(p.texte)}
            </>}
          </VueLecture>
        )
      ) : souvenir.etat === "attente" ? <DemandeEnCours lent={souvenir.lent} lignes={4} /> : (
        <VueLecture lecture={souvenir} lignes={4} gestes={null} sansRecours ferme={ferme}>
          {(s) => <>
            <p className="px-5 pt-1 pb-2 text-ui-xs text-texte-secondaire">{[s.souvenir.nomAgent ?? s.souvenir.agent, s.souvenir.type ? TYPES[s.souvenir.type] : null, s.souvenir.projet, date(s.souvenir.date)].filter(Boolean).join(" · ")}</p>
            {texte(s.texte || "Ce souvenir est vide.")}
            {s.tronque ? <NoteListe>La suite se lit sur l’ordinateur.</NoteListe> : null}
            {s.voisins.length ? (
              <SectionListe titre="Liens" compte={s.voisins.length}>
                <GroupeListe>
                  {s.voisins.map((v, i) => v.id && v.nom ? (
                    <LigneListe key={`${v.id}-${i}`} onClick={() => ouvrirSouvenir({ id: v.id!, nom: v.nom!, agent: null, nomAgent: v.nomAgent ?? null, type: null, resume: "", date: null, projet: null })}
                      nom={v.nom} ligne2={[v.relation, v.nomAgent].filter(Boolean).join(" · ")} fin="chevron" />
                  ) : (
                    <LigneListe key={`p-${i}`} nom={v.projet ?? v.relation} ligne2={v.relation} />
                  ))}
                </GroupeListe>
              </SectionListe>
            ) : null}
          </>}
        </VueLecture>
      )}
    </Feuille>
  );
}
