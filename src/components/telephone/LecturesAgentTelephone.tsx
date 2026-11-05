"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Onglets } from "@/components/ui/Onglets";
import { Markdown } from "@/components/ui/Markdown";
import { cleJour, compact, UN_JOUR } from "@/lib/consommation";
import { useLecturePoste } from "@/lib/poste/client";
import type { CompetenceLue, SouvenirsLus, UtilisationLue } from "@/lib/telephone/gestes-agents";
import { CHAMP_TELEPHONE } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
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

function SouvenirsTelephone({ id }: { id: string }) {
  const sur = useSupport();
  const lecture = useLecturePoste<SouvenirsLus>("agents.souvenirs", { id });
  const [filtre, setFiltre] = useState("");
  const q = filtre.trim().toLocaleLowerCase("fr");
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Souvenirs" parent={`/equipe?agent=${encodeURIComponent(id)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={5} ferme={(s) => `les souvenirs sont sur ${s}. Ils se lisent quand KLYRA y est ouverte.`}>
          {(lu) => {
            const garder = lu.souvenirs.filter((s) => !q || `${s.titre} ${s.extrait}`.toLocaleLowerCase("fr").includes(q));
            const toujours = garder.filter((s) => s.toujours);
            const besoin = garder.filter((s) => !s.toujours);
            return (
              <div className="flex flex-col gap-4 pt-3">
                <label className="flex flex-col gap-1">
                  <span className="text-ui font-medium text-texte-principal">Rechercher dans les titres</span>
                  <input value={filtre} onChange={(e) => setFiltre(e.target.value)} className={CHAMP_TELEPHONE} placeholder="Titre ou extrait" />
                </label>
                <p className="text-ui-xs text-texte-secondaire">Ajouter ou modifier un souvenir se fait sur {sur}.</p>
                {lu.coupee ? <p className="text-ui text-texte-principal">La liste est coupée : tout n’a pas été renvoyé.</p> : null}
                {lu.souvenirs.length === 0 ? <p className="text-ui text-texte-secondaire">Aucun souvenir.</p> : null}
                {lu.souvenirs.length > 0 && garder.length === 0 ? <p className="text-ui text-texte-secondaire">Aucun souvenir ne correspond.</p> : null}
                <ListeSouvenirs id={id} titre="Toujours lu" lignes={toujours} />
                <ListeSouvenirs id={id} titre="Lus au besoin" lignes={besoin} />
              </div>
            );
          }}
        </VueLecture>
      </div>
    </div>
  );
}

