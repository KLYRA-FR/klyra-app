"use client";

import { useState, type FormEvent } from "react";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { ancreReglage } from "@/components/reglages/ui";
import { TEINTES } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { cn } from "@/lib/cn";
import { messageErreur, useCompte, useEquipe, useMonIdentite, type Invitation, type Membre, type Role } from "@/lib/compte";
import { compact } from "@/lib/consommation";
import { useLecturePoste } from "@/lib/poste/client";
import type { ResumeConsommation } from "@/lib/telephone/gestes-reglages";
import { NOMS_TEINTES } from "@/lib/telephone/reglages";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { CHAMP_TELEPHONE, ChampTelephone, ErreurGeste, ONGLETS_TELEPHONE } from "./CommunAgentsTelephone";
import { SuccesLigne } from "./Controles";
import { VueLecture } from "./etats";
import { ContenuConfirmation, Feuille, useFermerFeuille } from "./Feuille";
import { GroupeListe, LigneChoix, LigneListe, NoteListe, SectionListe, SousSection, ValeurLigne } from "./Liste";
import { useSupport } from "./poste";
import { LignesSurPoste, Pile, RondPersonne, useSucces } from "./ReglagesCommun";

/**
 * Les sections du compte (lot 8, E8-25 à E8-30) : elles passent par le compte et marchent ordinateur
 * fermé. Chaque succès vient de la réponse du compte. Les droits restent vérifiés par le serveur :
 * le téléphone ne cache que ce qu'un non-admin ne peut pas faire.
 */

const ferme = (sur: string) => `ta consommation se lit sur ${sur}. Elle s’affiche quand KLYRA y est ouverte.`;
const nomRole = (role: Role) => (role === "admin" ? "Admin" : "Membre");
const HORS_LIGNE = "Possible quand ce téléphone est en ligne.";

/* ─── Profil (E8-25) ───────────────────────────────────────────── */

