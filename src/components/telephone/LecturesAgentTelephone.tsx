"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Markdown } from "@/components/ui/Markdown";
import { Onglets } from "@/components/ui/Onglets";
import { compact } from "@/lib/consommation";
import { useLecturePoste, useVueGardeePresente } from "@/lib/poste/client";
import { seriesUtilisation, syntheseUtilisation, type PeriodeUtilisation } from "@/lib/telephone/agents";
import type { CompetenceLue, SouvenirsLus, UtilisationLue } from "@/lib/telephone/gestes-agents";
import { CHAMP_TELEPHONE, ONGLETS_TELEPHONE, useCartesAgents } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { Carte, Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { useSupport } from "./poste";
import { VueLecture } from "./etats";

/**
 * Souvenirs, compétences et utilisation, en lecture (lot 5, E5-35 à E5-39).
 * Les chiffres viennent du poste. Une source absente reste une erreur, pas un zéro.
 */

type Mode = "souvenirs" | "competences" | "utilisation";

export function LecturesAgentTelephone({ id, mode }: { id: string; mode: Mode }) {
  const souvenir = useSearchParams().get("souvenir");
  if (mode === "souvenirs" && souvenir) return <SouvenirTelephone id={id} refSouvenir={souvenir} />;
  if (mode === "competences") return <CompetencesTelephone id={id} />;
  if (mode === "utilisation") return <UtilisationTelephone id={id} />;
  return <SouvenirsTelephone id={id} />;
}

/** « Souvenirs de Léon » ; sans carte, le titre seul : jamais l'identifiant (socle § 8). */
function useTitre(mot: string, id: string): string {
  const { carte } = useCartesAgents();
  const nom = carte(id)?.nom;
  return nom ? `${mot} de ${nom}` : mot;
}

function SouvenirsTelephone({ id }: { id: string }) {
  const sur = useSupport();
  const titre = useTitre("Souvenirs", id);
  const lecture = useLecturePoste<SouvenirsLus>("agents.souvenirs", { id });
  const [filtre, setFiltre] = useState("");
  const q = filtre.trim().toLocaleLowerCase("fr");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} parent={`/equipe?agent=${encodeURIComponent(id)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        {/* Vue gardée : chercher dans la liste gardée reste permis (E5-39), rien n'y écrit. */}
        <VueLecture lecture={lecture} lignes={5} verrou={false} ferme={(s) => `les souvenirs sont sur ${s}. Ils se lisent quand KLYRA y est ouverte.`}>
          {(lu) => {
            const garder = lu.souvenirs.filter((s) => !q || `${s.titre} ${s.extrait}`.toLocaleLowerCase("fr").includes(q));
            const toujours = garder.filter((s) => s.toujours);
            const besoin = garder.filter((s) => !s.toujours);
            const gardee = lecture.etat === "ferme";
            return (
              <div className="flex flex-col gap-4 pt-1">
                <p className="px-1 text-ui-xs text-texte-secondaire">Sa mémoire dans sa conversation directe</p>
                <div className="relative">
                  <Icon name="search-01" size={20} className="pointer-events-none absolute top-1/2 left-3.5 z-10 -translate-y-1/2 text-icone-secondaire" />
                  <Input size="lg" aria-label="Chercher dans ses souvenirs" value={filtre} onChange={(e) => setFiltre(e.target.value)} className={`${CHAMP_TELEPHONE} pl-11`} placeholder="Chercher dans ses souvenirs" />
                </div>
                {lu.coupee ? <p className="px-1 text-ui text-texte-principal">La liste est coupée : tout n’a pas été renvoyé.</p> : null}
                {lu.souvenirs.length === 0 ? <p className="px-1 text-ui text-texte-secondaire">Aucun souvenir.</p> : null}
                {lu.souvenirs.length > 0 && garder.length === 0 ? <p className="px-1 text-ui text-texte-secondaire">Aucun souvenir ne correspond.</p> : null}
                <ListeSouvenirs id={id} titre="Toujours lu" lignes={toujours} gardee={gardee} />
                <ListeSouvenirs id={id} titre="Lus au besoin" lignes={besoin} gardee={gardee} />
                <Carte>
                  <span className="flex items-start gap-3">
                    <TuileIcone icone="pencil-01" />
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 text-body-s font-medium text-texte-principal">
                        Ajouter ou modifier <Etiquette>Sur {sur}</Etiquette>
                      </span>
                      <span className="mt-0.5 block text-ui text-texte-secondaire">Un souvenir s’écrit dans les fichiers de l’agent.</span>
                    </span>
                  </span>
                </Carte>
              </div>
            );
          }}
        </VueLecture>
      </div>
    </div>
  );
}

function ListeSouvenirs({ id, titre, lignes, gardee }: { id: string; titre: string; lignes: SouvenirsLus["souvenirs"]; gardee: boolean }) {
  if (!lignes.length) return null;
  return (
    <SectionListe titre={titre} compte={lignes.length}>
      <GroupeListe>
        {lignes.map((s) => (
          <LigneSouvenir key={s.ref} id={id} souvenir={s} gardee={gardee} />
        ))}
      </GroupeListe>
    </SectionListe>
  );
}

/** Vue gardée : seul un souvenir déjà ouvert se relit, les autres lignes le disent (E5-39). */
function LigneSouvenir({ id, souvenir: s, gardee }: { id: string; souvenir: SouvenirsLus["souvenirs"][number]; gardee: boolean }) {
  const lisible = useVueGardeePresente("agents.souvenir", { id, ref: s.ref });
  return (
    <LigneListe
      href={`/equipe?agent=${encodeURIComponent(id)}&mode=souvenirs&souvenir=${encodeURIComponent(s.ref)}`}
      debut={s.toujours ? <TuileIcone icone="note-01" /> : undefined}
      retrait={s.toujours ? "tuile" : "aucun"}
      nom={s.titre}
      ligne2={s.extrait || undefined}
      fin="chevron"
      inactive={gardee && !lisible}
      raison="Pas gardé sur ce téléphone"
    />
  );
}

function SouvenirTelephone({ id, refSouvenir }: { id: string; refSouvenir: string }) {
  const router = useRouter();
  const lecture = useLecturePoste<{ titre: string; contenu: string; modifieLe: number }>("agents.souvenir", { id, ref: refSouvenir });
  const date = (n: number) => new Date(n).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={lecture.etat === "ok" ? lecture.data.titre : "Souvenir"} retour={() => router.push(`/equipe?agent=${encodeURIComponent(id)}&mode=souvenirs`)} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={6} ferme={() => "Ce souvenir n’est pas gardé sur ce téléphone."}>
          {(lu) => (
            <article className="pt-1">
              {lu.modifieLe ? <p className="px-1 text-ui-xs text-texte-secondaire">Modifié le {date(lu.modifieLe)}</p> : null}
              <Carte className="mt-2">
                <h2 className="text-body-s font-semibold text-texte-principal">{lu.titre}</h2>
                <div className="mt-2 text-body-s text-texte-principal">
                  <Markdown source={lu.contenu} />
                </div>
              </Carte>
            </article>
          )}
        </VueLecture>
      </div>
    </div>
  );
}

const ORIGINES: { id: CompetenceLue["origine"]; titre: string }[] = [
  { id: "fiche", titre: "Préchargées par sa fiche" },
  { id: "projet", titre: "Du projet" },
  { id: "poste", titre: "De l’app" },
  { id: "plugin", titre: "Des plugins" },
];

function CompetencesTelephone({ id }: { id: string }) {
  const sur = useSupport();
  const titre = useTitre("Compétences", id);
  const lecture = useLecturePoste<{ competences: CompetenceLue[]; couvre: string[] }>("agents.competences", { id });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} parent={`/equipe?agent=${encodeURIComponent(id)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={5} ferme={(s) => `les compétences se lisent sur ${s}.`}>
          {(lu) => (
            <div className="flex flex-col gap-4 pt-1">
              {lu.couvre.length ? (
                <SectionListe titre="Ce qu’il couvre">
                  <div className="flex flex-wrap gap-1.5 px-1">
                    {lu.couvre.map((c) => (
                      <Etiquette key={c}>{c}</Etiquette>
                    ))}
                  </div>
                  <p className="mt-2 px-1 text-ui-xs text-texte-secondaire">D’après sa description.</p>
                </SectionListe>
              ) : null}
              {lu.competences.length === 0 ? <p className="px-1 text-ui text-texte-secondaire">Aucune compétence.</p> : null}
              {ORIGINES.map((groupe) => {
                /* Une compétence préchargée n'est listée qu'une fois, avec sa fiche. */
                const prechargees = new Set(lu.competences.filter((c) => c.origine === "fiche").map((c) => c.nom));
                const lignes = lu.competences.filter((c) => c.origine === groupe.id && (groupe.id === "fiche" || !prechargees.has(c.nom)));
                if (!lignes.length) return null;
                return (
                  <SectionListe key={groupe.id} titre={groupe.titre} compte={lignes.length}>
                    <GroupeListe>
                      {lignes.map((c) => (
                        <LigneListe
                          key={`${c.origine}-${c.nom}`}
                          debut={<TuileIcone icone="layers-01" bleue={c.prechargee && !c.coupee} />}
                          retrait="tuile"
                          nom={c.nom}
                          ligne2={c.coupee ? `Coupée pour lui : il ne la reçoit pas.${c.resume ? ` ${c.resume}` : ""}` : c.resume || undefined}
                        />
                      ))}
                    </GroupeListe>
                    {groupe.id === "fiche" ? <p className="mt-2 px-1 text-ui-xs text-texte-secondaire">Leur texte entre dans chaque appel de l’agent.</p> : null}
                  </SectionListe>
                );
              })}
              <p className="px-1 text-ui-xs text-texte-secondaire">
                Il peut se servir des autres au besoin, sauf de celles qui lui sont coupées. Précharger, retirer ou lui donner une skill : sur {sur}.
              </p>
            </div>
          )}
        </VueLecture>
      </div>
    </div>
  );
}

function UtilisationTelephone({ id }: { id: string }) {
  const titre = useTitre("Utilisation", id);
  const lecture = useLecturePoste<UtilisationLue>("agents.utilisation", { id });
  const [periode, setPeriode] = useState<PeriodeUtilisation>("30");
  const [maintenant] = useState(() => Date.now());
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} parent={`/equipe?agent=${encodeURIComponent(id)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={5} verrou={false} ferme={(s) => `l’utilisation se calcule sur ${s}, d’après son journal.`}>
          {(lu) => <ChiffresUtilisation lu={lu} periode={periode} onPeriode={setPeriode} maintenant={maintenant} />}
        </VueLecture>
      </div>
    </div>
  );
}

const CHIFFRES_JETONS = [
  ["Entrée", "entree"],
  ["Sortie", "sortie"],
  ["Cache lu", "cacheLu"],
  ["Cache écrit", "cacheEcrit"],
] as const;

function ChiffresUtilisation({ lu, periode, onPeriode, maintenant }: { lu: UtilisationLue; periode: PeriodeUtilisation; onPeriode: (p: PeriodeUtilisation) => void; maintenant: number }) {
  const s = syntheseUtilisation(lu, periode, maintenant);
  const barres = seriesUtilisation(lu, periode, maintenant);
  const max = Math.max(...barres.map((b) => b.jetons), 1);
  const actives = barres.filter((b) => b.jetons > 0);
  const dollars = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "USD" });
  const cout = s.appelsAvecCout === 0 ? "coût indisponible" : s.appelsSansCout ? `${dollars(s.coutUsd)} indiqués · ${s.appelsSansCout} appel${s.appelsSansCout > 1 ? "s" : ""} sans coût` : `${dollars(s.coutUsd)} indiqués par le journal`;
  return (
    <div className="flex flex-col gap-3.5 pt-1">
      <Onglets<PeriodeUtilisation>
        libelle="Période"
        className={ONGLETS_TELEPHONE}
        valeur={periode}
        onChange={onPeriode}
        onglets={[
          { id: "7", label: "7 jours" },
          { id: "30", label: "30 jours" },
          { id: "365", label: "1 an" },
        ]}
      />
      {s.appels === 0 ? (
        <p className="px-1 text-ui text-texte-secondaire">Aucune activité enregistrée sur cette période.</p>
      ) : (
        <>
          <div className="px-1">
            <p className="text-h3 leading-[1.1] font-semibold tracking-title text-texte-principal">{compact(s.jetons)} jetons</p>
            <p className="mt-1 text-ui-xs text-texte-secondaire">
              {s.appels} appel{s.appels > 1 ? "s" : ""} · {cout}
            </p>
          </div>
          <Carte>
            <div role="img" aria-label={`${actives.length} ${periode === "365" ? "mois" : `jour${actives.length > 1 ? "s" : ""}`} avec de l’activité sur ${barres.length}, au plus ${compact(max)} jetons`} className="flex h-20 items-end gap-[3px]">
              {barres.map((b) => (
                <span key={b.cle} className={b.jetons ? "flex-1 rounded-t-[2px] bg-bleu-k1-500" : "h-px flex-1 bg-bordure-defaut"} style={b.jetons ? { height: `${Math.max(6, (b.jetons / max) * 100)}%` } : undefined} />
              ))}
            </div>
            <div className="mt-2 flex justify-between text-ui-xs text-texte-secondaire">
              <span>{barres[0]?.libelle}</span>
              <span>{barres.at(-1)?.libelle}</span>
            </div>
          </Carte>
          <SectionListe titre="Jetons">
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-bordure-subtile bg-bordure-subtile">
              {CHIFFRES_JETONS.map(([libelle, cle]) => (
                <div key={cle} className="bg-fond-surface px-4 py-3">
                  <p className="text-ui-xs text-texte-secondaire">{libelle}</p>
                  <p className="klyra-mono mt-2 text-body-s font-medium text-texte-principal">{compact(s[cle])}</p>
                </div>
              ))}
            </div>
          </SectionListe>
          {s.modeles.length ? (
            <SectionListe titre="Par modèle">
              <GroupeListe>
                {s.modeles.map((m) => (
                  <LigneListe key={m.modele} nom={m.modele} fin={<span className="shrink-0 text-ui text-texte-secondaire">{Math.round((m.jetons / s.jetons) * 100)} % · {compact(m.jetons)}</span>} />
                ))}
              </GroupeListe>
            </SectionListe>
          ) : null}
          <SectionListe titre={periode === "365" ? "Par mois" : "Par jour"}>
            <GroupeListe>
              {[...actives].reverse().map((b) => (
                <LigneListe key={b.cle} nom={b.libelle} fin={<span className="shrink-0 text-ui text-texte-secondaire">{compact(b.jetons)}</span>} />
              ))}
            </GroupeListe>
          </SectionListe>
          <p className="px-1 text-ui-xs text-texte-secondaire">Seulement ce qui est passé par l’app, d’après son journal.</p>
        </>
      )}
    </div>
  );
}
