import Image from "next/image";
import Link from "next/link";
import logotype from "../../public/brand/logotype-generic.svg";
import { boutonVariants } from "@/components/ui/Bouton";
import { Icon } from "@/components/icons/Icon";
import { LIEN_TELECHARGER } from "../data/changelog";

const LIENS = [
  { href: "/#fonctionnalites", libelle: "Fonctionnalités" },
  { href: "/changelog/", libelle: "Changelog" },
];

/** Barre du haut du site : logo, navigation, Télécharger. */
export function EnTete({ actif }: { actif?: "changelog" }) {
  return (
    <header className="sticky top-0 z-20 border-b border-bordure-subtile bg-fond-page/85 backdrop-blur-md">
      <div className="klyra-site-conteneur flex h-16 items-center gap-4 sm:gap-6">
        <Link href="/" aria-label="KLYRA, accueil" className="shrink-0 rounded-xs">
          {/* Générique jamais sous 125 px de large. */}
          <Image src={logotype} alt="" width={125} height={34} priority />
        </Link>
        <nav aria-label="Navigation principale" className="hidden items-center gap-1 sm:flex">
          {LIENS.map((lien) => {
            const courant = actif === "changelog" && lien.href === "/changelog/";
            return (
              <Link
                key={lien.href}
                href={lien.href}
                aria-current={courant ? "page" : undefined}
                className="rounded-sm px-3 py-1.5 text-ui text-texte-secondaire no-underline transition-colors duration-[220ms] hover:bg-fond-survol hover:text-texte-principal aria-[current=page]:text-texte-principal"
              >
                {lien.libelle}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/changelog/" className="rounded-sm px-3 py-1.5 text-ui text-texte-secondaire no-underline hover:text-texte-principal sm:hidden">
            Changelog
          </Link>
          <a href={LIEN_TELECHARGER} aria-label="Télécharger KLYRA" className={boutonVariants({ variant: "sombre", taille: "compact" })}>
            <Icon name="download-02" size={16} />
            {/* Sur téléphone, l’icône seule : le logo et Changelog gardent leur place. */}
            <span className="hidden min-[420px]:inline">Télécharger</span>
          </a>
        </div>
      </div>
    </header>
  );
}
