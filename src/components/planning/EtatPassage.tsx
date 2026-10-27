"use client";

import { Icon } from "@/components/icons/Icon";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { aujourdhui, cleJour, depuisCle } from "@/lib/dates";
import type { ExecutionRoutine, Message } from "@/types/domain";

/* Ce que le calendrier et le canevas des routines partagent : l'état d'un
   passage, sa marque, et « Hier à 13:01 ». */

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtJourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });

/** Où en est un passage : pas encore parti, en file, en cours, fini, en erreur. */
export type Etat = "a-venir" | "en-file" | "en-cours" | "fait" | "erreur";

export const LIBELLES_ETAT: Record<Etat, string> = {
  "a-venir": "À venir",
  "en-file": "En file d’attente",
  "en-cours": "En cours",
  fait: "Fait",
  erreur: "Erreur",
};

/** « Aujourd’hui à 09:00 », « Hier à 13:01 », « Demain à 09:00 », « lun. 20 oct. à 09:00 ». */
export function quand(d: Date): string {
  const ecart = Math.round((depuisCle(cleJour(d)).getTime() - depuisCle(aujourdhui()).getTime()) / 86_400_000);
  const jour = ecart === 0 ? "Aujourd’hui" : ecart === -1 ? "Hier" : ecart === 1 ? "Demain" : fmtJourCourt.format(d);
  return `${jour} à ${fmtHeure.format(d)}`;
}

/** L'état d'un passage parti : la première réponse de l'agent après son départ. */
export function etatPassage(messages: Message[], h: ExecutionRoutine): Etat {
  /* Une chaîne : en erreur dès qu'un agent l'est, finie quand tous ont fini. */
  if (h.etapes?.length) {
    if (h.etapes.some((e) => e.statut === "erreur")) return "erreur";
    if (h.etapes.some((e) => e.statut === "en-cours")) return "en-cours";
    return "fait";
  }
  const reponse = messages.find((m) => m.author.kind === "role" && m.createdAt >= h.at);
  if (!reponse) return "en-file";
  if (reponse.statut === "en-cours") return "en-cours";
  if (reponse.statut === "erreur") return "erreur";
  return "fait";
}

/** La marque d'un passage : un rond vide à venir, un arc qui tourne, la coche KLYRA, un point d'erreur. */
export function MarqueEtat({ etat }: { etat: Etat }) {
  return (
    <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
      {etat === "fait" && <PixelCheck className="h-[9px] w-3" />}
      {etat === "en-cours" && <Icon name="loader-01" size={14} className="text-icone-accent motion-safe:animate-spin" />}
      {etat === "erreur" && <span className="size-2 rounded-full bg-texte-erreur" />}
      {etat === "en-file" && <span className="size-2.5 rounded-full border-[1.5px] border-dashed border-texte-tertiaire" />}
      {etat === "a-venir" && <span className="size-2.5 rounded-full border-[1.5px] border-bordure-forte" />}
    </span>
  );
}
