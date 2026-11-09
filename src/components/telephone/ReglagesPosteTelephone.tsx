"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { CHANGELOG } from "@/components/reglages/sections/MisesAJour";
import { ancreReglage } from "@/components/reglages/ui";
import { RondApercu } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { NIVEAUX_ACCES } from "@/lib/acces";
import type { Acces, AutorisationsComputerUse, CompteClaude, EtatAutorisation, EtatMaj, PreferencesNotifications, Utilisation } from "@/lib/bridge";
import { useLieuActif } from "@/lib/lieux";
import { useLecturePoste } from "@/lib/poste/client";
import { nomAbonnement } from "@/lib/compte-claude";
import { ID_ASSISTANT, MODELES_FICHE, teinteSure } from "@/lib/telephone/agents";
import type { AgentsReglages } from "@/lib/telephone/gestes-reglages";
import { useGesteTelephone } from "@/lib/telephone/geste";
import { accesPermis, confirmationAcces, dateCourte, DETAILS_MODELES, detailAcces, etatLigne, libelleModele, remiseAZero } from "@/lib/telephone/reglages";
import { useHorsLigne } from "./BandeauReseau";
import { ErreurGeste } from "./CommunAgentsTelephone";
import { Bandeau, Jauge, SuccesLigne } from "./Controles";
import { NotePoste, useVueGardeeAffichee, VueLecture } from "./etats";
import { ConfirmationFeuille, Feuille, useFermerFeuille } from "./Feuille";
import { FeuillePersonnaliser } from "./FicheAgentTelephone";
import { Etiquette, GroupeListe, LigneChoix, LigneInterrupteur, LigneLienExterne, LigneListe, SectionListe, SousSection, TuileIcone, ValeurLigne, NoteListe } from "./Liste";
import { useSupport } from "./poste";
import { LigneSurPoste, LignesSurPoste, Pile, useLectureStable, useSucces } from "./ReglagesCommun";

/**
 * Les sections lues sur l'ordinateur (lot 8, E8-31 à E8-41) : Claude, Agents, ses notifications,
 * Computer Use, Mises à jour. M-13 : réduire un pouvoir se fait d'ici, avec confirmation ; l'élargir,
 * devant l'ordinateur. Rien n'est annoncé avant la réponse de l'ordinateur : le contrôle dit « Envoi… »,
 * la valeur reste la dernière confirmée, et un échec le dit sur place.
 */

const DEPOT = "https://github.com/KLYRA-FR/klyra-app-versions/releases";
const ferme = (sur: string) => `ces réglages sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`;

function useHorloge(): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(minuteur);
  }, []);
  return maintenant;
}

/** Sous un geste sur l'ordinateur indisponible : pourquoi (P-7), le réseau, puis le serveur affiché. */
function RaisonGeste({ ouvert, horsLigne }: { ouvert: boolean; horsLigne: boolean }) {
  const lieu = useLieuActif();
  if (horsLigne) return <NoteListe>Possible quand ce téléphone est en ligne.</NoteListe>;
  if (lieu) return <NoteListe>Depuis l’app de bureau, sur ce serveur.</NoteListe>;
  return ouvert ? null : <NotePoste className="mx-1 mt-2.5 text-ui-xs text-texte-secondaire" />;
}

/* ─── Claude ───────────────────────────────────────────────────── */

function LigneJauge({ nom, part, remise, maintenant }: { nom: string; part: number; remise: number | null; maintenant: number }) {
  return (
    <li className="relative px-4 py-3.5 [&:not(:first-child)]:shadow-[inset_0_1px_0_var(--color-bordure-defaut)]">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-body-s font-medium text-texte-principal">{nom}</span>
        <span className="klyra-mono text-ui font-semibold text-texte-principal">{Math.round(part * 100)} %</span>
      </div>
      <div className="mt-2">
        <Jauge part={part} libelle={nom} />
      </div>
      {remise ? <p className="mt-1.5 text-ui text-texte-secondaire">{remiseAZero(remise, maintenant)}</p> : null}
    </li>
  );
}

