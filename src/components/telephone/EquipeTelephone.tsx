"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { AgentFormes } from "@/components/team/AgentFormes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { PILIERS } from "@/lib/atelier-agent";
import { cn } from "@/lib/cn";
import type { CarteEquipeCompte, MembreEquipeCompte } from "@/lib/copie-compte";
import { jouer } from "@/lib/sons/sons";
import { useGesteTelephone } from "@/lib/telephone/geste";
import type { RoleTeinte } from "@/types/domain";
import { NotePoste } from "./etats";
import { useCartes } from "./AgentsChat";
import { useSupport } from "./poste";

/**
 * L'atelier d'une équipe sur le téléphone : la carte calculée par l'ordinateur (copie du compte,
 * src/lib/atelier-compte.ts), et les gestes qu'il fait pour le téléphone (`atelier.equipe*` : garder
 * un agent ou le laisser de côté, créer l'équipe, cf. src/lib/telephone/gestes-equipe.ts). Ordinateur
 * fermé, les gestes sont désactivés (P-7) ; la couleur et l'affinage restent au bureau.
 */

export function LigneEquipeTelephone({ ligne }: { ligne: { nom: string; arrivent: { id: string; nom: string; teinte: RoleTeinte }[] } }) {
  const nom = ligne.nom || "l’équipe";
  return (
    <div className="flex min-h-8 w-full min-w-0 items-center gap-2 px-1 text-ui-xs text-texte-secondaire">
      <span aria-hidden="true" className="flex -space-x-1.5">
        {ligne.arrivent.slice(0, 4).map((m) => (
          <RondApercu key={m.id} agentId={m.id} nom={m.nom} teinte={m.teinte} taille={20} />
        ))}
      </span>
      <span className="min-w-0 flex-1 truncate">
        {ligne.arrivent.length ? `Équipe ${nom} : ${ligne.arrivent.map((m) => m.nom || m.id).join(", ")} arrive${ligne.arrivent.length > 1 ? "nt" : ""}` : `Équipe ${nom} mise à jour`}
      </span>
    </div>
  );
}

