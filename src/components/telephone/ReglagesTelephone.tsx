"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { chercher, estSection, SECTIONS, type IdSection } from "@/components/reglages/catalogue";
import { Equipe } from "@/components/reglages/sections/Equipe";
import { CHANGELOG } from "@/components/reglages/sections/MisesAJour";
import { ancreReglage } from "@/components/reglages/ui";
import { RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { NIVEAUX_ACCES } from "@/lib/acces";
import type { AutorisationsComputerUse, CompteClaude, EtatAutorisation, EtatMaj, PreferencesNotifications, Utilisation } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useCompte, useMonIdentite } from "@/lib/compte";
import { nomAbonnement } from "@/lib/compte-claude";
import { compact } from "@/lib/consommation";
import { useServeursRelies, useSondes } from "@/lib/lieux";
import { useLecturePoste } from "@/lib/poste/client";
import { cheminTelephone, texteFeuille, type PosteLu } from "@/lib/poste-texte";
import { libelleServeur } from "@/lib/serveur-vps";
import { ID_ASSISTANT, MODELES_FICHE, teinteSure } from "@/lib/telephone/agents";
import type { AgentsReglages, ResumeConsommation } from "@/lib/telephone/gestes-reglages";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { accesPermis, etatLigne, sectionsTelephone, titreSection } from "@/lib/telephone/reglages";
import paquet from "../../../package.json";
import { CHAMP_TELEPHONE, ChampTelephone, ErreurGeste, TitreGroupe } from "./CommunAgentsTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { FeuillePersonnaliser } from "./FicheAgentTelephone";
import { NotePoste, SurLePoste, VueLecture } from "./etats";
import { NotificationsTelephone } from "./NotificationsTelephone";
import { usePostes, useSupport } from "./poste";

/**
 * Réglages sur le téléphone (spec mobile T-22) : `/reglages` liste les sections (« Ce téléphone »
 * en tête) avec la recherche du bureau ; `/reglages?section=…` ouvre une section, `&reglage=…`
 * mène à une ligne. Chaque ligne suit son état (`etatLigne`) : en ligne, sur l'ordinateur ouvert
 * (P-6, P-7 fermé), ou « Sur ton Mac » avec sa raison (P-8).
 */

const DEPOT = "https://github.com/KLYRA-FR/klyra-app-versions/releases";
const dateHeure = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const ferme = (sur: string) => `ces réglages sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`;

const DESCRIPTION_TELEPHONE = "Ses notifications et ses sons, les ordinateurs de ton compte, sa déconnexion.";

export function ReglagesTelephone() {
  const params = useSearchParams();
  const section = params.get("section");
  if (estSection(section)) return <PageSection key={section} id={section} reglage={params.get("reglage")} />;
  return <ListeReglages />;
}