export function ClaudeTelephone() {
  const lecture = useLecturePoste<{ compte: CompteClaude | null; utilisation: Utilisation | null }>("reglages.claude", {});
  const maintenant = useHorloge();
  return (
    <>
      <VueLecture lecture={lecture} lignes={2} ferme={ferme}>
        {({ compte, utilisation }) => (
          <Pile>
            <SectionListe titre="Compte Claude">
              <GroupeListe>
                <LigneListe
                  id={ancreReglage("compte-claude")}
                  debut={<TuileIcone icone="stars" />}
                  retrait="tuile"
                  nom={!compte ? "Vérification…" : !compte.installe ? "Claude Code est introuvable" : compte.connecte ? "Connecté" : "Pas connecté"}
                  etiquette={compte?.connecte && compte.abonnement ? <Etiquette>{nomAbonnement(compte.abonnement)}</Etiquette> : null}
                  ligne2={compte?.connecte ? (compte.email ?? undefined) : undefined}
                  uneLigne
                />
              </GroupeListe>
            </SectionListe>
            <SectionListe titre="Utilisation">
              <div id={ancreReglage("utilisation")} className="klyra-reglage scroll-mt-4">
                {utilisation?.session || utilisation?.semaine ? (
                  <GroupeListe>
                    {utilisation.session ? <LigneJauge nom="Session de 5 h" part={utilisation.session.utilise} remise={utilisation.session.reinitialiseA} maintenant={maintenant} /> : null}
                    {utilisation.semaine ? <LigneJauge nom="Semaine" part={utilisation.semaine.utilise} remise={utilisation.semaine.reinitialiseA} maintenant={maintenant} /> : null}
                  </GroupeListe>
                ) : (
                  /* Pas de donnée : un état explicite, jamais 0 %. */
                  <GroupeListe>
                    <LigneListe nom="Pas encore d’utilisation lue" ligne2="Elle s’affiche après une relecture sur l’ordinateur." />
                  </GroupeListe>
                )}
              </div>
            </SectionListe>
          </Pile>
        )}
      </VueLecture>
      <Pile className="pt-5">
        <LignesSurPoste section="claude" />
      </Pile>
    </>
  );
}

/* ─── Agents ───────────────────────────────────────────────────── */

type LigneAgent = AgentsReglages["agents"][number];

/** La feuille du modèle d'un agent (E8-35) : le choix part à l'ordinateur, elle se ferme à sa réponse, une erreur y reste. */
function ChoixModele({ agent, agir, envoi, erreur }: { agent: LigneAgent; agir: (modele: string) => Promise<boolean>; envoi: string | null; erreur: string | null | undefined }) {
  const fermer = useFermerFeuille();
  const connu = MODELES_FICHE.some((m) => m.value === agent.modele);
  return (
    <>
      <div role="radiogroup" aria-label={`Modèle de ${agent.nom}`}>
        <GroupeListe>
          {MODELES_FICHE.map((m) => (
            <LigneChoix
              key={m.value}
              nom={m.label}
              ligne2={DETAILS_MODELES[m.value]}
              choisi={m.value === agent.modele}
              envoi={envoi === m.value}
              onChoisir={() => {
                if (m.value === agent.modele) return fermer();
                void agir(m.value).then((ok) => {
                  if (ok) fermer();
                });
              }}
            />
          ))}
          {connu ? null : <LigneChoix nom="Autre modèle" ligne2="Choisi sur l’ordinateur." choisi onChoisir={fermer} />}
        </GroupeListe>
      </div>
      <ErreurGeste message={erreur} className="mt-2.5" />
    </>
  );
}