export function ProfilTelephone() {
  const { moi } = useCompte();
  const { enregistrer } = useMonIdentite();
  const horsLigne = useHorsLigne();
  const [nom, setNom] = useState(moi?.nom ?? "");
  const [intitule, setIntitule] = useState(moi?.intitule ?? "");
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, montrerSucces] = useSucces();
  const [vue, setVue] = useState<"tout" | "klyra">("tout");
  const conso = useLecturePoste<ResumeConsommation | null>("reglages.consommation", { vue });
  const sur = useSupport();
  const modifie = nom !== (moi?.nom ?? "") || intitule !== (moi?.intitule ?? "");

  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    setOccupe(true);
    setErreur(null);
    try {
      await enregistrer(nom, intitule);
      montrerSucces("Enregistré pour toute l’équipe");
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setOccupe(false);
    }
  };

  return (
    <>
      <Pile>
        <form id={ancreReglage("nom")} className="klyra-reglage flex scroll-mt-4 flex-col gap-3.5" onSubmit={(e) => void envoyer(e)}>
          <ChampTelephone label="Nom" aide="Ce que l’équipe et les agents voient de toi.">
            <Input size="lg" value={nom} maxLength={80} autoComplete="name" onChange={(e) => setNom(e.target.value)} className={CHAMP_TELEPHONE} />
          </ChampTelephone>
          <ChampTelephone label="Rôle" aide="Facultatif : ton rôle dans le studio.">
            <Input size="lg" value={intitule} maxLength={80} onChange={(e) => setIntitule(e.target.value)} className={CHAMP_TELEPHONE} />
          </ChampTelephone>
          <div>
            <Bouton type="submit" variant={modifie ? "sombre" : "gris"} taille="md" className="w-full disabled:opacity-100 disabled:text-texte-tertiaire" disabled={!modifie || occupe || horsLigne}>
              {occupe ? "Enregistrement…" : "Enregistrer"}
            </Bouton>
            {horsLigne ? <NoteListe className="mt-1.5">{HORS_LIGNE}</NoteListe> : null}
            {succes ? <SuccesLigne className="mt-2">{succes}</SuccesLigne> : null}
            <ErreurGeste message={erreur} className="mt-2" />
          </div>
        </form>
        <LignesSurPoste section="profil" />
        <SectionListe titre={`Consommation sur ${sur}`}>
          <div id={ancreReglage("vue-consommation")} className="klyra-reglage scroll-mt-4">
            <Onglets
              libelle="Ce qui est compté"
              className={cn(ONGLETS_TELEPHONE, "mb-2.5")}
              valeur={vue}
              onChange={setVue}
              onglets={[
                { id: "tout", label: "Tout Claude Code" },
                { id: "klyra", label: "Seulement KLYRA" },
              ]}
            />
          </div>
        </SectionListe>
      </Pile>
      <VueLecture lecture={conso} lignes={3} ferme={ferme} forme="encadre">
        {(c) => (
          <Pile className="pt-0">
            {!c ? (
              <GroupeListe>
                <LigneListe nom={`Rien n’est encore compté sur ${sur}`} />
              </GroupeListe>
            ) : (
              <div id={ancreReglage("chiffres")} className="klyra-reglage flex scroll-mt-4 flex-col gap-5">
                <GroupeListe>
                  <LigneListe nom="Jetons sur un an" fin={<ValeurLigne>{c.jetons === null ? "Pas encore compté" : compact(c.jetons)}</ValeurLigne>} />
                  <LigneListe nom="Messages" fin={<ValeurLigne>{compact(c.messages)}</ValeurLigne>} />
                  <LigneListe nom="Jours actifs" fin={<ValeurLigne>{c.joursActifs}</ValeurLigne>} />
                  <LigneListe nom="Série actuelle" fin={<ValeurLigne>{`${c.serieActuelle} jour${c.serieActuelle > 1 ? "s" : ""}`}</ValeurLigne>} />
                  <LigneListe nom="Plus longue série" fin={<ValeurLigne>{`${c.plusLongueSerie} jour${c.plusLongueSerie > 1 ? "s" : ""}`}</ValeurLigne>} />
                  {c.coutUsd !== null ? <LigneListe nom="Coût renvoyé par Claude Code" fin={<ValeurLigne>{`${c.coutUsd.toFixed(2)} $`}</ValeurLigne>} /> : null}
                </GroupeListe>
                {c.modeles.length ? (
                  <SectionListe titre="Utilisation des modèles">
                    <div id={ancreReglage("modeles-utilisation")} className="klyra-reglage scroll-mt-4">
                      <GroupeListe>
                        {c.modeles.map((m) => (
                          <LigneListe key={m.nom} nom={m.nom} fin={<ValeurLigne>{compact(m.jetons)}</ValeurLigne>} />
                        ))}
                      </GroupeListe>
                    </div>
                  </SectionListe>
                ) : null}
              </div>
            )}
          </Pile>
        )}
      </VueLecture>
    </>
  );
}

/* ─── Équipe (E8-26 à E8-30) ───────────────────────────────────── */

/** La couleur d'équipe (E8-26) : enregistrée au toucher, dite en mots une fois le compte d'accord. */
function TaCouleur({ moi }: { moi: Membre }) {
  const { enregistrer } = useMonIdentite();
  const horsLigne = useHorsLigne();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [succes, montrerSucces] = useSucces();
  const choisir = async (t: RoleTeinte) => {
    if (t === moi.couleur || envoi) return;
    setEnvoi(t);
    setErreur(null);
    try {
      await enregistrer(moi.nom, moi.intitule, t);
      montrerSucces(`${NOMS_TEINTES[t]}, enregistré`);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setEnvoi(null);
    }
  };
  return (
    <SectionListe titre="Ta couleur">
      <SousSection>Elle marque tes rappels et tes événements dans l’équipe.</SousSection>
      <div id={ancreReglage("profil-equipe")} role="radiogroup" aria-label="Ta couleur" className="klyra-reglage grid scroll-mt-4 grid-cols-6 gap-1 rounded-xl border border-bordure-subtile bg-fond-surface p-2 shadow-ombre-xs">
        {ROLE_TEINTES.map((t) => {
          const choisie = moi.couleur === t;
          return (
            <button key={t} type="button" role="radio" aria-checked={choisie} aria-label={NOMS_TEINTES[t]} aria-busy={envoi === t || undefined} disabled={envoi !== null || horsLigne} onClick={() => void choisir(t)} className="flex h-11 items-center justify-center rounded-sm disabled:opacity-60">
              <span
                className={cn("flex size-[30px] items-center justify-center rounded-xs text-icone-defaut shadow-[inset_0_0_0_1px_rgba(0,0,0,0.04)]", choisie && "shadow-[0_0_0_2px_var(--color-fond-surface),0_0_0_4px_var(--color-focus)]")}
                style={{ background: TEINTES[t] }}
              >
                {choisie ? <Icon name="check-01" size={16} /> : null}
              </span>
            </button>
          );
        })}
      </div>
      {horsLigne ? <NoteListe>{HORS_LIGNE}</NoteListe> : null}
      {succes ? <SuccesLigne className="mx-1 mt-2">{succes}</SuccesLigne> : null}
      <ErreurGeste message={erreur} className="mx-1 mt-2" />
    </SectionListe>
  );
}

