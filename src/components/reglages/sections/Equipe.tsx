"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Input } from "klyra-ui";
import { TEINTES } from "@/components/team/AgentVisuel";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { cn } from "@/lib/cn";
import { formaterAttente, messageErreur, useCompte, useEquipe, useMonIdentite, type Membre, type Role } from "@/lib/compte";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";
import { AccordProfils } from "../AccordProfils";
import { Erreur, Groupe, Ligne, SeulementBureau, Valeur } from "../ui";

const ROLES: { value: Role; label: string }[] = [
  { value: "admin", label: "Admin" },
  { value: "membre", label: "Membre" },
];
const nomRole = (role: Role) => (role === "admin" ? "Admin" : "Membre");

function Pastille({ couleur }: { couleur: string }) {
  const teinte = (ROLE_TEINTES as string[]).includes(couleur) ? (couleur as RoleTeinte) : "bleu-k1";
  return <span aria-hidden="true" className="size-3 shrink-0 rounded-full" style={{ background: TEINTES[teinte] }} />;
}

/** L'heure de cet ordinateur, mise à jour chaque seconde jusqu'à `jusqua` (un compte à rebours). */
function useMaintenant(jusqua: number | null): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (jusqua === null) return;
    const tic = () => setMaintenant(Date.now());
    const premier = setTimeout(tic, 0);
    const minuteur = setInterval(() => {
      tic();
      if (Date.now() >= jusqua) clearInterval(minuteur);
    }, 1000);
    return () => {
      clearTimeout(premier);
      clearInterval(minuteur);
    };
  }, [jusqua]);
  return maintenant;
}

/** Pas encore connecté : l'adresse, puis le lien reçu par e-mail. */
function Connexion() {
  const { adresseEnAttente, prochaineDemande, demandeRefusee, occupe, erreur, demanderLien, ouvrirLienColle, oublierAdresse } = useCompte();
  const [email, setEmail] = useState("");
  const [lien, setLien] = useState("");
  const maintenant = useMaintenant(prochaineDemande);
  /* Le serveur garde le délai ; ce compte à rebours ne fait que l'annoncer. */
  const attente = prochaineDemande === null ? 0 : Math.max(0, prochaineDemande - maintenant);

  const demander = (e: FormEvent) => {
    e.preventDefault();
    void demanderLien(email);
  };

  if (adresseEnAttente) {
    return (
      <Groupe titre="Connexion">
        <Ligne
          id="compte-equipe"
          libelle={
            demandeRefusee
              ? `Si ${adresseEnAttente} est invitée, un lien lui a été envoyé il y a peu`
              : `Si ${adresseEnAttente} est invitée, un lien vient de partir`
          }
          description={`Ouvre-le sur cet ordinateur : il ouvre KLYRA et te connecte. Il vaut 15 minutes et ne sert qu’une fois. ${
            attente > 0
              ? `Tu pourras en demander un autre dans ${formaterAttente(attente)} (un par minute, cinq par heure au plus).`
              : "Tu peux en demander un autre."
          }`}
        >
          <Bouton variant="discret" taille="compact" disabled={occupe || attente > 0} onClick={() => void demanderLien(adresseEnAttente)}>
            {attente > 0 ? `Renvoyer dans ${formaterAttente(attente)}` : "Renvoyer"}
          </Bouton>
          <Bouton variant="discret" taille="compact" disabled={occupe} onClick={oublierAdresse}>
            Changer d’adresse
          </Bouton>
        </Ligne>
        <Ligne libelle="L’app ne s’est pas ouverte ?" description="Colle ici le lien de l’e-mail, ou celui de la page qui s’est ouverte dans le navigateur." pile>
          <form
            className="flex w-full flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void ouvrirLienColle(lien).then(() => setLien(""));
            }}
          >
            <Input
              size="sm"
              autoComplete="off"
              value={lien}
              placeholder="klyra://connexion?code=…"
              onChange={(e) => setLien(e.target.value)}
              className={cn(CHAMP, "klyra-mono min-w-0 flex-1")}
              aria-label="Lien de connexion"
            />
            <Bouton type="submit" variant="sombre" taille="compact" disabled={!lien.trim() || occupe}>
              {occupe ? "Connexion…" : "Se connecter"}
            </Bouton>
          </form>
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>
    );
  }

  return (
    <Groupe titre="Connexion" description="Les rappels et le calendrier partagés passent par ton compte d’équipe. Tes conversations, tes fichiers et tes clés restent sur cet ordinateur.">
      <Ligne id="compte-equipe" libelle="Ton adresse e-mail" description="L’adresse qu’un admin a invitée dans l’équipe. Tu reçois un lien de connexion, sans mot de passe." pile>
        <form className="flex w-full flex-wrap items-center gap-2" onSubmit={demander}>
          <Input
            size="sm"
            type="email"
            autoComplete="email"
            value={email}
            placeholder="prenom@klyra.design"
            onChange={(e) => setEmail(e.target.value)}
            className={cn(CHAMP, "min-w-0 flex-1")}
            aria-label="Adresse e-mail"
          />
          <BoutonPrincipal type="submit" disabled={!email.trim() || occupe}>
            {occupe ? "Envoi…" : "Recevoir un lien"}
          </BoutonPrincipal>
        </form>
      </Ligne>
      {erreur && <Erreur>{erreur}</Erreur>}
    </Groupe>
  );
}

