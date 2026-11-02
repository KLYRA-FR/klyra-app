import Link from "next/link";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { boutonVariants } from "@/components/ui/Bouton";
import { Icon, type IconName } from "@/components/icons/Icon";
import { ApercuApp } from "../components/ApercuApp";
import { AppelFinal } from "../components/AppelFinal";
import { EnTete } from "../components/EnTete";
import { PiedDePage } from "../components/PiedDePage";
import { Revelation } from "../components/Revelation";
import { Texte } from "../components/Texte";
import { ANNONCE, LIBELLES_GROUPES, LIEN_TELECHARGER, ORDRE_GROUPES, VERSIONS } from "../data/changelog";
import { ancre, dateLongue } from "../lib/changelog";

const FONCTIONNALITES: { icone: IconName; titre: string; texte: string }[] = [
  {
    icone: "message-square",
    titre: "Des agents qui répondent en direct",
    texte: "Écris à ton assistant ou mentionne un agent avec @. Tu vois ses étapes, tu l’arrêtes quand tu veux, et il demande avant d’agir.",
  },
  {
    icone: "layers-01",
    titre: "Des tickets tenus par les agents",
    texte: "Chaque tâche confiée devient un ticket qui avance seul : à faire, en cours, bloqué, à valider. Tu n’as plus qu’à valider.",
  },
  {
    icone: "projets-dossier",
    titre: "Tes projets, tes fichiers",
    texte: "Ouvre un dossier, parcours ton code comme dans un éditeur et laisse les agents y travailler. Rien n’est déplacé ni copié.",
  },
  {
    icone: "clock-01",
    titre: "Des routines planifiées",
    texte: "Une consigne, un agent, un horaire : le point du lundi, la veille du matin, les relances. Avec l’historique de chaque exécution.",
  },
  {
    icone: "computer",
    titre: "Sur ton poste ou sur ton VPS",
    texte: "Relie un serveur en une commande. Tes agents et tes routines y tournent même quand ton ordinateur est éteint.",
  },
  {
    icone: "calendar-01",
    titre: "Planning et rappels d’équipe",
    texte: "Un calendrier commun, des rappels à assigner et à reporter en un clic, et « Ma journée » dès l’ouverture.",
  },
];

const GARANTIES: { icone: IconName; titre: string; texte: string }[] = [
  { icone: "shield-check", titre: "Tes fichiers restent chez toi", texte: "Les agents travaillent dans tes dossiers, sur ta machine ou sur ton serveur." },
  { icone: "lock-01", titre: "Tes clés sont chiffrées", texte: "Par le trousseau du système. Elles ne reviennent jamais à l’écran." },
  { icone: "refresh-01", titre: "Toujours à jour", texte: "Chaque version est vérifiée, puis installée quand tu quittes l’app." },
];