/** Le menu d'un membre (E8-28, E8-29) : son rôle en choix unique, puis retirer, changé en confirmation dans la même feuille. */
function MenuMembre({ membre, onFermer }: { membre: Membre; onFermer: () => void }) {
  const { changerRole, retirer } = useEquipe(true);
  const horsLigne = useHorsLigne();
  const annoncer = useAnnonce();
  const [confirmer, setConfirmer] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState<Role | null>(null);

  const retirerMembre = async () => {
    try {
      await retirer({ membreId: membre._id });
      annoncer(`${membre.nom} ne fait plus partie de l’équipe.`);
    } catch (x) {
      annoncer({ texte: messageErreur(x), erreur: true });
    }
  };

  if (confirmer) {
    return (
      <Feuille titre={`Retirer ${membre.nom} de l’équipe ?`} role="alertdialog" sansEnTete onFermer={onFermer}>
        <ContenuConfirmation texte="Ses sessions se ferment et l’adresse ne peut plus se connecter. Un admin peut l’inviter de nouveau." confirmer="Retirer" onConfirmer={() => void retirerMembre()} />
      </Feuille>
    );
  }
  return (
    <Feuille titre={membre.nom} objet={{ visuel: <RondPersonne nom={membre.nom} couleur={membre.couleur} taille={44} />, sous: membre.email }} onFermer={onFermer}>
      <p className="mx-1 mt-1 mb-0.5 text-ui-xs text-texte-secondaire">Rôle</p>
      <ul role="radiogroup" aria-label={`Rôle de ${membre.nom}`} className="-mx-4 flex flex-col">
        {(["membre", "admin"] as const).map((role) => (
          <li key={role}>
            <button
              type="button"
              role="radio"
              aria-checked={membre.role === role}
              aria-busy={envoi === role || undefined}
              disabled={envoi !== null || horsLigne}
              onClick={() => {
                if (membre.role === role) return;
                setEnvoi(role);
                setErreur(null);
                void changerRole({ membreId: membre._id, role })
                  .catch((x: unknown) => setErreur(messageErreur(x)))
                  .finally(() => setEnvoi(null));
              }}
              className="flex min-h-[52px] w-full items-center gap-3.5 px-5 py-1.5 text-left text-body-s text-texte-principal transition-colors duration-[120ms] ease-sortie active:bg-fond-survol disabled:text-texte-tertiaire"
            >
              <Icon name={role === "admin" ? "shield-check" : "users-profiles-01"} size={20} className="shrink-0 text-icone-defaut" />
              <span className="min-w-0 flex-1">
                {nomRole(role)}
                {role === "admin" ? <span className="mt-0.5 block text-ui-xs text-texte-secondaire">Invite, change les rôles, retire des personnes.</span> : null}
              </span>
              {envoi === role ? <span className="text-ui text-texte-secondaire">Envoi…</span> : membre.role === role ? <Icon name="check-01" size={24} className="shrink-0 text-icone-accent" /> : null}
            </button>
          </li>
        ))}
      </ul>
      <ErreurGeste message={erreur} className="mx-1 mt-2" />
      {horsLigne ? <NoteListe>{HORS_LIGNE}</NoteListe> : null}
      <div aria-hidden="true" className="mx-1 my-1.5 h-px bg-bordure-defaut" />
      <button
        type="button"
        disabled={horsLigne}
        onClick={() => setConfirmer(true)}
        className="-mx-4 flex min-h-[52px] w-[calc(100%+32px)] items-center gap-3.5 px-5 py-1.5 text-left text-body-s text-texte-erreur transition-colors duration-[120ms] ease-sortie active:bg-fond-survol disabled:text-texte-tertiaire"
      >
        <Icon name="x-01" size={20} className="shrink-0" />
        Retirer de l’équipe…
      </button>
    </Feuille>
  );
}