export function CarteEquipeTelephone({ etapeId, carte, conversation }: { etapeId: string; carte: CarteEquipeCompte; conversation: string }) {
  const sur = useSupport();
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const [enCreation, setEnCreation] = useState(false);
  /* Le choix fait ici, montré tout de suite, jusqu'à ce que la copie suivante de l'ordinateur le porte. */
  const [voulus, setVoulus] = useState<Record<string, boolean>>({});
  const args = { conversation, etapeId };
  const libre = ouvert && !occupe && !carte.provisoire && !carte.nee && !carte.remplacee;
  const ecarte = (m: MembreEquipeCompte) => (m.cle in voulus && voulus[m.cle] !== !m.ecarte ? !voulus[m.cle] : m.ecarte);

  const garder = async (m: MembreEquipeCompte, oui: boolean) => {
    setVoulus((v) => ({ ...v, [m.cle]: oui }));
    if (!(await agir("atelier.equipeGarder", { ...args, membre: m.cle, garder: oui })))
      setVoulus((v) => Object.fromEntries(Object.entries(v).filter(([cle]) => cle !== m.cle)));
  };
  const creer = async () => {
    setEnCreation(true);
    const r = await agir<{ ids: string[] }>("atelier.equipeCreer", args, (d) => `Équipe créée : ${d.ids.length} agent${d.ids.length > 1 ? "s" : ""} rejoignent ton équipe.`);
    setEnCreation(false);
    if (r) jouer("agent-ne");
  };

  const note = carte.remplacee
    ? "Remplacée par une autre équipe, plus bas."
    : carte.nee
      ? "Tous dans Mes agents."
      : carte.manques.length
        ? `Il manque ${carte.manques.join(" ; ")}.`
        : `Rien n’est écrit sur ${sur} avant ce geste.`;

  return (
    <div data-carte-equipe={etapeId} className="flex w-full flex-col gap-3">
      {bandeau}
      <span className={cn("text-ui-xs text-texte-secondaire", carte.provisoire && "klyra-respire")}>
        {carte.nee ? "Ton équipe est née" : carte.provisoire ? "L’assistant compose ton équipe…" : "Atelier · nouvelle équipe"}
      </span>
      <section aria-label={`Équipe ${carte.nom || "en préparation"}`} className="flex flex-col overflow-hidden rounded-3xl border border-bordure-subtile bg-fond-surface shadow-ombre-levee">
        <div className="flex flex-col gap-1.5 px-5 pt-5 pb-4">
          <span className="text-h3 leading-[1] font-semibold tracking-[-0.05em] text-texte-principal">{carte.nom || "Ton équipe"}</span>
          <p className={cn("text-ui leading-[1.45]", carte.but ? "text-texte-secondaire" : "text-texte-tertiaire")}>{carte.but || "Ce qu’elle fera pour toi s’écrira ici."}</p>
          {carte.existants.length ? <Existants ids={carte.existants.map((e) => e.id)} /> : null}
        </div>
        {/* Les agents côte à côte : on fait défiler la rangée du doigt. */}
        <ul aria-label="Les agents de l’équipe" className="klyra-tablee m-0 flex list-none snap-x snap-mandatory gap-3 overflow-x-auto border-y border-bordure-subtile p-4 [scrollbar-width:none]">
          {carte.membres.map((m) => {
            const deCote = ecarte(m);
            return (
              <li key={m.cle} className={cn("flex w-[148px] shrink-0 snap-start flex-col gap-2", deCote && "opacity-50 grayscale")}>
                <div className="relative flex aspect-[3/4] flex-col overflow-hidden rounded-2xl shadow-ombre-sm" style={{ backgroundImage: fondCarte(m.teinte) }}>
                  <AgentFormes agentId={m.id} className="klyra-formes-entree mx-auto mt-[8%] aspect-square w-[78%]" />
                  <span className="mt-auto flex min-w-0 flex-col gap-0.5 px-3 pb-3">
                    <span className="truncate text-ui leading-[1.1] font-semibold text-texte-principal">{m.nom}</span>
                    <span className="truncate text-ui-2xs" style={{ color: AGENT_PASTELS[m.teinte].encre }}>
                      {m.role || "Son rôle viendra"}
                    </span>
                    <span role="img" aria-label={`${m.remplis.length} pilier${m.remplis.length > 1 ? "s" : ""} sur 5`} className="mt-0.5 flex gap-px">
                      {PILIERS.map((p) => (
                        <span key={p.cle} aria-hidden="true" className={cn("flex", m.remplis.includes(p.cle) ? "text-icone-accent" : "text-bordure-forte")}>
                          <Icon name="stars" size={10} />
                        </span>
                      ))}
                    </span>
                  </span>
                  {m.cree ? (
                    <span className="absolute top-2 left-2 flex size-6 items-center justify-center rounded-full bg-white/90 text-icone-accent">
                      <Icon name="check-01" size={14} />
                    </span>
                  ) : null}
                </div>
                <p className="line-clamp-3 text-ui-xs leading-[1.4] text-texte-secondaire">{m.mission || "Sa mission s’écrira ici."}</p>
                {m.pris ? <p className="text-ui-2xs text-texte-erreur">Prénom déjà pris par {m.pris}.</p> : null}
                {!m.cree && !carte.nee && !carte.remplacee ? (
                  <Bouton variant="blanc" className="h-11 text-ui" disabled={!libre} onClick={() => void garder(m, deCote)}>
                    {deCote ? "Le reprendre" : "Le laisser de côté"}
                  </Bouton>
                ) : null}
              </li>
            );
          })}
        </ul>
        {carte.exemples.length ? <QuiSenChargeTelephone carte={carte} /> : null}
      </section>
      {!carte.nee && !carte.remplacee ? (
        <div className="flex flex-col items-start gap-1">
          <span className="text-ui-xs text-texte-secondaire">
            {carte.aCreer} agent{carte.aCreer > 1 ? "s" : ""} à créer · <span className="klyra-mono">~{carte.jetons.toLocaleString("fr-FR")} jetons</span> de fiches
          </span>
          <BoutonPrincipal onClick={() => void creer()} disabled={!libre || !!carte.manques.length || !carte.aCreer}>
            {enCreation ? "Création…" : carte.aCreer > 1 ? "Créer l’équipe" : "Créer l’agent"}
          </BoutonPrincipal>
          {!ouvert ? <NotePoste /> : null}
        </div>
      ) : null}
      {erreur ? (
        <p role="alert" className="text-ui-xs text-texte-erreur [overflow-wrap:anywhere]">
          {erreur.message}
        </p>
      ) : null}
      <p className="text-ui-xs text-texte-secondaire [overflow-wrap:anywhere]">{note}</p>
    </div>
  );
}

function Existants({ ids }: { ids: string[] }) {
  const { nom, teinte } = useCartes();
  return (
    <span className="flex items-center gap-1.5 text-ui-xs text-texte-secondaire">
      <span aria-hidden="true" className="flex -space-x-1">
        {ids.slice(0, 4).map((id) => (
          <RondApercu key={id} agentId={id} nom={nom(id)} teinte={teinte(id)} taille={18} />
        ))}
      </span>
      Avec {ids.map(nom).join(", ")}, déjà dans ton équipe
    </span>
  );
}

function QuiSenChargeTelephone({ carte }: { carte: CarteEquipeCompte }) {
  const { teinte } = useCartes();
  return (
    <div className="flex flex-col gap-2 px-5 py-4">
      <span className="text-ui-s font-semibold text-texte-principal">Qui s’en charge</span>
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
        {carte.exemples.map((e) => {
          const membre = carte.membres.find((m) => m.cle === e.membre);
          return (
            <li key={`${e.demande}-${e.membre}`} className="flex flex-col gap-1 rounded-lg border border-bordure-subtile px-3 py-2">
              <span className="text-ui-xs leading-[1.4] text-texte-principal">« {e.demande} »</span>
              <span className="flex items-center gap-1.5 text-ui-xs font-medium text-texte-secondaire">
                <Icon name="chevron-right" size={14} className="text-icone-secondaire" />
                <RondApercu agentId={membre?.id ?? e.membre} nom={e.nom} teinte={membre?.teinte ?? teinte(e.membre)} taille={20} />
                {e.nom}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