export default function Accueil() {
  const recentes = VERSIONS.slice(0, 3);
  return (
    <>
      <EnTete />
      <main>
        {/* ─── Hero ─────────────────────────────────────────────────── */}
        <section className="klyra-site-conteneur pt-[clamp(48px,8vw,104px)] text-center">
          <Link
            href={`/changelog/#${ancre(ANNONCE.version)}`}
            className="inline-flex items-center gap-2 rounded-pill border border-bordure-defaut bg-fond-surface py-1 pr-3 pl-1 text-ui-s text-texte-secondaire no-underline shadow-ombre-xs transition-colors duration-[220ms] hover:border-bordure-forte"
          >
            <span className="rounded-pill bg-fond-teinte-bleue px-2 py-0.5 text-ui-xs font-medium text-texte-accent">{ANNONCE.version}</span>
            {ANNONCE.texte}
            <Icon name="chevron-right" size={16} />
          </Link>
          <h1 className="mx-auto mt-6 max-w-[14ch] text-[clamp(44px,7.4vw,92px)] leading-[0.95] font-semibold tracking-[-0.05em] text-balance">
            Ton équipe d’agents, <span className="klyra-site-titre-degrade">au même endroit</span>
          </h1>
          <p className="mx-auto mt-6 max-w-[52ch] text-[clamp(16px,1.6vw,20px)] leading-[1.5] text-texte-secondaire text-pretty">
            KLYRA réunit tes conversations avec les agents, tes projets, tes tickets et tes routines dans une app de bureau.
            Les agents travaillent sur ton poste ou sur ton serveur, et te suivent sur ton téléphone.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <BoutonPrincipal href={LIEN_TELECHARGER}>Télécharger KLYRA</BoutonPrincipal>
            <Link href="/changelog/" className={boutonVariants({ variant: "blanc", taille: "md" })}>
              Voir les nouveautés
            </Link>
          </div>
          <p className="mt-4 text-ui-s text-texte-tertiaire">Mac et Windows · sur invitation de ton équipe</p>

          <div className="relative mx-auto mt-[clamp(48px,6vw,80px)] max-w-[1080px]">
            <div className="klyra-site-points-bleus absolute -inset-x-4 -top-10 bottom-1/3 -z-10 lg:-inset-x-10" aria-hidden />
            <ApercuApp />
          </div>
        </section>

        {/* ─── Fonctionnalités ─────────────────────────────────────── */}
        <section id="fonctionnalites" className="klyra-site-conteneur pt-[clamp(80px,10vw,140px)]">
          <Revelation className="max-w-[640px]">
            <p className="text-ui-xs font-semibold tracking-[0.1em] text-texte-accent uppercase">Fonctionnalités</p>
            <h2 className="mt-3 text-[clamp(32px,4.2vw,48px)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
              Tout ce que ton équipe confie aux agents, au même endroit
            </h2>
          </Revelation>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FONCTIONNALITES.map((f, i) => (
              <Revelation key={f.titre} style={{ animationDelay: `${(i % 3) * 80}ms` }}>
                <article className="h-full rounded-xl border border-bordure-subtile bg-fond-surface p-6 shadow-ombre-xs transition-[box-shadow,transform] duration-[220ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-levee">
                  <span className="klyra-site-orbe flex size-10 items-center justify-center rounded-full">
                    <Icon name={f.icone} size={20} />
                  </span>
                  <h3 className="mt-5 text-[19px] leading-[1.2] font-semibold tracking-[-0.025em]">{f.titre}</h3>
                  <p className="mt-2 text-body-s leading-[1.55] text-texte-secondaire">{f.texte}</p>
                </article>
              </Revelation>
            ))}
          </div>
        </section>

        {/* ─── Ce qui reste chez toi ───────────────────────────────── */}
        <section className="klyra-site-conteneur pt-[clamp(64px,8vw,112px)]">
          <Revelation className="grid gap-8 rounded-2xl bg-fond-surface-grise p-[clamp(24px,4vw,48px)] md:grid-cols-3">
            {GARANTIES.map((g) => (
              <div key={g.titre} className="flex gap-4">
                <span className="mt-0.5 text-icone-accent">
                  <Icon name={g.icone} size={24} />
                </span>
                <div>
                  <h3 className="text-body-s font-semibold">{g.titre}</h3>
                  <p className="mt-1 text-ui leading-[1.5] text-texte-secondaire">{g.texte}</p>
                </div>
              </div>
            ))}
          </Revelation>
        </section>

        {/* ─── Nouveautés ──────────────────────────────────────────── */}
        <section className="klyra-site-conteneur pt-[clamp(80px,10vw,140px)]">
          <Revelation className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-[640px]">
              <p className="text-ui-xs font-semibold tracking-[0.1em] text-texte-accent uppercase">Changelog</p>
              <h2 className="mt-3 text-[clamp(32px,4.2vw,48px)] leading-[1.02] font-semibold tracking-[-0.045em] text-balance">
                Une nouvelle version presque chaque jour
              </h2>
            </div>
            <Link href="/changelog/" className={boutonVariants({ variant: "blanc", taille: "compact" })}>
              Toutes les nouveautés
              <Icon name="chevron-right" size={16} />
            </Link>
          </Revelation>
          <div className="mt-10 grid gap-4 lg:grid-cols-3">
            {recentes.map((v) => {
              const type = ORDRE_GROUPES.find((t) => v.groupes[t]?.length);
              const premier = type ? v.groupes[type]?.[0] : v.intro;
              return (
                <Revelation key={v.version}>
                  <Link
                    href={`/changelog/#${ancre(v.version)}`}
                    className="flex h-full flex-col rounded-xl border border-bordure-subtile bg-fond-surface p-6 text-texte-principal no-underline shadow-ombre-xs transition-[box-shadow,transform] duration-[220ms] ease-sortie hover:-translate-y-0.5 hover:shadow-ombre-levee"
                  >
                    <span className="flex items-center gap-2 text-ui-s text-texte-tertiaire">
                      <span className="font-medium text-texte-principal tabular-nums">KLYRA {v.version}</span>· {dateLongue(v.publiee)}
                    </span>
                    {type && <span className="mt-4 text-ui-xs font-semibold tracking-[0.08em] text-texte-accent uppercase">{LIBELLES_GROUPES[type]}</span>}
                    {premier && (
                      <p className="mt-2 line-clamp-4 text-body-s leading-[1.55] text-texte-secondaire">
                        <Texte>{premier}</Texte>
                      </p>
                    )}
                  </Link>
                </Revelation>
              );
            })}
          </div>
        </section>

        {/* ─── Appel final ─────────────────────────────────────────── */}
        <section className="klyra-site-conteneur py-[clamp(80px,10vw,140px)]">
          <Revelation>
            <AppelFinal
              titre="Prêt à travailler avec ton équipe d’agents ?"
              texte="Installe KLYRA sur ton Mac ou ton PC, connecte ton compte Claude et écris à ton assistant."
            >
              <a href={LIEN_TELECHARGER} className={boutonVariants({ variant: "sombre", taille: "md" })}>
                <Icon name="download-02" size={20} />
                Télécharger KLYRA
              </a>
              <Link href="/changelog/" className={boutonVariants({ variant: "blanc", taille: "md" })}>
                Voir les nouveautés
              </Link>
            </AppelFinal>
          </Revelation>
        </section>
      </main>
      <PiedDePage />
    </>
  );
}
