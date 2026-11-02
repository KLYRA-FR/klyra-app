"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Textarea } from "klyra-ui";
import { RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { Markdown } from "@/components/ui/Markdown";
import { useDemandePoste } from "@/lib/poste/client";
import type { EtatLou } from "@/lib/telephone/gestes-agents";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { AvantApresFiche } from "./AvantApresFiche";
import { CHAMP_TELEPHONE, ChampTelephone, ErreurGeste, PagePleine, useCartesAgents } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { NotePoste } from "./etats";
import { useSupport } from "./poste";

/** Lou, l'agent qui écrit les fiches (`prompty`). */
const LOU = "prompty";
/** Lou met une à deux minutes : le téléphone demande où elle en est toutes les 3 s. */
const SUIVI_MS = 3000;

const IDEES = [
  "Resserre les règles : garde l’essentiel, enlève les répétitions.",
  "Ajoute une règle : il demande toujours une validation avant d’envoyer quoi que ce soit.",
  "Clarifie à quel moment l’appeler, et à quel moment appeler un collègue.",
];

type Etat =
  | { kind: "saisie" }
  | { kind: "travail"; tache: string }
  | { kind: "proposition"; tache: string; resume: string; avant: string; apres: string }
  | { kind: "erreur"; message: string };

/**
 * « Demander à Lou » sur le téléphone (spec T-09) : la vraie Lou travaille sur l'ordinateur (Claude
 * Code, sans droit d'écriture) ; le téléphone suit, montre l'avant puis l'après empilés, et « Appliquer »
 * écrit sur l'ordinateur seulement si la fiche n'a pas changé pendant qu'elle travaillait.
 */
export function LouAgentTelephone({ id }: { id: string }) {
  const router = useRouter();
  const sur = useSupport();
  const { carte } = useCartesAgents();
  const demanderPoste = useDemandePoste();
  const { agir, occupe, ouvert, erreur, setErreur } = useGesteTelephone();
  const [demande, setDemande] = useState("");
  const [etat, setEtat] = useState<Etat>({ kind: "saisie" });
  const nom = carte(id)?.nom ?? id;
  const lou = carte(LOU);
  const fiche = `/equipe?agent=${encodeURIComponent(id)}`;

  /* Quitter l'écran pendant qu'elle travaille annule la demande, comme au bureau. */
  const enCours = useRef<string | null>(null);
  useEffect(() => {
    enCours.current = etat.kind === "travail" ? etat.tache : null;
  }, [etat]);
  useEffect(
    () => () => {
      if (enCours.current) void demanderPoste("agents.louAbandonner", { tache: enCours.current });
    },
    [demanderPoste],
  );

  const tache = etat.kind === "travail" ? etat.tache : null;
  useEffect(() => {
    if (!tache || !ouvert) return;
    let actif = true;
    const suivre = async () => {
      const r = await demanderPoste<EtatLou>("agents.louEtat", { tache });
      if (!actif) return;
      if (!r.ok) {
        if (r.code !== "delai") setEtat({ kind: "erreur", message: r.message || "Lou n’a pas pu répondre." });
        return;
      }
      if (r.data.etat === "proposition") setEtat({ kind: "proposition", tache, resume: r.data.resume, avant: r.data.avant, apres: r.data.apres });
      else if (r.data.etat === "erreur") setEtat({ kind: "erreur", message: r.data.message });
    };
    const minuteur = setInterval(() => void suivre(), SUIVI_MS);
    return () => {
      actif = false;
      clearInterval(minuteur);
    };
  }, [tache, ouvert, demanderPoste]);

  const lancer = async () => {
    if (!demande.trim()) return;
    const r = await agir<{ tache: string }>("agents.lou", { id, demande: demande.trim(), depuis: etat.kind === "proposition" ? etat.tache : null });
    if (!r) return;
    setDemande("");
    setEtat({ kind: "travail", tache: r.tache });
  };
  const abandonner = async () => {
    if (etat.kind === "travail" || etat.kind === "proposition") await agir("agents.louAbandonner", { tache: etat.tache });
    setErreur(null);
    setEtat({ kind: "saisie" });
  };
  const appliquer = async () => {
    if (etat.kind !== "proposition") return;
    const ok = await agir("agents.louAppliquer", { tache: etat.tache });
    if (ok) router.push(`${fiche}&enregistre=1`);
  };

  const travail = etat.kind === "travail";
  return (
    <PagePleine>
      <EnteteTelephone titre={`Modifier ${nom} avec Lou`} retour={() => router.push(fiche)} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <div className="flex items-start gap-3">
          <RondApercu agentId={LOU} nom={lou?.nom ?? "Lou"} teinte={lou?.teinte ?? "violet"} taille={48} />
          <p className="text-ui text-texte-secondaire">
            Lou est l’agent qui écrit les consignes de l’équipe. Dis-lui en une phrase ce qui doit changer dans la fiche de {nom} : elle la réécrit sur {sur}, tu
            compares l’avant et l’après, et rien n’est enregistré sans ton accord.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          <ChampTelephone label={etat.kind === "proposition" ? "Ajuster la proposition" : "Ce qui doit changer"}>
            <Textarea
              size="lg"
              autoGrow
              rows={3}
              value={demande}
              disabled={travail}
              placeholder={`Ex. « ${nom} doit aussi s’occuper des tests de bout en bout. »`}
              onChange={(e) => setDemande(e.target.value)}
              className={CHAMP_TELEPHONE}
            />
          </ChampTelephone>
          {etat.kind === "saisie" ? (
            <ul className="flex flex-col gap-2">
              {IDEES.map((idee) => (
                <li key={idee}>
                  <button type="button" onClick={() => setDemande(idee)} className="min-h-11 w-full rounded-xs border border-bordure-subtile px-3 py-2 text-left text-ui text-texte-secondaire active:bg-fond-survol">
                    {idee}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          {travail ? (
            <div className="flex flex-col gap-2">
              <p className="text-ui text-texte-secondaire" aria-live="polite">
                Lou lit la fiche et prépare sa proposition. Ça prend en général une à deux minutes.
              </p>
              <Bouton variant="blanc" taille="md" onClick={() => void abandonner()}>
                Annuler
              </Bouton>
            </div>
          ) : (
            <>
              <Bouton variant="sombre" taille="md" disabled={!ouvert || occupe || !demande.trim()} onClick={() => void lancer()}>
                {etat.kind === "proposition" ? "Redemander à Lou" : "Demander à Lou"}
              </Bouton>
              {ouvert ? <p className="text-ui-xs text-texte-secondaire">Lou tourne sur {sur} avec ton compte Claude, sans droit d’écriture.</p> : <NotePoste />}
            </>
          )}
          {etat.kind === "erreur" ? <ErreurGeste message={etat.message} /> : null}
          <ErreurGeste
            message={erreur ? (erreur.code === "conflit" ? `La fiche a changé sur ${sur} pendant que Lou travaillait. Relance la demande sur la nouvelle version.` : erreur.message) : null}
          />
        </div>

        {etat.kind === "proposition" ? (
          <div className="mt-6 flex flex-col gap-4">
            {etat.resume ? (
              <section className="rounded-xl border border-bordure-subtile bg-fond-surface p-4">
                <h3 className="text-ui font-medium text-texte-principal">Ce que Lou a changé</h3>
                <Markdown source={etat.resume} className="mt-2 text-body-s text-texte-principal" />
              </section>
            ) : null}
            <AvantApresFiche avant={etat.avant} apres={etat.apres} />
          </div>
        ) : null}
      </div>
      {etat.kind === "proposition" ? (
        <div className="flex shrink-0 flex-col gap-2 border-t border-bordure-subtile bg-fond-surface px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
          <BoutonPrincipal className="w-full" disabled={!ouvert || occupe} onClick={() => void appliquer()}>
            Appliquer
          </BoutonPrincipal>
          <Bouton variant="blanc" taille="md" disabled={occupe} onClick={() => void abandonner()}>
            Abandonner
          </Bouton>
          {ouvert ? <p className="text-ui-xs text-texte-secondaire">L’ancienne version reste dans l’historique.</p> : <NotePoste />}
        </div>
      ) : null}
    </PagePleine>
  );
}
