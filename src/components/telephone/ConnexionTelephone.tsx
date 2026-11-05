"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { formaterAttente, useCompte } from "@/lib/compte";
import { texteDeconnecte } from "@/lib/poste-texte";
import { posteRetenu } from "./poste";
import { Bandeau, CHAMP_TELEPHONE, MessageErreur } from "./Controles";

const CHAMP = CHAMP_TELEPHONE;
const ADRESSE_VALABLE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Logo() {
  return <Image src="/brand/logotype-generic.svg" alt="KLYRA" width={125} height={32} priority />;
}

/** Le séparateur entre l'adresse et le lien à coller. */
function Ou({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-ui-xs text-texte-secondaire before:h-px before:flex-1 before:bg-bordure-defaut after:h-px after:flex-1 after:bg-bordure-defaut">
      {children}
    </div>
  );
}

/**
 * T-00, E8-50 à E8-55. Le champ « Lien de connexion » reste visible : l'app installée peut ne pas
 * partager le stockage de Safari. Une erreur s'écrit sous le champ qui la cause, la saisie reste ; le
 * même message vaut pour toute adresse ; le lien collé ne s'écrit nulle part ailleurs que dans son champ.
 */
export function ConnexionTelephone() {
  const compte = useCompte();
  const [email, setEmail] = useState("");
  const [lien, setLien] = useState("");
  const [attente, setAttente] = useState(0);
  const [erreurAdresse, setErreurAdresse] = useState<string | null>(null);
  /* Le dernier geste : l'erreur du compte s'écrit sous le champ qui l'a causée. */
  const [geste, setGeste] = useState<"adresse" | "lien" | null>(null);
  const champAdresse = useRef<HTMLInputElement | null>(null);
  const champLien = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!compte.prochaineDemande) return;
    const lire = () => setAttente(Math.max(0, compte.prochaineDemande! - Date.now()));
    lire();
    const id = setInterval(lire, 1000);
    return () => clearInterval(id);
  }, [compte.prochaineDemande]);

  const enAttente = compte.adresseEnAttente;
  const adresse = enAttente ?? email;
  const connexionEnCours = compte.occupe && geste === "lien";
  const erreurLien = geste === "lien" ? compte.erreur : null;
  const erreurDemande = geste === "lien" ? null : (erreurAdresse ?? compte.erreur);

  /* Le focus va au premier champ invalide (E8-53). */
  useEffect(() => {
    if (erreurLien) champLien.current?.focus();
    else if (erreurDemande) champAdresse.current?.focus();
  }, [erreurLien, erreurDemande]);

  const demander = (e: FormEvent) => {
    e.preventDefault();
    setGeste("adresse");
    if (!ADRESSE_VALABLE.test(adresse.trim())) {
      setErreurAdresse("Cette adresse e-mail n’est pas valable.");
      champAdresse.current?.focus();
      return;
    }
    setErreurAdresse(null);
    void compte.demanderLien(adresse);
  };

  const coller = async () => {
    try {
      const texte = await navigator.clipboard.readText();
      setLien(texte);
    } catch {
      /* Le champ reste éditable à la main. */
    }
  };

  const changerAdresse = () => {
    compte.oublierAdresse();
    setEmail(enAttente ?? email);
    setGeste(null);
    setErreurAdresse(null);
    setTimeout(() => champAdresse.current?.focus(), 0);
  };

  if (compte.etat === "chargement") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-sm flex-col gap-6 px-6 pt-6 pb-8">
          <Logo />
          <p role="status" className="flex items-center gap-2 text-body-s text-texte-principal">
            <Icon name="loader-01" size={20} className="shrink-0 text-icone-secondaire" />
            Connexion à l’équipe…
          </p>
        </div>
      </div>
    );
  }
  if (compte.etat === "retire") {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-sm flex-col px-6 pt-6 pb-8">
          <Logo />
          <div role="status" className="flex flex-col items-center px-2 pt-16 text-center">
            <span aria-hidden="true" className="mb-4 flex size-12 items-center justify-center rounded-full border border-bordure-defaut bg-fond-surface text-icone-secondaire">
              <Icon name="users-profiles-01" size={24} />
            </span>
            <h1 className="text-body-s font-semibold text-texte-principal">Ce compte ne fait plus partie de l’équipe</h1>
            <p className="mt-1.5 max-w-[290px] text-ui text-texte-secondaire">Demande à un admin de t’inviter de nouveau. Tu pourras alors te reconnecter avec un nouveau lien.</p>
            <Bouton variant="sombre" taille="md" className="mt-5" onClick={() => void compte.seDeconnecter()}>
              Se déconnecter de ce téléphone
            </Bouton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex w-full max-w-sm flex-col gap-[18px] px-6 pt-6 pb-8">
        <Logo />
        {/* Déconnecté depuis Réglages › Mobile : pas « retiré de l'équipe » (MO-T14). */}
        {compte.sessionFermee ? (
          <div role="status">
            <Bandeau ton="attente" icone="lock-01">
              {texteDeconnecte(posteRetenu())}
            </Bandeau>
          </div>
        ) : null}
        <h1 className="mt-1.5 text-h3 leading-[1.05] font-semibold tracking-title text-texte-principal">Connecte-toi à KLYRA</h1>
        {!enAttente && !compte.sessionFermee && !lien ? <p className="-mt-2 text-ui leading-[1.45] text-texte-secondaire">Avec l’adresse que ton équipe a invitée. Pas de mot de passe : un lien arrive par e-mail.</p> : null}
        <form onSubmit={demander} noValidate className="flex flex-col gap-[18px]">
          <label className="flex flex-col gap-2 text-ui font-medium text-texte-principal">
            Ton adresse e-mail
            <input
              ref={champAdresse}
              type="email"
              autoComplete="email"
              aria-label="Adresse e-mail"
              aria-invalid={erreurDemande ? true : undefined}
              placeholder="prenom@klyra.design"
              readOnly={!!enAttente}
              value={adresse}
              onChange={(e) => {
                setEmail(e.target.value);
                setErreurAdresse(null);
              }}
              className={`${CHAMP} font-normal`}
            />
            {erreurDemande ? <MessageErreur className="font-normal">{erreurDemande}</MessageErreur> : null}
          </label>
          {enAttente ? (
            <>
              <div role="status">
                <Bandeau ton="info" icone="check-01">
                  {compte.demandeRefusee ? `Si ${enAttente} est invitée, un lien lui a été envoyé il y a peu.` : `Si ${enAttente} est invitée, un lien vient de partir.`} Ouvre l’e-mail sur ce téléphone : le lien vaut 15 minutes.
                </Bandeau>
              </div>
              <div className="-mt-1.5 flex gap-2">
                <Bouton type="submit" variant={attente > 0 ? "gris" : "blanc"} taille="md" className="klyra-mono min-w-0 flex-1 px-2 disabled:text-texte-tertiaire disabled:opacity-100" disabled={compte.occupe || attente > 0}>
                  {compte.occupe && geste === "adresse" ? "Envoi…" : attente > 0 ? `Renvoyer dans ${formaterAttente(attente)}` : "Renvoyer"}
                </Bouton>
                <Bouton variant="discret" taille="md" className="min-w-0 flex-1 px-2" onClick={changerAdresse}>
                  Changer d’adresse
                </Bouton>
              </div>
            </>
          ) : (
            <BoutonPrincipal type="submit" disabled={compte.occupe || attente > 0}>
              {compte.occupe && geste !== "lien" ? "Envoi…" : attente > 0 ? `Renvoyer dans ${formaterAttente(attente)}` : "Recevoir un lien"}
            </BoutonPrincipal>
          )}
        </form>
        <Ou>{enAttente ? "Le lien s’est ouvert ailleurs ?" : "Tu as déjà le lien ?"}</Ou>
        <form
          className="flex flex-col gap-[18px]"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            if (connexionEnCours) return;
            setGeste("lien");
            void compte.ouvrirLienColle(lien);
          }}
        >
          <div className="flex flex-col gap-2">
            <label htmlFor="klyra-lien-connexion" className="text-ui font-medium text-texte-principal">
              Lien de connexion
            </label>
            <span className="flex gap-2">
              <input
                ref={champLien}
                id="klyra-lien-connexion"
                aria-label="Lien de connexion"
                aria-invalid={erreurLien ? true : undefined}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                placeholder="Colle le lien de l’e-mail"
                value={lien}
                onChange={(e) => setLien(e.target.value)}
                className={`${CHAMP} min-w-0 flex-1 text-ellipsis`}
              />
              <Bouton type="button" variant="blanc" taille="md" className="h-12 px-3.5" onClick={() => void coller()}>
                Coller
              </Bouton>
            </span>
            {erreurLien ? (
              <MessageErreur>{erreurLien}</MessageErreur>
            ) : (
              <span className="text-ui-xs text-texte-secondaire">{enAttente ? "Copie-le dans ton navigateur ou dans l’e-mail, puis colle-le ici." : "Le lien s’est ouvert dans ton navigateur et pas dans l’app ? Copie-le et colle-le ici."}</span>
            )}
          </div>
          {connexionEnCours ? (
            <Bouton variant="gris" taille="md" className="w-full disabled:text-texte-tertiaire disabled:opacity-100" disabled iconeGauche={<Icon name="loader-01" size={20} />}>
              Connexion à l’équipe…
            </Bouton>
          ) : (
            <Bouton type="submit" variant={enAttente || lien ? "sombre" : "blanc"} taille="md" className="w-full">
              Se connecter
            </Bouton>
          )}
        </form>
        {erreurLien ? (
          <Bouton
            variant="discret"
            taille="md"
            className="-mt-2.5 w-full"
            onClick={() => {
              setGeste(null);
              setLien("");
              setTimeout(() => champAdresse.current?.focus(), 0);
            }}
          >
            Demander un nouveau lien
          </Bouton>
        ) : null}
      </div>
    </div>
  );
}