function MonProfil({ moi }: { moi: Membre }) {
  /* Le même nom et le même rôle que Réglages › Profil : enregistrés sur le compte, puis sur cet ordinateur. */
  const { enregistrer: enregistrerIdentite } = useMonIdentite();
  const [nom, setNom] = useState(moi.nom);
  const [intitule, setIntitule] = useState(moi.intitule);
  const [couleur, setCouleur] = useState(moi.couleur);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const modifie = nom !== moi.nom || intitule !== moi.intitule || couleur !== moi.couleur;

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await enregistrerIdentite(nom, intitule, couleur);
    } catch (x) {
      setErreur(x instanceof Error ? x.message : String(x));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Groupe
      titre="Ton profil d’équipe"
      description="Ce que l’équipe voit de toi, et les agents aussi : le même nom et le même rôle que dans Profil. Ta couleur marquera tes rappels et tes événements."
    >
      <form id="reglage-profil-equipe" className="klyra-reglage -mx-4 flex scroll-mt-6 flex-col gap-4 px-4 py-4" onSubmit={(e) => void enregistrer(e)}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Champ label="Nom">
            <Input size="sm" value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
          </Champ>
          <Champ label="Intitulé" aide="Facultatif : ton rôle dans le studio.">
            <Input size="sm" value={intitule} maxLength={80} onChange={(e) => setIntitule(e.target.value)} className={CHAMP} />
          </Champ>
        </div>
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="mb-2 text-ui-s font-medium text-texte-principal">Couleur</legend>
          <div role="radiogroup" className="flex flex-wrap gap-2">
            {ROLE_TEINTES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={couleur === t}
                aria-label={t}
                title={t}
                onClick={() => setCouleur(t)}
                className={cn(
                  "flex size-8 cursor-pointer items-center justify-center rounded-xs border bg-fond-surface p-0",
                  couleur === t ? "border-focus" : "border-bordure-subtile hover:border-bordure-forte",
                )}
              >
                <span className="size-4 rounded-[3px]" style={{ background: TEINTES[t] }} />
              </button>
            ))}
          </div>
        </fieldset>
        <div className="flex items-center gap-2">
          <Bouton type="submit" variant="sombre" taille="compact" disabled={!modifie || enCours}>
            {enCours ? "Enregistrement…" : "Enregistrer"}
          </Bouton>
          {erreur && <Erreur>{erreur}</Erreur>}
        </div>
      </form>
    </Groupe>
  );
}

