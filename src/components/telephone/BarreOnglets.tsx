"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { api } from "../../../convex/_generated/api";
import { cn } from "@/lib/cn";
import { useCompte } from "@/lib/compte";
import { nombreATraiter } from "@/lib/telephone/chats";
import { ongletDe } from "@/lib/telephone/retour";
import { nombreAValider } from "@/lib/telephone/tickets";
import { usePostes } from "./poste";

const ONGLETS: { href: string; label: string; icon: IconName }[] = [
  { href: "/chats", label: "Chats", icon: "message-square" },
  { href: "/planning", label: "Planning", icon: "calendar-01" },
  { href: "/equipe", label: "Agents", icon: "users-profiles-01" },
  { href: "/projets", label: "Projets", icon: "projets-dossier" },
  { href: "/plus", label: "Plus", icon: "dot-horizontal" },
];

/** L'onglet qui contient la page reste allumé sur ses pages poussées (socle § 2.1, C-4). */
const actif = (pathname: string, href: string): boolean => ongletDe(pathname) === href;

/** Remonter en douceur la liste de la page (300 ms ; d'un coup si « réduire les animations »). */
function remonter() {
  const zone = [...document.querySelectorAll<HTMLElement>("[data-contenu-telephone] *")].find((el) => el.scrollTop > 0 && el.scrollHeight > el.clientHeight);
  zone?.scrollTo({ top: 0, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
}

/**
 * Barre d'onglets (socle mobile § 2.1), cinq entrées. Cachée par la coque dans le fil, la visionneuse
 * et les pages pleines ; ailleurs, l'onglet qui contient la page reste allumé. Chats porte le compte
 * des conversations à traiter (bleu K1, la couleur « non lu » du bureau). L'onglet déjà actif remonte
 * sa liste en haut, ou revient à sa racine depuis une page poussée.
 * `vertical` : la tablette (spec mobile § 9), un rail de 64 px à gauche comme celui du bureau.
 */
export function BarreOnglets({ vertical = false }: { vertical?: boolean }) {
  const pathname = usePathname();
  const { etat } = useCompte();
  const conversations = useQuery(api.conversationsCompte.liste, etat === "connecte" ? {} : "skip");
  const attente = nombreATraiter(conversations ?? []);
  const { ouvert } = usePostes();
  /* Le point de Plus : des tickets confirmés à valider (E4-01). Inconnu ou zéro : rien. */
  const aValider = nombreAValider(conversations, ouvert) ?? 0;

  return (
    <nav
      aria-label="Navigation"
      className={
        vertical
          ? "my-2 ml-2 flex w-16 shrink-0 flex-col items-center overflow-y-auto rounded-xl bg-fond-inverse-fort pt-[calc(12px+env(safe-area-inset-top))] pb-[calc(12px+env(safe-area-inset-bottom))]"
          : "relative z-20 shrink-0 border-t border-bordure-subtile bg-fond-surface shadow-ombre-navbar pb-[env(safe-area-inset-bottom)]"
      }
    >
      {vertical ? <Image src="/brand/logo-icone.svg" alt="" width={36} height={36} className="mb-3 shrink-0" /> : null}
      <ul className={vertical ? "flex w-full flex-col items-center gap-1" : "flex h-14"}>
        {ONGLETS.map((onglet) => {
          const selectionne = actif(pathname, onglet.href);
          const compte = onglet.href === "/chats" && attente > 0 ? (attente > 9 ? "9+" : String(attente)) : null;
          return (
            <li key={onglet.href} className={vertical ? "w-14" : "min-w-16 flex-1"}>
              <Link
                href={onglet.href}
                aria-current={selectionne ? "page" : undefined}
                aria-label={compte ? `${onglet.label}, ${compte} à traiter` : onglet.href === "/plus" && aValider > 0 ? `${onglet.label}, ${aValider} à valider` : undefined}
                onClick={(e) => {
                  if (selectionne && pathname === onglet.href) {
                    e.preventDefault();
                    remonter();
                  }
                }}
                className={cn(
                  "group flex flex-col items-center justify-center",
                  !vertical && "h-14 gap-[3px] text-ui-xs",
                  !vertical && (selectionne ? "font-semibold text-texte-principal" : "font-medium text-texte-secondaire"),
                  vertical && "min-h-14 gap-0.5 rounded-md text-ui-xs transition-colors duration-[120ms] ease-sortie",
                  vertical && (selectionne ? "bg-white/14 text-texte-inverse" : "text-texte-inverse-secondaire active:bg-white/8"),
                )}
              >
                <span
                  className={cn(
                    "relative flex items-center justify-center",
                    !vertical && "h-[30px] w-14 rounded-md-moins transition-colors duration-[120ms] ease-sortie group-active:bg-fond-survol",
                    !vertical && (selectionne ? "bg-fond-surface-grise text-icone-defaut" : "text-icone-secondaire"),
                  )}
                >
                  <Icon name={onglet.icon} size={24} />
                  {compte ? (
                    <span
                      aria-hidden="true"
                      className={cn(
                        "absolute h-[18px] min-w-[18px] rounded-full px-[5px] text-center text-ui-xs leading-[18px] font-semibold",
                        vertical ? "-top-1 -right-2 bg-fond-surface text-texte-principal" : "-top-[3px] left-[34px] bg-fond-accent text-texte-inverse shadow-[0_0_0_2px_var(--color-fond-surface)]",
                      )}
                    >
                      {compte}
                    </span>
                  ) : null}
                  {onglet.href === "/plus" && aValider > 0 ? (
                    <span aria-hidden="true" className={cn("absolute size-2 rounded-full", vertical ? "-top-0.5 -right-1 bg-fond-surface" : "top-0 left-[38px] bg-fond-accent shadow-[0_0_0_2px_var(--color-fond-surface)]")} />
                  ) : null}
                </span>
                {onglet.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
