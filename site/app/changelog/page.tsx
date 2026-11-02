import type { Metadata } from "next";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { boutonVariants } from "@/components/ui/Bouton";
import { Icon } from "@/components/icons/Icon";
import { AppelFinal } from "../../components/AppelFinal";
import { Changelog } from "../../components/Changelog";
import { EnTete } from "../../components/EnTete";
import { PiedDePage } from "../../components/PiedDePage";
import { Revelation } from "../../components/Revelation";
import { DEPOT_VERSIONS, LIEN_TELECHARGER, VERSIONS } from "../../data/changelog";
import { ancre, dateLongue } from "../../lib/changelog";

export const metadata: Metadata = {
  title: "Changelog",
  description: "Toutes les versions de l’app de bureau KLYRA, la plus récente d’abord, avec ce qui change pour toi.",
};

export default function PageChangelog() {
  const derniere = VERSIONS[0];
  return (
    <div className="klyra-cl">
      <EnTete actif="changelog" />
      <noscript>
        <style>{`[data-revealed="false"]{opacity:1!important}`}</style>
      </noscript>
      <main className="pb-[clamp(50px,6.3vw,84px)]">
        <div className="klyra-site-conteneur">
          <section className="klyra-cl-hero" aria-labelledby="changelog-titre">
            <div className="klyra-cl-hero-art" aria-hidden>
              <div className="klyra-site-points absolute inset-0" />
            </div>
            <div className="klyra-cl-hero-copie">
              <p className="klyra-cl-surtitre">Changelog</p>
              <h1 className="klyra-cl-titre" id="changelog-titre">
                Les nouveautés de KLYRA
              </h1>
              <p className="klyra-cl-chapo">
                De nouveaux agents, de nouvelles façons de travailler en équipe, et les correctifs qui rendent chaque
                version plus fiable. Toutes les versions sont ici, la plus récente d’abord. L’app se met à jour toute
                seule.
              </p>
            </div>
          </section>

          <div className="klyra-cl-derniere">
            <p className="klyra-cl-derniere-texte">
              <span className="klyra-cl-point" aria-hidden />
              Dernière version
              <a className="klyra-cl-derniere-version" href={`#${ancre(derniere.version)}`}>
                {derniere.version}
              </a>
              <span className="klyra-cl-derniere-date">· {dateLongue(derniere.publiee)}</span>
            </p>
            <a href={LIEN_TELECHARGER} className={boutonVariants({ variant: "blanc", taille: "compact" })}>
              <Icon name="download-02" size={16} />
              Télécharger
            </a>
          </div>

          <Changelog versions={VERSIONS} />

          <Revelation className="mt-[clamp(56px,7vw,96px)]">
            <AppelFinal
              titre="Toujours la dernière version, sans y penser"
              texte="KLYRA vérifie les nouvelles versions au démarrage puis toutes les heures, et s’installe quand tu la quittes."
            >
              <BoutonPrincipal href={LIEN_TELECHARGER}>Télécharger KLYRA</BoutonPrincipal>
              <a href={`${DEPOT_VERSIONS}/releases`} className={boutonVariants({ variant: "blanc", taille: "md" })}>
                Toutes les versions
              </a>
            </AppelFinal>
          </Revelation>
        </div>
      </main>
      <PiedDePage />
    </div>
  );
}