function ContenuAgents({ a, relancer }: { a: AgentsReglages; relancer: () => void }) {
  const { agir, occupe, ouvert, erreur, montrer } = useGesteTelephone();
  const horsLigne = useHorsLigne();
  const sur = useSupport();
  const gardee = useVueGardeeAffichee();
  const [aReduire, setAReduire] = useState<(typeof NIVEAUX_ACCES)[number] | null>(null);
  const [envoiAcces, setEnvoiAcces] = useState<Acces | null>(null);
  const [succes, montrerSucces] = useSucces();
  const [personnaliser, setPersonnaliser] = useState(false);
  const [modele, setModele] = useState<LigneAgent | null>(null);
  const [envoiModele, setEnvoiModele] = useState<string | null>(null);
  const lieu = useLieuActif();
  const possible = ouvert && !horsLigne && !lieu;
  const elevation = (() => {
    const e = etatLigne("acces");
    return e.type === "poste" ? (e.elevation ?? "") : "";
  })();

  const reduire = async (niveau: Acces) => {
    setEnvoiAcces(niveau);
    const ok = await agir("reglages.acces", { acces: niveau });
    setEnvoiAcces(null);
    if (ok) {
      relancer();
      montrerSucces(`Enregistré sur ${sur}`);
    }
  };

  return (
    <Pile>
      <SectionListe titre="Niveau d’accès">
        <SousSection>Ce qu’un agent peut faire sans te demander. D’ici, tu peux le réduire ; l’élargir se fait devant {sur}.</SousSection>
        <div id={ancreReglage("acces")} role="radiogroup" aria-label="Accès des agents" className="klyra-reglage scroll-mt-4">
          <GroupeListe>
            {NIVEAUX_ACCES.map((n) => {
              const choisi = a.acces === n.id;
              const permis = choisi || accesPermis(a.acces, n.id);
              return (
                <LigneChoix
                  key={n.id}
                  nom={n.nom}
                  ligne2={detailAcces(n.id)}
                  choisi={choisi}
                  inactive={!permis}
                  etiquette={permis ? null : <Etiquette>{`Sur ${sur}`}</Etiquette>}
                  raison={n.id === "tout" ? capitale(elevation) : "Donner plus d’accès aux agents se décide devant l’ordinateur."}
                  envoi={envoiAcces === n.id}
                  onChoisir={() => !choisi && possible && !occupe && setAReduire(n)}
                />
              );
            })}
          </GroupeListe>
        </div>
        {succes ? <SuccesLigne className="mx-1 mt-2">{succes}</SuccesLigne> : null}
        <ErreurGeste message={!modele ? erreur?.message : null} className="mx-1 mt-2" />
      </SectionListe>

      <SectionListe titre="Ton assistant">
        <div id={ancreReglage("assistant")} className="klyra-reglage scroll-mt-4">
          <GroupeListe>
            <li className="flex min-h-[72px] items-center gap-3 py-2.5 pr-3 pl-4">
              <RondApercu agentId={ID_ASSISTANT} nom={a.assistant.nom} teinte={teinteSure(a.assistant.teinte, "bleu-k1")} taille={40} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body-s font-medium text-texte-principal">{a.assistant.nom}</span>
                <span className="mt-0.5 block truncate text-ui text-texte-secondaire">Son nom et sa couleur, partout dans l’app</span>
              </span>
              <Bouton variant="blanc" taille="compact" className="relative after:absolute after:inset-x-0 after:-inset-y-1.5" disabled={!possible} onClick={() => setPersonnaliser(true)}>
                Personnaliser
              </Bouton>
            </li>
          </GroupeListe>
        </div>
      </SectionListe>

      <SectionListe titre="Modèle de chaque agent">
        <div id={ancreReglage("modeles")} className="klyra-reglage scroll-mt-4">
          {a.agents.length ? (
            <GroupeListe>
              {a.agents.map((r) => (
                <LigneListe
                  key={r.id}
                  debut={<RondApercu agentId={r.id} nom={r.nom} teinte={teinteSure(r.teinte)} taille={40} />}
                  retrait="avatar"
                  nom={r.nom}
                  etiquette={r.tag ? <Etiquette>{r.tag}</Etiquette> : null}
                  onClick={possible ? () => setModele(r) : undefined}
                  fin={
                    <span className="flex shrink-0 items-center gap-1">
                      <ValeurLigne>{libelleModele(r.modele)}</ValeurLigne>
                      {gardee ? null : <Icon name="chevron-right" size={20} className="text-icone-secondaire" />}
                    </span>
                  }
                />
              ))}
            </GroupeListe>
          ) : (
            <GroupeListe>
              <LigneListe nom="Ton assistant travaille seul" ligne2="Crée un agent ou prends-en un dans la bibliothèque." />
            </GroupeListe>
          )}
        </div>
      </SectionListe>
      {gardee ? null : <RaisonGeste ouvert={ouvert} horsLigne={horsLigne} />}

      {aReduire ? (
        <ConfirmationFeuille
          {...confirmationAcces(aReduire, sur)}
          onConfirmer={() => void reduire(aReduire.id)}
          onFermer={() => setAReduire(null)}
        />
      ) : null}
      {modele ? (
        <Feuille titre={`Modèle de ${modele.nom}`} objet={{ visuel: <RondApercu agentId={modele.id} nom={modele.nom} teinte={teinteSure(modele.teinte)} taille={44} />, sous: `${modele.tag ? `${modele.tag} · ` : ""}vaut pour ses prochaines réponses` }} onFermer={() => setModele(null)}>
          <ChoixModele
            agent={modele}
            envoi={envoiModele}
            erreur={erreur?.message}
            agir={async (valeur) => {
              setEnvoiModele(valeur);
              const ok = await agir("reglages.modele", { id: modele.id, modele: valeur });
              setEnvoiModele(null);
              if (ok) {
                relancer();
                montrer(`${modele.nom} : ${libelleModele(valeur)}, enregistré sur ${sur}.`);
              }
              return !!ok;
            }}
          />
        </Feuille>
      ) : null}
      {personnaliser ? (
        <FeuillePersonnaliser
          id={ID_ASSISTANT}
          nom={a.assistant.nom}
          roleCourt=""
          teinte={teinteSure(a.assistant.teinte, "bleu-k1")}
          onFermer={() => setPersonnaliser(false)}
          onFait={(texte) => {
            montrer(texte);
            relancer();
          }}
        />
      ) : null}
    </Pile>
  );
}