function Membres({ moi }: { moi: Membre }) {
  const admin = moi.role === "admin";
  const { membres, changerRole, retirer } = useEquipe(admin);
  const [demander, fenetre] = useConfirmation();
  const [erreur, setErreur] = useState<string | null>(null);

  const agir = async (action: () => Promise<unknown>) => {
    setErreur(null);
    try {
      await action();
    } catch (x) {
      setErreur(messageErreur(x));
    }
  };

  const retirerMembre = async (m: Membre) => {
    const oui = await demander({
      titre: `Retirer ${m.nom} de l’équipe ?`,
      texte: "Ses sessions se ferment et l’adresse ne peut plus se connecter. Un admin peut l’inviter de nouveau.",
      confirmer: "Retirer",
    });
    if (oui) await agir(() => retirer({ membreId: m._id }));
  };

  return (
    <Groupe titre="Membres de l’équipe" description={admin ? "Tu es admin : tu invites, changes les rôles et retires des personnes." : "Seuls les admins gèrent l’équipe."}>
      <div id="reglage-membres" className="klyra-reglage -mx-4 flex scroll-mt-6 flex-col divide-y divide-bordure-subtile">
        {membres === undefined && <Ligne libelle="Chargement de l’équipe…" />}
        {membres?.map((m) => (
          <div key={m._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <Pastille couleur={m.couleur} />
            <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
              <span className="text-ui-s font-medium text-texte-principal">
                {m.nom}
                {m._id === moi._id && <span className="text-texte-tertiaire"> · toi</span>}
              </span>
              <span className="truncate text-ui-xs text-texte-tertiaire">{[m.intitule, m.email].filter(Boolean).join(" · ")}</span>
            </div>
            {admin ? (
              <>
                <ListeDeroulante
                  variante="compact"
                  libelle={`Rôle de ${m.nom}`}
                  options={ROLES}
                  value={m.role}
                  onChange={(role) => void agir(() => changerRole({ membreId: m._id, role }))}
                />
                {m._id !== moi._id && (
                  <Bouton variant="discret" taille="compact" onClick={() => void retirerMembre(m)}>
                    Retirer
                  </Bouton>
                )}
              </>
            ) : (
              <Valeur>{nomRole(m.role)}</Valeur>
            )}
          </div>
        ))}
      </div>
      {erreur && <Erreur>{erreur}</Erreur>}
      {fenetre}
    </Groupe>
  );
}

function Invitations() {
  const { invitations, inviter, annulerInvitation } = useEquipe(true);
  const [email, setEmail] = useState("");
  const [nom, setNom] = useState("");
  const [role, setRole] = useState<Role>("membre");
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);

  const envoyer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    setEnCours(true);
    try {
      await inviter({ email, nom, role });
      setEmail("");
      setNom("");
    } catch (x) {
      setErreur(messageErreur(x));
    } finally {
      setEnCours(false);
    }
  };

  return (
    <Groupe titre="Invitations" description="Une adresse invitée peut demander un lien de connexion. Elle devient membre à sa première connexion.">
      <form id="reglage-inviter" className="klyra-reglage -mx-4 flex scroll-mt-6 flex-wrap items-end gap-3 px-4 py-4" onSubmit={(e) => void envoyer(e)}>
        <Champ label="Adresse e-mail" className="min-w-[200px] flex-1">
          <Input size="sm" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Nom" className="min-w-[140px] flex-1">
          <Input size="sm" autoComplete="off" value={nom} maxLength={80} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Rôle">
          <ListeDeroulante options={ROLES} value={role} onChange={setRole} />
        </Champ>
        <Bouton type="submit" variant="sombre" taille="md" disabled={!email.trim() || !nom.trim() || enCours}>
          {enCours ? "Invitation…" : "Inviter"}
        </Bouton>
        {erreur && <Erreur>{erreur}</Erreur>}
      </form>
      <div id="reglage-invitations" className="klyra-reglage -mx-4 flex scroll-mt-6 flex-col divide-y divide-bordure-subtile">
        {invitations?.length === 0 && <Ligne libelle="Aucune invitation en attente" />}
        {invitations?.map((i) => (
          <div key={i._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="flex min-w-[180px] flex-1 flex-col gap-0.5">
              <span className="text-ui-s font-medium text-texte-principal">{i.nom}</span>
              <span className="truncate text-ui-xs text-texte-tertiaire">
                {i.email} · {nomRole(i.role)}
              </span>
            </div>
            <Bouton
              variant="discret"
              taille="compact"
              onClick={() => void annulerInvitation({ invitationId: i._id }).catch((x: unknown) => setErreur(messageErreur(x)))}
            >
              Annuler
            </Bouton>
          </div>
        ))}
      </div>
    </Groupe>
  );
}

export function Equipe() {
  const { etat, moi, occupe, erreur, seDeconnecter } = useCompte();

  if (etat === "indisponible") {
    return (
      <Groupe>
        <Ligne id="compte-equipe" libelle="Compte d’équipe">
          <SeulementBureau>Le compte d’équipe se règle dans l’app de bureau.</SeulementBureau>
        </Ligne>
      </Groupe>
    );
  }
  if (etat === "chargement" || (occupe && etat !== "deconnecte")) {
    return (
      <Groupe>
        <Ligne id="compte-equipe" libelle="Connexion à l’équipe…" />
      </Groupe>
    );
  }
  if (etat === "deconnecte") return <Connexion />;
  if (etat === "retire" || !moi) {
    return (
      <Groupe>
        <Ligne id="compte-equipe" libelle="Ce compte ne fait plus partie de l’équipe" description="Demande à un admin de t’inviter de nouveau.">
          <Bouton variant="blanc" taille="compact" onClick={() => void seDeconnecter()}>
            Se déconnecter
          </Bouton>
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>
    );
  }

  return (
    <>
      <Groupe titre="Compte">
        <Ligne id="compte-equipe" libelle={moi.nom} description={`${moi.email} · ${nomRole(moi.role)}`}>
          <Bouton variant="blanc" taille="compact" onClick={() => void seDeconnecter()}>
            Se déconnecter
          </Bouton>
        </Ligne>
      </Groupe>
      <AccordProfils />
      <MonProfil key={`${moi.nom}|${moi.intitule}|${moi.couleur}`} moi={moi} />
      <Membres moi={moi} />
      {moi.role === "admin" && <Invitations />}
    </>
  );
}
