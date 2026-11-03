"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { Interrupteur } from "@/components/reglages/ui";
import { annoncer } from "@/lib/annonces";
import { cn } from "@/lib/cn";
import { libellePlanning } from "@/lib/routines-affichage";
import type { useRoutines } from "@/lib/routines";
import type { Role } from "@/types/domain";
import { EnteteVue, LIGNE_ACTIVE, Note } from "./elements";

/** Les routines de l'agent : allumées ou éteintes d'ici, créées et modifiées sur l'écran Routines. */
export function VueRoutines({ role, api, onRetour }: { role: Role; api: ReturnType<typeof useRoutines>; onRetour: () => void }) {
  const [erreur, setErreur] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const liste = api.routines.filter((r) => r.agentId === role.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const lien = (id?: string) => `/routines?vue=routines&agent=${encodeURIComponent(role.id)}${id ? `&routine=${encodeURIComponent(id)}` : ""}`;

  const basculer = async (id: string, active: boolean) => {
    setEnCours(id);
    setErreur(null);
    try {
      await api.modifier(id, { active });
      annoncer(active ? "Routine allumée." : "Routine éteinte.");
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <EnteteVue
        titre="Routines"
        onRetour={onRetour}
        action={
          <Link
            href={lien()}
            aria-label={`Nouvelle routine pour ${role.name}`}
            title={`Nouvelle routine pour ${role.name}`}
            className="flex size-8 items-center justify-center rounded-xs text-texte-principal transition-colors duration-[220ms] ease-sortie hover:bg-fond-survol"
          >
            <Icon name="plus-01" size={18} />
          </Link>
        }
      />
      {!api.charge && <Note>Lecture des routines…</Note>}
      {api.charge && api.erreur && <Note erreur>{api.erreur}</Note>}
      {api.charge && !api.erreur && !liste.length && (
        <Note>
          {role.name} n’a pas encore de routine : une consigne qu’il suit seul, à l’heure dite (le point du lundi, la revue des mails…).{" "}
          <Link href={lien()} className="text-texte-principal underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
            En créer une
          </Link>
        </Note>
      )}
      {liste.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {liste.map((r) => (
            <li key={r.id} className="flex items-center gap-1 rounded-md border border-bordure-subtile bg-fond-surface p-1 pr-3">
              <Link href={lien(r.id)} className={cn("flex min-w-0 flex-1 items-center gap-2.5 rounded-sm px-2.5 py-2 text-texte-principal", LIGNE_ACTIVE)}>
                <Icon name="clock-01" size={16} className={cn("shrink-0", r.active ? "text-icone-accent" : "text-icone-secondaire")} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate text-ui-s font-medium">{r.name || "Sans titre"}</span>
                  <span className="truncate text-ui-xs text-texte-tertiaire">{r.blockedReason ? "Bloquée : à revoir sur l’écran Routines" : libellePlanning(r.schedule)}</span>
                </span>
              </Link>
              <Interrupteur actif={r.active} libelle={`${r.active ? "Éteindre" : "Allumer"} « ${r.name || "Sans titre"} »`} disabled={enCours === r.id || !!r.blockedReason} onChange={(active) => void basculer(r.id, active)} />
            </li>
          ))}
        </ul>
      )}
      {erreur && <Note erreur>{erreur}</Note>}
    </div>
  );
}