const capitale = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function AgentsReglagesTelephone() {
  const lecture = useLectureStable(useLecturePoste<AgentsReglages>("reglages.agents", {}));
  return (
    <>
      <VueLecture lecture={lecture} lignes={4} ferme={ferme} gestes="Changer">
        {(a) => <ContenuAgents a={a} relancer={lecture.relancer} />}
      </VueLecture>
      <Pile className="pt-5">
        <LignesSurPoste section="agents" />
      </Pile>
    </>
  );
}

/* ─── Notifications de l'ordinateur ────────────────────────────── */

const EVENEMENTS: { cle: keyof PreferencesNotifications; libelle: string }[] = [
  { cle: "agentFini", libelle: "Un agent a fini" },
  { cle: "agentErreur", libelle: "Un agent s’est arrêté sur une erreur" },
  { cle: "workflow", libelle: "Un workflow te prévient" },
  { cle: "majPrete", libelle: "Une mise à jour est prête" },
  { cle: "mcpDefaut", libelle: "Une connexion d’agent a expiré" },
];

function ContenuNotifications({ n, finDeTache, relancer }: { n: PreferencesNotifications; finDeTache: boolean; relancer: () => void }) {
  const sur = useSupport();
  const { agir, ouvert, erreur } = useGesteTelephone();
  const horsLigne = useHorsLigne();
  /* Un seul geste du même champ à la fois : « Envoi… » jusqu'à la réponse. */
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [essai, setEssai] = useState(false);
  const lieu = useLieuActif();
  const off = !ouvert || horsLigne || !!lieu || envoi !== null;
  const changer = async (cle: string, type: string, args: unknown) => {
    setEnvoi(cle);
    const ok = await agir(type, args);
    setEnvoi(null);
    if (ok) relancer();
  };
  const notification = (cle: keyof PreferencesNotifications, valeur: boolean) => void changer(cle, "reglages.notification", { cle, valeur });
  return (
    <Pile>
      <SectionListe titre={`Sur ${sur}`}>
        <GroupeListe>
          <LigneInterrupteur id={ancreReglage("notifications-systeme")} nom="Notifications du système" ligne2="Quand un agent finit pendant que tu regardes ailleurs" actif={n.actives} disabled={off} envoi={envoi === "actives"} onChange={(v) => notification("actives", v)} />
          <LigneInterrupteur id={ancreReglage("pastille")} nom="Pastille sur l’icône" ligne2="Les réponses arrivées depuis que tu as quitté l’app" actif={n.pastille} disabled={off} envoi={envoi === "pastille"} onChange={(v) => notification("pastille", v)} />
          <LigneInterrupteur id={ancreReglage("son")} nom="Son" ligne2="Le son du système avec chaque notification" uneLigne actif={n.son} disabled={off || !n.actives} envoi={envoi === "son"} onChange={(v) => notification("son", v)} />
        </GroupeListe>
      </SectionListe>
      <SectionListe titre="Par événement">
        {!n.actives ? <SousSection>Les notifications du système sont coupées : rien ne s’affiche.</SousSection> : null}
        <div id={ancreReglage("evenements")} className="klyra-reglage scroll-mt-4">
          <GroupeListe>
            {EVENEMENTS.map((e) => (
              <LigneInterrupteur key={e.cle} nom={e.libelle} actif={n[e.cle]} disabled={off} envoi={envoi === e.cle} onChange={(v) => notification(e.cle, v)} />
            ))}
          </GroupeListe>
        </div>
        <Bouton
          id={ancreReglage("essai-notification")}
          variant="blanc"
          taille="md"
          className="mt-3 w-full"
          disabled={off || !n.actives || essai}
          onClick={() => {
            setEssai(true);
            void agir("reglages.essaiNotification", {}, `Envoyée sur ${sur}.`).finally(() => setEssai(false));
          }}
        >
          {essai ? "Envoi…" : `Essayer sur ${sur}`}
        </Bouton>
      </SectionListe>
      <GroupeListe>
        <LigneInterrupteur id={ancreReglage("son-fin-tache")} nom="Émettre un son à la fin d’une tâche" ligne2={`Sur ${sur}, quand un agent a fini.`} actif={finDeTache} disabled={off} envoi={envoi === "fin"} onChange={(v) => void changer("fin", "reglages.sonFinTache", { actif: v })} />
      </GroupeListe>
      <RaisonGeste ouvert={ouvert} horsLigne={horsLigne} />
      <ErreurGeste message={erreur?.message} className="mx-1" />
    </Pile>
  );
}

