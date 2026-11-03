import Image from "next/image";
import Link from "next/link";
import signe from "../../public/brand/logo-signe.svg";
import { DEPOT_VERSIONS, LIEN_TELECHARGER } from "../data/changelog";

/** Pied de page du site. */
export function PiedDePage() {
  return (
    <footer className="border-t border-bordure-defaut">
      <div className="klyra-site-conteneur flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Image src={signe} alt="KLYRA" width={28} height={28} />
          <p className="text-ui-s text-texte-tertiaire">© 2026 KLYRA · L’app de bureau du studio</p>
        </div>
        <nav aria-label="Liens du pied de page" className="flex flex-wrap gap-x-5 gap-y-2 text-ui-s">
          <Link href="/changelog/" className="text-texte-secondaire no-underline hover:text-texte-principal">
            Changelog
          </Link>
          <a href={LIEN_TELECHARGER} className="text-texte-secondaire no-underline hover:text-texte-principal">
            Télécharger
          </a>
          <a href={`${DEPOT_VERSIONS}/releases`} className="text-texte-secondaire no-underline hover:text-texte-principal">
            Toutes les versions
          </a>
          <a href="https://klyra.fr" className="text-texte-secondaire no-underline hover:text-texte-principal">
            klyra.fr
          </a>
        </nav>
      </div>
    </footer>
  );
}