/** Inviter quelqu'un (E8-30) : la saisie reste en cas d'erreur, l'erreur du compte sous le champ, et on annonce une invitation, pas un membre. */
function FeuilleInviter({ onFermer }: { onFermer: () => void }) {
  return (
    <Feuille titre="Inviter quelqu’un" onFermer={onFermer} pied={<BoutonInviter />}>
      <FormulaireInviter />
    </Feuille>
  );
}

const ID_INVITER = "klyra-inviter";

function BoutonInviter() {
  return (
    <Bouton type="submit" form={ID_INVITER} variant="sombre" taille="md" className="w-full">
      Inviter
    </Bouton>
  );
}

function FormulaireInviter() {
  const { inviter } = useEquipe(true);
  const fermer = useFermerFeuille();
  const annoncer = useAnnonce();
  const horsLigne = useHorsLigne();
  const [email, setEmail] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<Role>("membre");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    if (enCours) return;
    if (horsLigne) return setErreur(HORS_LIGNE);
    if (!email.trim() || !nom.trim()) return setErreur("Une adresse et un nom sont nécessaires.");
    setErreur(null);
    setEnCours(true);
    try {
      await inviter({ email, nom, role });
      annoncer(`Invitation prête pour ${nom.trim()}.`);
      fermer();
    } catch (x) {
      setErreur(messageErreur(x));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <form id={ID_INVITER} noValidate className="flex flex-col gap-3.5 pt-1" aria-busy={enCours || undefined} onSubmit={(e) => void envoyer(e)}>
      <ChampTelephone label="Adresse e-mail" erreur={erreur}>
        <Input size="lg" type="email" autoComplete="off" autoCapitalize="off" value={email} aria-invalid={erreur ? true : undefined} onChange={(e) => setEmail(e.target.value)} className={CHAMP_TELEPHONE} />
      </ChampTelephone>
      <ChampTelephone label="Nom">
        <Input size="lg" autoComplete="off" value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)} className={CHAMP_TELEPHONE} />
      </ChampTelephone>
      <div>
        <p className="mb-2 text-ui font-medium text-texte-principal">Rôle</p>
        <div role="radiogroup" aria-label="Rôle">
          <GroupeListe>
            <LigneChoix nom="Membre" choisi={role === "membre"} onChoisir={() => setRole("membre")} />
            <LigneChoix nom="Admin" ligne2="Invite, change les rôles, retire des personnes" choisi={role === "admin"} onChoisir={() => setRole("admin")} />
          </GroupeListe>
        </div>
      </div>
    </form>
  );
}