function ListeSouvenirs({ id, titre, lignes }: { id: string; titre: string; lignes: SouvenirsLus["souvenirs"] }) {
  if (!lignes.length) return null;
  return (
    <section>
      <h2 className="mb-2 text-ui font-medium text-texte-secondaire">
        {titre} · {lignes.length}
      </h2>
      <ul className="flex list-none flex-col gap-2 p-0">
        {lignes.map((s) => (
          <li key={s.ref}>
            <Link
              href={`/equipe?agent=${encodeURIComponent(id)}&mode=souvenirs&souvenir=${encodeURIComponent(s.ref)}`}
              className="flex min-h-11 flex-col justify-center rounded-lg border border-bordure-subtile bg-fond-surface px-3 py-2"
            >
              <span className="text-body-s font-medium text-texte-principal">{s.titre}</span>
              {s.extrait ? <span className="line-clamp-2 text-ui-xs text-texte-secondaire">{s.extrait}</span> : null}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SouvenirTelephone({ id, refSouvenir }: { id: string; refSouvenir: string }) {
  const router = useRouter();
  const lecture = useLecturePoste<{ titre: string; contenu: string; modifieLe: number }>("agents.souvenir", { id, ref: refSouvenir });
  const date = (n: number) => new Date(n).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Souvenir" retour={() => router.push(`/equipe?agent=${encodeURIComponent(id)}&mode=souvenirs`)} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={6} ferme={() => "Ce souvenir n’est pas gardé sur ce téléphone."}>
          {(lu) => (
            <article className="pt-3">
              <h2 className="text-body font-semibold text-texte-principal">{lu.titre}</h2>
              {lu.modifieLe ? <p className="mt-1 text-ui-xs text-texte-secondaire">{date(lu.modifieLe)}</p> : null}
              <div className="mt-4 text-body-s text-texte-principal">
                <Markdown source={lu.contenu} />
              </div>
            </article>
          )}
        </VueLecture>
      </div>
    </div>
  );
}

const ORIGINES: { id: CompetenceLue["origine"]; titre: string }[] = [
  { id: "fiche", titre: "Préchargées" },
  { id: "projet", titre: "Du projet" },
  { id: "poste", titre: "Du poste" },
  { id: "plugin", titre: "Des plugins" },
];

function CompetencesTelephone({ id }: { id: string }) {
  const sur = useSupport();
  const lecture = useLecturePoste<{ competences: CompetenceLue[] }>("agents.competences", { id });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Compétences" parent={`/equipe?agent=${encodeURIComponent(id)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={5} ferme={(s) => `les compétences se lisent sur ${s}.`}>
          {(lu) => (
            <div className="flex flex-col gap-4 pt-3">
              <p className="text-ui-xs text-texte-secondaire">Les activer ou les installer se fait sur {sur}.</p>
              {lu.competences.length === 0 ? <p className="text-ui text-texte-secondaire">Aucune compétence.</p> : null}
              {ORIGINES.map((groupe) => {
                const lignes = lu.competences.filter((c) => c.origine === groupe.id);
                if (!lignes.length) return null;
                return (
                  <section key={groupe.id}>
                    <h2 className="mb-2 text-ui font-medium text-texte-secondaire">
                      {groupe.titre} · {lignes.length}
                    </h2>
                    <ul className="flex list-none flex-col gap-2 p-0">
                      {lignes.map((c) => (
                        <li key={`${c.origine}-${c.nom}`} className="rounded-lg border border-bordure-subtile bg-fond-surface px-3 py-2">
                          <p className="text-body-s font-medium text-texte-principal">{c.nom}</p>
                          <p className="text-ui-xs text-texte-secondaire">{c.prechargee ? "Préchargée" : "Au besoin"}</p>
                          {c.resume ? <p className="mt-1 text-ui-xs text-texte-secondaire">{c.resume}</p> : null}
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
            </div>
          )}
        </VueLecture>
      </div>
    </div>
  );
}

type Periode = "7" | "30" | "365";

function UtilisationTelephone({ id }: { id: string }) {
  const lecture = useLecturePoste<UtilisationLue>("agents.utilisation", { id });
  const [periode, setPeriode] = useState<Periode>("30");
  const [ouvert] = useState(() => Date.now());
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Utilisation" parent={`/equipe?agent=${encodeURIComponent(id)}`} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <VueLecture lecture={lecture} lignes={5} ferme={(s) => `l’utilisation se calcule sur ${s}, d’après son journal.`}>
          {(lu) => <ChiffresUtilisation entrees={lu.entrees} periode={periode} onPeriode={setPeriode} maintenant={ouvert} />}
        </VueLecture>
      </div>
    </div>
  );
}

function ChiffresUtilisation({
  entrees,
  periode,
  onPeriode,
  maintenant,
}: {
  entrees: UtilisationLue["entrees"];
  periode: Periode;
  onPeriode: (p: Periode) => void;
  maintenant: number;
}) {
  const depuis = maintenant - Number(periode) * UN_JOUR;
  const dans = useMemo(() => entrees.filter((e) => e.at >= depuis), [entrees, depuis]);
  const jetons = dans.reduce((n, e) => n + e.entree + e.sortie + e.cacheLu + e.cacheEcrit, 0);
  const couts = dans.filter((e) => e.coutUsd !== null);
  const cout = couts.reduce((n, e) => n + (e.coutUsd ?? 0), 0);
  const jours = new Map<string, number>();
  for (const e of dans) {
    const cle = cleJour(e.at);
    jours.set(cle, (jours.get(cle) ?? 0) + e.entree + e.sortie + e.cacheLu + e.cacheEcrit);
  }
  const actifs = [...jours.entries()].filter(([, n]) => n > 0);
  const max = Math.max(...actifs.map(([, n]) => n), 1);
  return (
    <div className="flex flex-col gap-4 pt-3">
      <Onglets<Periode>
        libelle="Période"
        valeur={periode}
        onChange={onPeriode}
        onglets={[
          { id: "7", label: "7 jours" },
          { id: "30", label: "30 jours" },
          { id: "365", label: "1 an" },
        ]}
      />
      {dans.length === 0 ? (
        <p className="text-ui text-texte-secondaire">Aucune activité enregistrée sur cette période.</p>
      ) : (
        <>
          <p className="text-body font-semibold text-texte-principal">{compact(jetons)} jetons · {dans.length} appel{dans.length > 1 ? "s" : ""}</p>
          <p className="text-ui text-texte-secondaire">
            {couts.length === 0
              ? "Coût indisponible."
              : couts.length === dans.length
                ? `${cout.toLocaleString("fr-FR", { style: "currency", currency: "USD" })} indiqués par le journal.`
                : `${cout.toLocaleString("fr-FR", { style: "currency", currency: "USD" })} indiqués. ${dans.length - couts.length} appel${dans.length - couts.length > 1 ? "s" : ""} sans coût.`}
          </p>
          <div className="flex h-16 items-end gap-0.5" aria-hidden="true">
            {actifs.map(([cle, n]) => (
              <span key={cle} className="min-h-1 flex-1 rounded-t-sm bg-fond-accent" style={{ height: `${Math.max(8, (n / max) * 100)}%` }} />
            ))}
          </div>
          <ul className="flex list-none flex-col p-0">
            {actifs.map(([cle, n]) => (
              <li key={cle} className="flex min-h-11 items-center justify-between gap-3 border-b border-bordure-subtile text-ui">
                <span>{new Date(`${cle}T12:00:00`).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}</span>
                <span className="font-medium">{compact(n)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
