"use client";

import Link from "next/link";
import { Avatar } from "klyra-ui";
import { cn } from "@/lib/cn";
import { nomAbonnement, useCompteClaude } from "@/lib/compte-claude";
import { useWorkspace } from "@/lib/workspace";

/** L'état de Claude en quelques mots, et la couleur de son point. */
function useEtatClaude() {
  const { disponible, compte, action } = useCompteClaude();
  if (!disponible) return { texte: "Claude : app de bureau", ok: null };
  if (action === "connexion") return { texte: "Connexion à Claude…", ok: null };
  if (!compte) return { texte: "Vérification de Claude…", ok: null };
  if (!compte.installe) return { texte: "Claude Code introuvable", ok: false };
  if (!compte.connecte) return { texte: "Claude non connecté", ok: false };
  const abonnement = nomAbonnement(compte.abonnement);
  return { texte: abonnement ? `Claude ${abonnement} · connecté` : "Claude connecté", ok: true };
}

/** Point d'état : K1 connecté, rouge à reconnecter, gris en attente. */
function Point({ ok, className }: { ok: boolean | null; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        ok === true ? "bg-bleu-k1-500" : ok === false ? "bg-bordure-erreur" : "bg-gris-k1-100",
        className,
      )}
    />
  );
}

/** Dans le rail : ton avatar, avec le point d'état de Claude. */
export function CarteCompteRail() {
  const { state } = useWorkspace();
  const { texte, ok } = useEtatClaude();
  return (
    <Link href="/reglages" aria-label={`${state.currentUser.name} · ${texte}`} title={texte} className="relative flex rounded-full">
      <Avatar shape="circle" size="md" src={state.currentUser.photo ?? undefined} initials={state.currentUser.initial} alt="" gradient={false} />
      <Point ok={ok} className="absolute -right-0.5 -bottom-0.5 size-2.5 border-2 border-fond-inverse-fort" />
    </Link>
  );
}