function Invitations({ invitations, annuler }: { invitations: Invitation[] | undefined; annuler: (id: Invitation["_id"]) => Promise<unknown> }) {
  const horsLigne = useHorsLigne();
  const [envoi, setEnvoi] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [inviter, setInviter] = useState(false);
  return (
    <SectionListe titre="Invitations" compte={invitations?.length}>
      <SousSection>Une adresse invitée demande un lien de connexion. Elle devient membre à sa première connexion.</SousSection>
      <div id={ancreReglage("invitations")} className="klyra-reglage scroll-mt-4">
        {invitations === undefined ? (
          <div aria-busy="true" className="h-14 rounded-xl bg-fond-surface-grise motion-safe:animate-pulse" />
        ) : invitations.length === 0 ? (
          <GroupeListe>
            <LigneListe nom="Aucune invitation en attente" />
          </GroupeListe>
        ) : (
          <GroupeListe>
            {invitations.map((i) => (
              <LigneListe
                key={i._id}
                debut={<RondPersonne nom={i.nom} />}
                retrait="avatar"
                nom={i.nom}
                ligne2={`${i.email} · ${nomRole(i.role)}`}
                uneLigne
                fin={
                  <Bouton
                    variant="blanc"
                    taille="compact"
                    disabled={envoi !== null || horsLigne}
                    className="relative after:absolute after:inset-x-0 after:-inset-y-1.5"
                    aria-label={`Annuler l’invitation de ${i.nom}`}
                    onClick={() => {
                      setEnvoi(i._id);
                      setErreur(null);
                      void annuler(i._id)
                        .catch((x: unknown) => setErreur(messageErreur(x)))
                        .finally(() => setEnvoi(null));
                    }}
                  >
                    {envoi === i._id ? "Envoi…" : "Annuler"}
                  </Bouton>
                }
              />
            ))}
          </GroupeListe>
        )}
      </div>
      <ErreurGeste message={erreur} className="mx-1 mt-2" />
      <div id={ancreReglage("inviter")} className="klyra-reglage mt-3 scroll-mt-4">
        <Bouton variant="blanc" taille="md" className="w-full" disabled={horsLigne} iconeGauche={<Icon name="plus-01" size={20} />} onClick={() => setInviter(true)}>
          Inviter quelqu’un
        </Bouton>
      </div>
      {horsLigne ? <NoteListe>{HORS_LIGNE}</NoteListe> : null}
      {inviter ? <FeuilleInviter onFermer={() => setInviter(false)} /> : null}
    </SectionListe>
  );
}

function Membres({ moi, membres, onMenu }: { moi: Membre; membres: Membre[] | undefined; onMenu: (m: Membre) => void }) {
  const admin = moi.role === "admin";
  return (
    <SectionListe titre="Membres de l’équipe" compte={membres?.length}>
      {admin ? <SousSection>Tu es admin : tu invites, changes les rôles et retires des personnes.</SousSection> : null}
      <div id={ancreReglage("membres")} className="klyra-reglage scroll-mt-4">
        {membres === undefined ? (
          <div aria-busy="true" className="h-[72px] rounded-xl bg-fond-surface-grise motion-safe:animate-pulse" />
        ) : (
          <GroupeListe>
            {membres.map((m) => {
              const moiMeme = m._id === moi._id;
              return (
                <LigneListe
                  key={m._id}
                  debut={<RondPersonne nom={m.nom} couleur={m.couleur} />}
                  retrait="avatar"
                  nom={m.nom}
                  meta={moiMeme ? "toi" : undefined}
                  ligne2={[m.intitule, m.email].filter(Boolean).join(" · ")}
                  uneLigne
                  fin={<ValeurLigne>{nomRole(m.role)}</ValeurLigne>}
                  onMenu={admin && !moiMeme ? () => onMenu(m) : undefined}
                  menuVisible
                />
              );
            })}
          </GroupeListe>
        )}
      </div>
      {admin ? null : <NoteListe>Seuls les admins gèrent l’équipe : les rôles se lisent, sans action.</NoteListe>}
    </SectionListe>
  );
}

export function EquipeTelephone() {
  const { moi } = useCompte();
  const admin = moi?.role === "admin";
  const { membres, invitations, annulerInvitation } = useEquipe(admin);
  const [menu, setMenu] = useState<Membre["_id"] | null>(null);
  /* Le membre est relu à chaque changement : la coche suit le rôle confirmé par le compte. */
  const membreMenu = membres?.find((m) => m._id === menu) ?? null;
  if (!moi) return null;
  return (
    <Pile>
      <SectionListe titre="Compte">
        <div id={ancreReglage("compte-equipe")} className="klyra-reglage scroll-mt-4">
          <GroupeListe>
            <LigneListe debut={<RondPersonne nom={moi.nom} couleur={moi.couleur} />} retrait="avatar" nom={moi.nom} ligne2={`${moi.email} · ${nomRole(moi.role)}`} uneLigne />
          </GroupeListe>
        </div>
      </SectionListe>
      <TaCouleur key={moi.couleur} moi={moi} />
      <Membres moi={moi} membres={membres} onMenu={(m) => setMenu(m._id)} />
      {admin ? <Invitations invitations={invitations} annuler={(id) => annulerInvitation({ invitationId: id })} /> : null}
      {membreMenu ? <MenuMembre membre={membreMenu} onFermer={() => setMenu(null)} /> : null}
    </Pile>
  );
}