/** La liste des sections, et la recherche des réglages en haut. */
function ListeReglages() {
  const router = useRouter();
  const [requete, setRequete] = useState("");
  const resultats = useMemo(() => chercher(requete), [requete]);
  const ligne = (href: string, icone: (typeof SECTIONS)[number]["icone"], titre: string, detail: string) => (
    <li key={href} className="border-b border-bordure-subtile">
      <Link href={href} className="flex min-h-14 items-center gap-3 py-2 active:bg-fond-survol">
        <Icon name={icone} size={24} className="shrink-0 text-icone-secondaire" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-s text-texte-principal">{titre}</span>
          <span className="line-clamp-2 text-ui-xs text-texte-secondaire">{detail}</span>
        </span>
        <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" />
      </Link>
    </li>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Réglages" retour={() => router.push("/plus")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <Input
          size="lg"
          type="search"
          value={requete}
          placeholder="Rechercher dans les réglages…"
          aria-label="Rechercher dans les réglages"
          onChange={(e) => setRequete(e.target.value)}
          className={CHAMP_TELEPHONE}
        />
        <ul className="mt-2" aria-label={requete ? "Résultats de la recherche" : "Sections des réglages"}>
          {requete
            ? resultats.map((r) =>
                ligne(
                  `/reglages?section=${r.section.id}${r.entree ? `&reglage=${r.entree.id}` : ""}`,
                  r.section.icone,
                  r.entree?.titre ?? titreSection(r.section.id),
                  r.entree ? titreSection(r.section.id) : r.section.description,
                ),
              )
            : sectionsTelephone().map((s) => ligne(`/reglages?section=${s.id}`, s.icone, s.titreTelephone, s.id === "mobile" ? DESCRIPTION_TELEPHONE : s.description))}
        </ul>
        {requete && !resultats.length ? (
          <p role="status" className="mt-4 text-ui text-texte-secondaire">
            Aucun réglage ne correspond à « {requete} ».
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Une section : sa description, puis ses lignes. */
function PageSection({ id, reglage }: { id: IdSection; reglage: string | null }) {
  const router = useRouter();
  const section = SECTIONS.find((s) => s.id === id)!;
  /* Une ligne cherchée : elle défile à l'écran. */
  useEffect(() => {
    if (!reglage) return;
    const minuteur = setTimeout(() => document.getElementById(ancreReglage(reglage))?.scrollIntoView({ block: "start" }), 300);
    return () => clearTimeout(minuteur);
  }, [reglage]);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titreSection(id)} retour={() => router.push("/reglages")} />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        <p className="px-4 text-ui text-texte-secondaire">{id === "mobile" ? DESCRIPTION_TELEPHONE : section.description}</p>
        <div className="mt-2">{contenu(id)}</div>
      </div>
    </div>
  );
}

function contenu(id: IdSection): ReactNode {
  switch (id) {
    case "mobile":
      return <CeTelephone />;
    case "general":
      return <General />;
    case "profil":
      return <Profil />;
    case "equipe":
      return (
        /* Les composants du bureau (tout est sur le compte), avec les champs à 16 px et le texte utile lisible (AA). */
        <div className="px-4 [&_.text-texte-tertiaire]:text-texte-secondaire [&_input]:text-body-s!">
          <Equipe />
        </div>
      );
    case "claude":
      return <Claude />;
    case "agents":
      return <Agents />;
    case "notifications":
      return <Notifications />;
    case "computer-use":
      return <ComputerUse />;
    case "mises-a-jour":
      return <MisesAJour />;
    default:
      return <SurOrdinateur section={id} />;
  }
}

/* ─── Briques ──────────────────────────────────────────────────── */

/** Les lignes d'une section qui restent sur l'ordinateur (P-8), chacune avec sa raison. */
function SurOrdinateur({ section, seulement }: { section: IdSection; seulement?: string[] }) {
  const entrees = SECTIONS.find((s) => s.id === section)!.entrees.filter((e) => etatLigne(e.id).type === "ordinateur" && (!seulement || seulement.includes(e.id)));
  return (
    <ul className="px-4">
      {entrees.map((e) => {
        const etat = etatLigne(e.id);
        return (
          <li key={e.id} id={ancreReglage(e.id)} className="scroll-mt-4 border-b border-bordure-subtile">
            <SurLePoste titre={e.titre} raison={etat.type === "ordinateur" ? etat.raison : ""} />
          </li>
        );
      })}
    </ul>
  );
}

/** Un interrupteur sur toute la largeur de la ligne (cible de 48 px). */
function Bascule({ id, libelle, detail, actif, disabled, onChange }: { id?: string; libelle: string; detail?: string; actif: boolean; disabled?: boolean; onChange: (actif: boolean) => void }) {
  return (
    <button
      id={id ? ancreReglage(id) : undefined}
      type="button"
      role="switch"
      aria-checked={actif}
      aria-label={libelle}
      disabled={disabled}
      onClick={() => onChange(!actif)}
      className="flex min-h-12 w-full scroll-mt-4 items-center gap-3 border-b border-bordure-subtile py-2 text-left active:bg-fond-survol disabled:opacity-60"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body-s text-texte-principal">{libelle}</span>
        {detail ? <span className="text-ui-xs text-texte-secondaire">{detail}</span> : null}
      </span>
      <span aria-hidden="true" className={cn("relative inline-flex h-6 w-10 shrink-0 rounded-pill transition-colors duration-[220ms] ease-sortie", actif ? "bg-fond-accent" : "bg-gris-k2-500")}>
        <span className={cn("absolute top-0.5 left-0.5 size-5 rounded-full bg-fond-surface shadow-ombre-sm transition-transform duration-[220ms] ease-sortie", actif && "translate-x-4")} />
      </span>
    </button>
  );
}

/** Une valeur lue : libellé à gauche, valeur à droite. */
function Valeur({ id, libelle, children }: { id?: string; libelle: string; children: ReactNode }) {
  return (
    <div id={id ? ancreReglage(id) : undefined} className="flex min-h-12 scroll-mt-4 items-center justify-between gap-3 border-b border-bordure-subtile py-2">
      <span className="text-body-s text-texte-principal">{libelle}</span>
      <span className="text-right text-ui text-texte-secondaire">{children}</span>
    </div>
  );
}

/* ─── Ce téléphone ─────────────────────────────────────────────── */

/** « Ce téléphone » (la section Mobile) : son chemin, ses notifications et ses sons, ses ordinateurs, sa déconnexion. */
function CeTelephone() {
  const { seDeconnecter, moi } = useCompte();
  const { postes, principal } = usePostes();
  const sur = useSupport();
  const serveurs = useServeursRelies();
  const sondes = useSondes(serveurs);
  return (
    <div className="px-4">
      <p id={ancreReglage("mobile-chemin")} className="mt-2 scroll-mt-4 text-body-s text-texte-principal">
        {moi?.email}
      </p>
      <p className="mt-1 text-ui text-texte-secondaire">{cheminTelephone(principal)}</p>
      <button type="button" className="mt-3 min-h-11 text-ui text-texte-principal" onClick={() => void seDeconnecter()}>
        Se déconnecter de ce téléphone
      </button>

      {/* Les notifications du téléphone et ses sons (§ 8) : un autre chantier les remplit. */}
      <NotificationsTelephone />

      <TitreGroupe>Ordinateurs</TitreGroupe>
      {postes === undefined ? <p className="mt-2 h-11 rounded-md bg-fond-surface-grise" /> : null}
      {postes?.length === 0 ? <p className="mt-2 text-ui text-texte-secondaire">Aucun ordinateur ne s’est encore signalé sur ton compte.</p> : null}
      <ul id={ancreReglage("mobile-telephones")} className="mt-1 scroll-mt-4">
        {postes?.map((poste) => (
          <li key={poste.cle} className="border-b border-bordure-subtile py-3">
            <p className="text-ui font-medium text-texte-principal">{poste.nom}</p>
            <p className="mt-0.5 text-ui-xs text-texte-secondaire">{texteFeuille(poste as PosteLu)}</p>
          </li>
        ))}
      </ul>

      {serveurs.length ? (
        <>
          <TitreGroupe>Serveurs reliés à ce téléphone</TitreGroupe>
          <ul id={ancreReglage("mobile-vps")} className="mt-1 scroll-mt-4">
            {serveurs.map((s) => (
              <li key={s.id} className="border-b border-bordure-subtile">
                <Link href="/serveurs" className="flex min-h-11 items-center justify-between gap-3 py-2">
                  <span className="min-w-0">
                    <span className="block truncate text-ui text-texte-principal">{s.nom}</span>
                    <span className="block text-ui-xs text-texte-secondaire">{libelleServeur(s.etat, sondes[s.id]?.sonde, sondes[s.id]?.agents)}</span>
                  </span>
                  <Icon name="chevron-right" size={16} className="shrink-0 text-icone-secondaire" />
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-ui-xs text-texte-secondaire">Ce téléphone vérifie seulement qu’il répond. Tes messages passent par {sur}.</p>
        </>
      ) : null}
    </div>
  );
}

/* ─── Général ──────────────────────────────────────────────────── */

function General() {
  return (
    <>
      <div className="px-4">
        <Valeur id="version" libelle="Version de l’app web">
          Version {paquet.version}
        </Valeur>
      </div>
      <SurOrdinateur section="general" />
    </>
  );
}

/* ─── Profil ───────────────────────────────────────────────────── */

function Profil() {
  const { moi } = useCompte();
  const { enregistrer } = useMonIdentite();
  const [nom, setNom] = useState(moi?.nom ?? "");
  const [intitule, setIntitule] = useState(moi?.intitule ?? "");
  const [etat, setEtat] = useState<{ occupe: boolean; message: string | null; erreur: string | null }>({ occupe: false, message: null, erreur: null });
  const [vue, setVue] = useState<"tout" | "klyra">("tout");
  const conso = useLecturePoste<ResumeConsommation | null>("reglages.consommation", { vue });
  const sur = useSupport();
  const modifie = nom !== (moi?.nom ?? "") || intitule !== (moi?.intitule ?? "");

  const envoyer = async () => {
    setEtat({ occupe: true, message: null, erreur: null });
    try {
      await enregistrer(nom, intitule);
      setEtat({ occupe: false, message: "Enregistré", erreur: null });
    } catch (e) {
      setEtat({ occupe: false, message: null, erreur: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <>
      <form
        id={ancreReglage("nom")}
        className="flex scroll-mt-4 flex-col gap-4 px-4"
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
      >
        <ChampTelephone label="Nom" aide="Ce que l’équipe et les agents voient de toi.">
          <Input size="lg" value={nom} maxLength={80} autoComplete="name" onChange={(e) => setNom(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <ChampTelephone label="Rôle" aide="Facultatif : ton rôle dans le studio.">
          <Input size="lg" value={intitule} maxLength={80} onChange={(e) => setIntitule(e.target.value)} className={CHAMP_TELEPHONE} />
        </ChampTelephone>
        <Bouton type="submit" variant="sombre" taille="md" disabled={!modifie || etat.occupe}>
          {etat.occupe ? "Enregistrement…" : "Enregistrer"}
        </Bouton>
        {etat.message ? (
          <p role="status" className="text-ui text-texte-principal">
            {etat.message}
          </p>
        ) : null}
        <ErreurGeste message={etat.erreur} />
      </form>
      <div className="mt-2">
        <SurOrdinateur section="profil" />
      </div>

      <h2 id={ancreReglage("chiffres")} className="mt-6 scroll-mt-4 px-4 text-ui font-medium text-texte-secondaire">
        Consommation sur {sur}
      </h2>
      <div id={ancreReglage("vue-consommation")} role="radiogroup" aria-label="Ce qui est compté" className="mt-2 flex scroll-mt-4 flex-col gap-2 px-4">
        {(
          [
            ["tout", `Tout Claude Code sur ${sur}`],
            ["klyra", "Seulement KLYRA"],
          ] as const
        ).map(([valeur, libelle]) => (
          <button
            key={valeur}
            type="button"
            role="radio"
            aria-checked={vue === valeur}
            onClick={() => setVue(valeur)}
            className={cn("min-h-11 rounded-xs border px-3 text-left text-ui", vue === valeur ? "border-focus text-texte-principal" : "border-bordure-subtile text-texte-secondaire")}
          >
            {libelle}
          </button>
        ))}
      </div>
      <VueLecture lecture={conso} lignes={4} ferme={ferme}>
        {(c) =>
          !c ? (
            <p className="px-4 pt-3 text-ui text-texte-secondaire">Rien n’est encore compté sur {sur}.</p>
          ) : (
            <div className="px-4 pt-2">
              <Valeur libelle="Jetons sur un an">{c.jetons === null ? "Pas encore compté" : compact(c.jetons)}</Valeur>
              <Valeur libelle="Messages">{compact(c.messages)}</Valeur>
              <Valeur libelle="Jours actifs">{c.joursActifs}</Valeur>
              <Valeur libelle="Série actuelle">{`${c.serieActuelle} jour${c.serieActuelle > 1 ? "s" : ""}`}</Valeur>
              <Valeur libelle="Plus longue série">{`${c.plusLongueSerie} jour${c.plusLongueSerie > 1 ? "s" : ""}`}</Valeur>
              {c.coutUsd !== null ? <Valeur libelle="Coût renvoyé par Claude Code">{`${c.coutUsd.toFixed(2)} $`}</Valeur> : null}
              {c.modeles.length ? (
                <div id={ancreReglage("modeles-utilisation")} className="scroll-mt-4">
                  <TitreGroupe>Utilisation des modèles</TitreGroupe>
                  {c.modeles.map((m) => (
                    <Valeur key={m.nom} libelle={m.nom}>
                      {compact(m.jetons)}
                    </Valeur>
                  ))}
                </div>
              ) : null}
            </div>
          )
        }
      </VueLecture>
    </>
  );
}

/* ─── Claude ───────────────────────────────────────────────────── */

function pourcent(part: number) {
  return `${Math.round(part * 100)} %`;
}

function Claude() {
  const lecture = useLecturePoste<{ compte: CompteClaude | null; utilisation: Utilisation | null }>("reglages.claude", {});
  return (
    <>
      <VueLecture lecture={lecture} lignes={3} ferme={ferme}>
        {({ compte, utilisation }) => (
          <div className="px-4">
            <Valeur id="compte-claude" libelle="Compte Claude">
              {!compte ? "Vérification…" : !compte.installe ? "Claude Code est introuvable" : compte.connecte ? "Connecté" : "Pas connecté"}
            </Valeur>
            {compte?.connecte ? (
              <p className="py-2 text-ui text-texte-secondaire">
                {[compte.email, compte.abonnement ? `abonnement ${nomAbonnement(compte.abonnement)}` : null].filter(Boolean).join(" · ")}
              </p>
            ) : null}
            <div id={ancreReglage("utilisation")} className="scroll-mt-4">
              <TitreGroupe>Utilisation</TitreGroupe>
              {utilisation ? (
                <>
                  {utilisation.session ? (
                    <Valeur libelle="Session de 5 h">
                      {pourcent(utilisation.session.utilise)}
                      {utilisation.session.reinitialiseA ? ` · remise à zéro ${dateHeure.format(utilisation.session.reinitialiseA)}` : ""}
                    </Valeur>
                  ) : null}
                  {utilisation.semaine ? (
                    <Valeur libelle="Semaine">
                      {pourcent(utilisation.semaine.utilise)}
                      {utilisation.semaine.reinitialiseA ? ` · remise à zéro ${dateHeure.format(utilisation.semaine.reinitialiseA)}` : ""}
                    </Valeur>
                  ) : null}
                </>
              ) : (
                <p className="py-2 text-ui text-texte-secondaire">Pas encore d’utilisation lue.</p>
              )}
            </div>
          </div>
        )}
      </VueLecture>
      <div className="mt-2">
        <SurOrdinateur section="claude" />
      </div>
    </>
  );
}

/* ─── Agents ───────────────────────────────────────────────────── */

function Agents() {
  const lecture = useLecturePoste<AgentsReglages>("reglages.agents", {});
  const { agir, occupe, ouvert, bandeau, montrer, erreur } = useGesteTelephone();
  const [personnaliser, setPersonnaliser] = useState(false);
  const apres = (ok: unknown) => {
    if (ok) lecture.relancer();
  };
  return (
    <>
      <VueLecture lecture={lecture} lignes={4} ferme={ferme}>
        {(a) => (
          <div className="px-4">
            <div id={ancreReglage("acces")} className="scroll-mt-4">
              <TitreGroupe>Niveau d’accès</TitreGroupe>
              <p className="text-ui-xs text-texte-secondaire">Ce qu’un agent peut faire sans te demander. D’ici, tu peux seulement le réduire.</p>
              <div role="radiogroup" aria-label="Accès des agents" className="mt-2 flex flex-col gap-2">
                {NIVEAUX_ACCES.map((n) => {
                  const choisi = a.acces === n.id;
                  const permis = choisi || accesPermis(a.acces, n.id);
                  return (
                    <div key={n.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={choisi}
                        disabled={!permis || !ouvert || occupe}
                        onClick={() => !choisi && void agir("reglages.acces", { acces: n.id }, `Accès : ${n.nom}.`).then(apres)}
                        className={cn("flex min-h-11 w-full flex-col gap-1 rounded-md border p-3 text-left disabled:opacity-60", choisi ? "border-focus" : "border-bordure-subtile")}
                      >
                        <span className="text-body-s font-medium text-texte-principal">{n.nom}</span>
                        <span className="text-ui-xs text-texte-secondaire">{n.detail}</span>
                      </button>
                      {!permis ? (
                        <SurLePoste
                          raison={
                            n.id === "tout"
                              ? (() => {
                                  const e = etatLigne("acces");
                                  return e.type === "poste" ? (e.elevation ?? "") : "";
                                })()
                              : "donner plus d’accès aux agents se décide devant l’ordinateur."
                          }
                        />
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>

            <div id={ancreReglage("assistant")} className="scroll-mt-4">
              <TitreGroupe>Ton assistant</TitreGroupe>
              <div className="flex min-h-14 items-center gap-3">
                <RondApercu agentId={ID_ASSISTANT} nom={a.assistant.nom} teinte={teinteSure(a.assistant.teinte, "bleu-k1")} taille={36} />
                <span className="min-w-0 flex-1 truncate text-body-s text-texte-principal">{a.assistant.nom}</span>
                <Bouton variant="blanc" taille="md" disabled={!ouvert} onClick={() => setPersonnaliser(true)}>
                  Personnaliser
                </Bouton>
              </div>
            </div>

            <div id={ancreReglage("modeles")} className="scroll-mt-4">
              <TitreGroupe>Modèle de chaque agent</TitreGroupe>
              {a.agents.length ? (
                <ul>
                  {a.agents.map((r) => {
                    const options = MODELES_FICHE.some((m) => m.value === r.modele) ? MODELES_FICHE : [...MODELES_FICHE, { value: r.modele, label: r.modele }];
                    return (
                      <li key={r.id} className="flex min-h-14 items-center gap-3 border-b border-bordure-subtile py-2">
                        <RondApercu agentId={r.id} nom={r.nom} teinte={teinteSure(r.teinte)} taille={36} />
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-body-s text-texte-principal">{r.nom}</span>
                          <span className="truncate text-ui-xs text-texte-secondaire">{r.tag}</span>
                        </span>
                        <ListeDeroulante
                          libelle={`Modèle de ${r.nom}`}
                          value={r.modele}
                          options={options}
                          disabled={!ouvert || occupe}
                          onChange={(modele) => void agir("reglages.modele", { id: r.id, modele }, `${r.nom} : ${modele}.`).then(apres)}
                          className="min-h-11 w-auto text-ui"
                        />
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="text-ui text-texte-secondaire">Ton assistant travaille seul. Crée un agent ou prends-en un dans la bibliothèque.</p>
              )}
            </div>
            {ouvert ? null : <NotePoste />}
            <ErreurGeste message={erreur?.message} className="mt-2" />
            {personnaliser ? (
              <FeuillePersonnaliser
                id={ID_ASSISTANT}
                nom={a.assistant.nom}
                roleCourt=""
                teinte={teinteSure(a.assistant.teinte, "bleu-k1")}
                onFermer={() => setPersonnaliser(false)}
                onFait={(texte) => {
                  montrer(texte);
                  lecture.relancer();
                }}
              />
            ) : null}
          </div>
        )}
      </VueLecture>
      <div className="mt-2">
        <SurOrdinateur section="agents" />
      </div>
      {bandeau}
    </>
  );
}

/* ─── Notifications de l'ordinateur ────────────────────────────── */

const EVENEMENTS: { cle: keyof PreferencesNotifications; libelle: string; description: string }[] = [
  { cle: "agentFini", libelle: "Un agent a fini", description: "Sa réponse t’attend dans une conversation que tu ne regardes pas." },
  { cle: "agentErreur", libelle: "Un agent s’est arrêté sur une erreur", description: "Il n’a pas pu finir : la conversation dit pourquoi." },
  { cle: "workflow", libelle: "Un workflow te prévient", description: "Les étapes « Notification » de tes workflows." },
  { cle: "majPrete", libelle: "Une mise à jour est prête", description: "Une notification pour l’installer tout de suite." },
];

function Notifications() {
  const sur = useSupport();
  const lecture = useLecturePoste<{ notifications: PreferencesNotifications; finDeTache: boolean }>("reglages.notifications", {});
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const apres = (ok: unknown) => {
    if (ok) lecture.relancer();
  };
  const changer = (cle: keyof PreferencesNotifications, valeur: boolean) => void agir("reglages.notification", { cle, valeur }).then(apres);
  return (
    <>
      <p className="px-4 text-ui text-texte-secondaire">
        Les notifications de {sur}. Celles de ce téléphone sont dans{" "}
        <Link href="/reglages?section=mobile" className="text-texte-principal underline underline-offset-2">
          Ce téléphone
        </Link>
        .
      </p>
      <VueLecture lecture={lecture} lignes={5} ferme={ferme}>
        {({ notifications: n, finDeTache }) => {
          const off = !ouvert || occupe;
          return (
            <div className="px-4">
              <Bascule id="notifications-systeme" libelle="Notifications du système" detail="Quand un agent finit pendant que tu regardes ailleurs." actif={n.actives} disabled={off} onChange={(v) => changer("actives", v)} />
              <Bascule id="pastille" libelle="Pastille sur l’icône" detail="Le nombre de réponses arrivées depuis que tu as quitté l’app." actif={n.pastille} disabled={off} onChange={(v) => changer("pastille", v)} />
              <Bascule id="son" libelle="Son" detail="Le son du système avec chaque notification." actif={n.son} disabled={off || !n.actives} onChange={(v) => changer("son", v)} />
              <div id={ancreReglage("evenements")} className="scroll-mt-4">
                <TitreGroupe>Par événement</TitreGroupe>
                {!n.actives ? <p className="text-ui-xs text-texte-secondaire">Les notifications du système sont coupées : rien ne s’affiche.</p> : null}
                {EVENEMENTS.map((e) => (
                  <Bascule key={e.cle} libelle={e.libelle} detail={e.description} actif={n[e.cle]} disabled={off} onChange={(v) => changer(e.cle, v)} />
                ))}
              </div>
              <Bouton id={ancreReglage("essai-notification")} variant="blanc" taille="md" className="mt-3 w-full" disabled={off || !n.actives} onClick={() => void agir("reglages.essaiNotification", {}, `Envoyée sur ${sur}.`)}>
                Essayer
              </Bouton>
              <Bascule
                id="son-fin-tache"
                libelle="Émettre un son à la fin d’une tâche"
                detail={`Sur ${sur}, quand un agent a fini.`}
                actif={finDeTache}
                disabled={off}
                onChange={(v) => void agir("reglages.sonFinTache", { actif: v }).then(apres)}
              />
              {ouvert ? null : <NotePoste />}
              <ErreurGeste message={erreur?.message} className="mt-2" />
            </div>
          );
        }}
      </VueLecture>
      <SurOrdinateur section="notifications" />
      {bandeau}
    </>
  );
}

/* ─── Computer Use ─────────────────────────────────────────────── */

const AUTORISATIONS: Record<EtatAutorisation, string> = {
  accordee: "Accordée",
  refusee: "Pas encore accordée",
  "a-demander": "Pas encore demandée",
  "sans-objet": "Rien à autoriser",
  inconnue: "Inconnue sur ce système",
};

function ComputerUse() {
  const lecture = useLecturePoste<{ actif: boolean; autorisations: AutorisationsComputerUse | null }>("reglages.etatComputerUse", {});
  const { agir, occupe, ouvert, bandeau, erreur } = useGesteTelephone();
  const elevation = (() => {
    const e = etatLigne("computer-use-actif");
    return e.type === "poste" ? (e.elevation ?? "") : "";
  })();
  return (
    <>
      <VueLecture lecture={lecture} lignes={3} ferme={ferme}>
        {({ actif, autorisations }) => (
          <div className="px-4">
            {actif ? (
              <>
                <Bascule
                  id="computer-use-actif"
                  libelle="Laisser les agents piloter l’ordinateur"
                  detail="Le couper d’ici est toujours possible : aucun agent ne touchera plus à l’écran."
                  actif
                  disabled={!ouvert || occupe}
                  onChange={() => void agir("reglages.computerUse", { actif: false }, "Computer Use coupé.").then((ok) => ok && lecture.relancer())}
                />
                {ouvert ? null : <NotePoste />}
              </>
            ) : (
              <div id={ancreReglage("computer-use-actif")} className="scroll-mt-4 border-b border-bordure-subtile">
                <Valeur libelle="Laisser les agents piloter l’ordinateur">Coupé</Valeur>
                <SurLePoste raison={elevation} />
              </div>
            )}
            <TitreGroupe>Autorisations du système</TitreGroupe>
            <Valeur id="autorisation-accessibilite" libelle="Accessibilité">
              {autorisations ? AUTORISATIONS[autorisations.accessibilite] : "Inconnue"}
            </Valeur>
            <Valeur id="autorisation-ecran" libelle="Enregistrement de l’écran">
              {autorisations ? AUTORISATIONS[autorisations.ecran] : "Inconnue"}
            </Valeur>
            <SurLePoste raison={elevation} />
            <ErreurGeste message={erreur?.message} className="mt-2" />
          </div>
        )}
      </VueLecture>
      {bandeau}
    </>
  );
}

/* ─── Mises à jour ─────────────────────────────────────────────── */

function phraseMaj(etat: EtatMaj): string {
  switch (etat.statut) {
    case "dev":
      return "Version de développement : elle ne se met pas à jour toute seule.";
    case "verification":
      return "Recherche en cours…";
    case "telechargement":
      return `Téléchargement de KLYRA ${etat.disponible ?? ""}…`;
    case "prete":
      return `KLYRA ${etat.nouvelle} est téléchargée et vérifiée. Elle s’installera quand tu quitteras l’app.`;
    case "a-jour":
      return "Tu as la dernière version.";
    case "erreur":
      return etat.erreur ?? "La dernière recherche n’a pas abouti.";
    default:
      return "L’app regarde au démarrage, puis toutes les heures.";
  }
}

function MisesAJour() {
  const lecture = useLecturePoste<EtatMaj | null>("reglages.majs", {});
  const { agir, occupe, ouvert, erreur } = useGesteTelephone();
  return (
    <>
      <VueLecture lecture={lecture} lignes={3} ferme={ferme}>
        {(etat) =>
          !etat ? (
            <p className="px-4 pt-3 text-ui text-texte-secondaire">Les mises à jour ne se lisent pas sur cet ordinateur.</p>
          ) : (
            <div className="px-4">
              <p className="py-2 text-ui text-texte-principal">{phraseMaj(etat)}</p>
              <Valeur id="version-installee" libelle="Version installée">
                {etat.version}
              </Valeur>
              <Valeur id="version-disponible" libelle="Dernière version disponible">
                {etat.disponible ?? "Pas encore vérifiée"}
              </Valeur>
              <Valeur id="derniere-verification" libelle="Dernière vérification">
                {etat.verifieeLe ? dateHeure.format(etat.verifieeLe) : "Jamais"}
              </Valeur>
              <Bouton
                id={ancreReglage("rechercher-maj")}
                variant="blanc"
                taille="md"
                className="mt-3 w-full"
                disabled={!ouvert || occupe || etat.statut === "verification" || etat.statut === "telechargement"}
                onClick={() => void agir("reglages.verifierMaj", {}, undefined, { delai: 60_000 }).then(() => lecture.relancer())}
              >
                {occupe ? "Recherche…" : "Rechercher une mise à jour"}
              </Bouton>
              {ouvert ? null : <NotePoste />}
              <ErreurGeste message={erreur?.message} className="mt-2" />
            </div>
          )
        }
      </VueLecture>
      <SurOrdinateur section="mises-a-jour" />
      <div className="px-4">
        <a
          id={ancreReglage("changelog")}
          href={CHANGELOG}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 scroll-mt-4 items-center justify-between border-b border-bordure-subtile text-body-s text-texte-principal"
        >
          Nouveautés
          <Icon name="link-external" size={20} className="text-icone-secondaire" />
        </a>
        <a
          id={ancreReglage("depot-versions")}
          href={DEPOT}
          target="_blank"
          rel="noopener noreferrer"
          className="flex min-h-12 scroll-mt-4 items-center justify-between border-b border-bordure-subtile text-body-s text-texte-principal"
        >
          Toutes les versions
          <Icon name="link-external" size={20} className="text-icone-secondaire" />
        </a>
      </div>
    </>
  );
}