export function NotificationsPosteTelephone() {
  const lecture = useLectureStable(useLecturePoste<{ notifications: PreferencesNotifications; finDeTache: boolean }>("reglages.notifications", {}));
  return (
    <>
      <div className="px-4 pt-2 pb-5">
        <Link href="/reglages?section=mobile" className="block no-underline">
          <Bandeau ton="info" icone="iphone-02" fin={<Icon name="chevron-right" size={20} className="shrink-0 text-icone-accent" />}>
            Les notifications de ce téléphone sont dans <span className="font-semibold">Ce téléphone</span>.
          </Bandeau>
        </Link>
      </div>
      <VueLecture lecture={lecture} lignes={5} ferme={ferme} gestes="Changer">
        {({ notifications, finDeTache }) => <ContenuNotifications n={notifications} finDeTache={finDeTache} relancer={lecture.relancer} />}
      </VueLecture>
      <Pile className="pt-5">
        <LignesSurPoste section="notifications" seulement={[]} />
      </Pile>
    </>
  );
}

/* ─── Computer Use ─────────────────────────────────────────────── */

const AUTORISATIONS: Record<EtatAutorisation, string> = {
  accordee: "Accordée",
  refusee: "Pas accordée",
  "a-demander": "À demander",
  "sans-objet": "Sans objet",
  inconnue: "Inconnue",
};

