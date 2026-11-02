"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { LignesCompte } from "@/components/planning/RappelsCompte";
import { LigneRappel, trierRappels } from "@/components/planning/Rappels";
import { useCompte } from "@/lib/compte";
import { useWorkspace } from "@/lib/workspace";
import type { Tache } from "@/types/domain";
import { api } from "../../../convex/_generated/api";

/** Les rappels de ce poste, avec la couleur de leur catégorie (la première si elle n'existe plus). */
function LignesLocales({ taches }: { taches: Tache[] }) {
  const { state } = useWorkspace();
  const teinte = (t: Tache) => (state.categories.find((c) => c.id === t.liste) ?? state.categories[0])?.teinte ?? "violet";
  return (
    <>
      {trierRappels(taches).map((t) => (
        <LigneRappel key={t.id} tache={t} teinte={teinte(t)} />
      ))}
    </>
  );
}

/** Connecté : les rappels du compte qui te sont assignés, puis ceux de ce poste pas encore importés. */
function RappelsDuCompte({ moiId }: { moiId: NonNullable<ReturnType<typeof useCompte>["moi"]>["_id"] }) {
  const { state } = useWorkspace();
  const mes = useQuery(api.rappels.mes, {});
  if (mes === undefined) return <li className="py-2 text-ui-xs text-texte-tertiaire">Chargement…</li>;
  const importes = new Set(mes.flatMap((r) => (r.origineLocale ? [r.origineLocale] : [])));
  const aMoi = mes
    .filter((r) => r.assigneA === moiId && r.statut !== "fait")
    .sort((a, b) => (a.echeance ?? Infinity) - (b.echeance ?? Infinity));
  const locales = state.taches.filter((t) => !t.faite && !importes.has(t.id));
  if (!aMoi.length && !locales.length) return <Vide />;
  return (
    <>
      <LignesCompte rappels={aMoi} moiId={moiId} categories={state.categories} voirFaits={false} />
      <LignesLocales taches={locales} />
    </>
  );
}

function Vide() {
  return <li className="py-2 text-ui-xs leading-[1.45] text-texte-tertiaire">Aucun rappel à faire.</li>;
}

/**
 * La colonne « À moi » : tes rappels non faits, depuis la même source que
 * Planning › Rappels (ce poste, ou le compte quand tu es connecté). Les lignes
 * sont celles des rappels : on coche, on reporte, on règle la date au même endroit.
 */
export function AMoi() {
  const { state } = useWorkspace();
  const compte = useCompte();
  const connecte = compte.etat === "connecte" && compte.moi !== null;
  const locales = state.taches.filter((t) => !t.faite);
  return (
    <ul className="m-0 flex list-none flex-col p-0">
      {connecte && compte.moi ? <RappelsDuCompte moiId={compte.moi._id} /> : locales.length ? <LignesLocales taches={locales} /> : <Vide />}
      <li className="pt-2">
        <Link href="/planning" className="text-ui-xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-principal">
          Ajouter un rappel dans le Planning
        </Link>
      </li>
    </ul>
  );
}
