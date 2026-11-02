"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { LIBELLES_GROUPES, ORDRE_GROUPES, type Version } from "../data/changelog";
import { ancre, dateCourte, dateIso, dateLongue, parMois } from "../lib/changelog";
import { Texte } from "./Texte";

type App = "bureau" | "mobile";

/** L’adresse ne change que par `choisir`, qui pose aussi l’état : rien à écouter. */
const ecouterRien = () => () => {};

const APPS: { id: App; libelle: string }[] = [
  { id: "bureau", libelle: "Bureau" },
  { id: "mobile", libelle: "Mobile" },
];

/**
 * Sommaire et versions du changelog. Le sommaire suit la lecture : la version
 * en haut de l’écran y est marquée et reste visible dans sa liste. Les versions
 * apparaissent en fondu à leur arrivée à l’écran.
 */
export function Changelog({ versions }: { versions: Version[] }) {
  // L’app choisie vit dans l’adresse (`?plateforme=mobile`), comme sur OpenBot ; un clic la remplace.
  const mobileDansAdresse = useSyncExternalStore(
    ecouterRien,
    () => new URLSearchParams(window.location.search).get("plateforme") === "mobile",
    () => false,
  );
  const [choix, setChoix] = useState<App | null>(null);
  const app: App = choix ?? (mobileDansAdresse ? "mobile" : "bureau");
  const [actif, setActif] = useState(() => ancre(versions[0]?.version ?? ""));
  const versionsRef = useRef<HTMLDivElement>(null);
  const defileRef = useRef<HTMLDivElement>(null);
  const mois = parMois(versions);

  function choisir(id: App) {
    setChoix(id);
    const url = new URL(window.location.href);
    if (id === "mobile") url.searchParams.set("plateforme", "mobile");
    else url.searchParams.delete("plateforme");
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  // Apparition des versions, une fois chacune.
  useEffect(() => {
    const conteneur = versionsRef.current;
    if (!conteneur || app !== "bureau") return;
    const observateur = new IntersectionObserver(
      (entrees) => {
        for (const entree of entrees) {
          if (!entree.isIntersecting) continue;
          (entree.target as HTMLElement).dataset.revealed = "true";
          observateur.unobserve(entree.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    conteneur.querySelectorAll<HTMLElement>("article[data-revealed='false']").forEach((article) => observateur.observe(article));
    return () => observateur.disconnect();
  }, [app]);

  // Version en cours de lecture : la dernière dont le haut est passé sous l’en-tête.
  useEffect(() => {
    const conteneur = versionsRef.current;
    if (!conteneur || app !== "bureau") return;
    let image = 0;
    const calculer = () => {
      image = 0;
      const decalage = parseFloat(getComputedStyle(conteneur).getPropertyValue("--cl-decalage")) || 88;
      const articles = conteneur.querySelectorAll<HTMLElement>("article");
      let courant = articles[0]?.id ?? "";
      for (const article of articles) {
        if (article.getBoundingClientRect().top - decalage - 24 <= 0) courant = article.id;
        else break;
      }
      // Au bas de la page, la dernière version est celle qu’on lit.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
        courant = articles[articles.length - 1]?.id ?? courant;
      }
      setActif(courant);
    };
    const demander = () => {
      if (!image) image = requestAnimationFrame(calculer);
    };
    calculer();
    window.addEventListener("scroll", demander, { passive: true });
    window.addEventListener("resize", demander);
    return () => {
      window.removeEventListener("scroll", demander);
      window.removeEventListener("resize", demander);
      cancelAnimationFrame(image);
    };
  }, [app]);

  // Le lien actif reste visible dans le sommaire, sans faire défiler la page.
  useEffect(() => {
    const defile = defileRef.current;
    const lien = defile?.querySelector<HTMLElement>(`a[href="#${actif}"]`);
    if (!defile || !lien) return;
    const boite = defile.getBoundingClientRect();
    const cible = lien.getBoundingClientRect();
    const horizontal = defile.scrollWidth > defile.clientWidth + 1;
    if (horizontal) {
      if (cible.left < boite.left + 16 || cible.right > boite.right - 32) {
        defile.scrollTo({ left: defile.scrollLeft + cible.left - boite.left - boite.width / 2 + cible.width / 2, behavior: "smooth" });
      }
    } else if (cible.top < boite.top + 12 || cible.bottom > boite.bottom - 32) {
      defile.scrollTo({ top: defile.scrollTop + cible.top - boite.top - boite.height / 3, behavior: "smooth" });
    }
  }, [actif]);

  return (
    <div className="klyra-cl-grille">
      <div className="klyra-cl-sommaire">
        <div className="klyra-cl-apps">
          <div role="tablist" aria-label="Apps" className="klyra-cl-apps-rail">
            {APPS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                aria-selected={app === a.id}
                aria-controls={`changelog-${a.id}`}
                className="klyra-cl-app"
                onClick={() => choisir(a.id)}
              >
                {a.libelle}
              </button>
            ))}
          </div>
        </div>
        {app === "bureau" && (
          <nav aria-label="Versions de l’app de bureau">
            <p className="klyra-cl-sommaire-titre">
              Versions <span className="klyra-cl-sommaire-nombre">{versions.length}</span>
            </p>
            <div ref={defileRef} className="klyra-cl-sommaire-defile">
              {mois.map((groupe) => (
                <div key={groupe.mois} className="klyra-cl-bloc-mois">
                  <p className="klyra-cl-mois">{groupe.mois}</p>
                  <ul className="klyra-cl-liste-versions">
                    {groupe.versions.map((v) => {
                      const id = ancre(v.version);
                      return (
                        <li key={v.version}>
                          <a className="klyra-cl-lien" href={`#${id}`} aria-current={actif === id ? "true" : undefined}>
                            <span className="klyra-cl-lien-version">{v.version}</span>
                            <time className="klyra-cl-lien-date" dateTime={dateIso(v.publiee)}>
                              {dateCourte(v.publiee)}
                            </time>
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          </nav>
        )}
      </div>

      {app === "bureau" ? (
        <div ref={versionsRef} id="changelog-bureau" role="tabpanel" className="klyra-cl-versions">
          {versions.map((v, rang) => {
            const id = ancre(v.version);
            return (
              <article key={v.version} id={id} className="klyra-cl-version" aria-labelledby={`${id}-titre`} data-revealed="false">
                <header>
                  <div className="klyra-cl-version-meta">
                    <time dateTime={dateIso(v.publiee)}>{dateLongue(v.publiee)}</time>
                    {rang === 0 && <span className="klyra-cl-badge">Dernière</span>}
                  </div>
                  <h2 className="klyra-cl-version-titre" id={`${id}-titre`}>
                    <a className="klyra-cl-ancre" href={`#${id}`}>
                      KLYRA <span className="klyra-cl-numero">{v.version}</span>
                    </a>
                  </h2>
                  {v.intro && (
                    <p className="klyra-cl-intro">
                      <Texte>{v.intro}</Texte>
                    </p>
                  )}
                </header>
                {ORDRE_GROUPES.map((type) => {
                  const items = v.groupes[type];
                  if (!items?.length) return null;
                  return (
                    <section key={type} className="klyra-cl-groupe" data-type={type}>
                      <h3 className="klyra-cl-groupe-titre">
                        <span className="klyra-cl-groupe-point" aria-hidden />
                        {LIBELLES_GROUPES[type]}
                        <span className="klyra-cl-groupe-nombre" aria-hidden>
                          {items.length}
                        </span>
                      </h3>
                      <ul className="klyra-cl-liste">
                        {items.map((item) => (
                          <li key={item} className="klyra-cl-item">
                            <Texte>{item}</Texte>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </article>
            );
          })}
        </div>
      ) : (
        <div id="changelog-mobile" role="tabpanel" className="klyra-cl-versions">
          <p className="klyra-cl-vide">
            L’app mobile n’a pas encore de version publiée. Elle arrive bientôt : tes conversations, tes tickets et ton
            planning, sur ton téléphone.
          </p>
        </div>
      )}
    </div>
  );
}