function ContenuComputerUse({ actif, autorisations, relancer }: { actif: boolean; autorisations: AutorisationsComputerUse | null; relancer: () => void }) {
  const { agir, ouvert, erreur } = useGesteTelephone();
  const horsLigne = useHorsLigne();
  const sur = useSupport();
  const [aConfirmer, setAConfirmer] = useState(false);
  const [envoi, setEnvoi] = useState(false);
  const [succes, montrerSucces] = useSucces();
  const elevation = (() => {
    const e = etatLigne("computer-use-actif");
    return e.type === "poste" ? (e.elevation ?? "") : "";
  })();
  const lieu = useLieuActif();
  const nom = `Laisser les agents piloter ${sur}`;
  const couper = async () => {
    setEnvoi(true);
    const ok = await agir("reglages.computerUse", { actif: false });
    setEnvoi(false);
    if (ok) {
      relancer();
      montrerSucces(`Coupé sur ${sur}`);
    }
  };
  return (
    <Pile>
      <div>
        <GroupeListe>
          {actif ? (
            <LigneInterrupteur id={ancreReglage("computer-use-actif")} nom={nom} ligne2="Le couper d’ici est toujours possible : aucun agent ne touchera plus à l’écran." actif disabled={!ouvert || horsLigne || !!lieu} envoi={envoi} onChange={() => setAConfirmer(true)} />
          ) : (
            <>
              <LigneListe id={ancreReglage("computer-use-actif")} nom={nom} fin={<ValeurLigne>Coupé</ValeurLigne>} />
              <LigneSurPoste nom="L’allumer" icone="cursor-01" raison={elevation} />
            </>
          )}
        </GroupeListe>
        {succes ? <SuccesLigne className="mx-1 mt-2">{succes}</SuccesLigne> : null}
        {actif ? <RaisonGeste ouvert={ouvert} horsLigne={horsLigne} /> : null}
        <ErreurGeste message={erreur?.message} className="mx-1 mt-2" />
      </div>
      <SectionListe titre="Autorisations du système">
        <GroupeListe>
          <LigneListe id={ancreReglage("autorisation-accessibilite")} nom="Accessibilité" fin={<ValeurLigne>{autorisations ? AUTORISATIONS[autorisations.accessibilite] : "Inconnue"}</ValeurLigne>} />
          <LigneListe id={ancreReglage("autorisation-ecran")} nom="Enregistrement de l’écran" fin={<ValeurLigne>{autorisations ? AUTORISATIONS[autorisations.ecran] : "Inconnue"}</ValeurLigne>} />
        </GroupeListe>
        {actif ? (
          <div className="mt-2">
            <GroupeListe>
              <LigneSurPoste nom="Les donner ou les reprendre" icone="cursor-01" raison={elevation} />
            </GroupeListe>
          </div>
        ) : null}
      </SectionListe>
      {aConfirmer ? (
        <ConfirmationFeuille
          titre="Couper Computer Use ?"
          texte={`Aucun agent ne touchera plus à l’écran de ${sur}, même au milieu d’une tâche. Le rallumer se fera devant ${sur}.`}
          confirmer="Couper"
          onConfirmer={() => void couper()}
          onFermer={() => setAConfirmer(false)}
        />
      ) : null}
    </Pile>
  );
}

export function ComputerUseTelephone() {
  const lecture = useLectureStable(useLecturePoste<{ actif: boolean; autorisations: AutorisationsComputerUse | null }>("reglages.etatComputerUse", {}));
  return (
    <VueLecture lecture={lecture} lignes={3} ferme={ferme} gestes="Couper">
      {({ actif, autorisations }) => <ContenuComputerUse actif={actif} autorisations={autorisations} relancer={lecture.relancer} />}
    </VueLecture>
  );
}

/* ─── Mises à jour ─────────────────────────────────────────────── */

function carteMaj(etat: EtatMaj, sur: string): { titre: string; texte: string | null } {
  switch (etat.statut) {
    case "dev":
      return { titre: "Version de développement", texte: "Elle ne se met pas à jour toute seule." };
    case "verification":
      return { titre: "Recherche en cours…", texte: null };
    case "telechargement":
      return { titre: `Téléchargement de KLYRA ${etat.disponible ?? ""}…`, texte: null };
    case "prete":
      return { titre: `KLYRA ${etat.nouvelle} est prête`, texte: `Téléchargée et vérifiée sur ${sur}. Elle s’installera quand tu quitteras l’app.` };
    case "a-jour":
      return { titre: "Tu as la dernière version", texte: null };
    case "erreur":
      return { titre: "La dernière recherche n’a pas abouti", texte: etat.erreur ?? null };
    default:
      return { titre: "L’app regarde au démarrage, puis toutes les heures", texte: null };
  }
}

function Liens() {
  return (
    <GroupeListe>
      <LigneLienExterne id={ancreReglage("changelog")} href={CHANGELOG} nom="Nouveautés" />
      <LigneLienExterne id={ancreReglage("depot-versions")} href={DEPOT} nom="Toutes les versions" />
    </GroupeListe>
  );
}

function ContenuMaj({ etat, relancer, children }: { etat: EtatMaj; relancer: () => void; children: ReactNode }) {
  const { agir, ouvert, erreur } = useGesteTelephone();
  const horsLigne = useHorsLigne();
  const sur = useSupport();
  const maintenant = useHorloge();
  const [cherche, setCherche] = useState(false);
  const lieu = useLieuActif();
  const carte = carteMaj(etat, sur);
  return (
    <Pile className="gap-4">
      <div className="rounded-xl border border-bordure-subtile bg-fond-surface p-4 shadow-ombre-ambiante">
        <h2 className="text-body-s font-semibold text-texte-principal">{carte.titre}</h2>
        {carte.texte ? <p className="mt-1 text-ui text-texte-secondaire">{carte.texte}</p> : null}
      </div>
      <GroupeListe>
        <LigneListe id={ancreReglage("version-installee")} nom="Version installée" fin={<ValeurLigne>{etat.version}</ValeurLigne>} />
        <LigneListe id={ancreReglage("version-disponible")} nom="Dernière version" fin={<ValeurLigne>{etat.disponible ?? "Pas encore vérifiée"}</ValeurLigne>} />
        <LigneListe id={ancreReglage("derniere-verification")} nom="Dernière vérification" fin={<ValeurLigne>{etat.verifieeLe ? dateCourte(etat.verifieeLe, maintenant) : "Jamais"}</ValeurLigne>} />
      </GroupeListe>
      <div>
        <Bouton
          id={ancreReglage("rechercher-maj")}
          variant="blanc"
          taille="md"
          className="w-full"
          iconeGauche={<Icon name="refresh-01" size={20} />}
          disabled={!ouvert || horsLigne || !!lieu || cherche || etat.statut === "verification" || etat.statut === "telechargement"}
          onClick={() => {
            setCherche(true);
            void agir("reglages.verifierMaj", {}, undefined, { delai: 60_000 }).then((ok) => {
              setCherche(false);
              if (ok) relancer();
            });
          }}
        >
          {cherche ? "Recherche…" : "Rechercher une mise à jour"}
        </Bouton>
        <RaisonGeste ouvert={ouvert} horsLigne={horsLigne} />
        <ErreurGeste message={erreur?.message} className="mx-1 mt-2" />
      </div>
      {children}
    </Pile>
  );
}

export function MisesAJourTelephone() {
  const lecture = useLectureStable(useLecturePoste<EtatMaj | null>("reglages.majs", {}));
  return (
    <>
      <VueLecture lecture={lecture} lignes={3} ferme={ferme} gestes="Rechercher">
        {(etat) =>
          !etat ? (
            <Pile>
              <GroupeListe>
                <LigneListe nom="Les mises à jour ne se lisent pas sur cet ordinateur" />
              </GroupeListe>
            </Pile>
          ) : (
            <ContenuMaj etat={etat} relancer={lecture.relancer}>
              <LignesSurPoste section="mises-a-jour" />
            </ContenuMaj>
          )
        }
      </VueLecture>
      <Pile className="pt-4">
        {/* Les liens publics s'ouvrent d'ici, même sans ordinateur. */}
        <Liens />
      </Pile>
    </>
  );
}

