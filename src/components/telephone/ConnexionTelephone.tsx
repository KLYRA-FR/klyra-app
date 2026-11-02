"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { formaterAttente, useCompte } from "@/lib/compte";
import { texteDeconnecte } from "@/lib/poste-texte";
import { posteRetenu } from "./poste";

const CHAMP = "h-12 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 text-body-s text-texte-principal";

/** T-00. Le champ « Lien de connexion » reste visible : l'app installée peut ne pas partager le stockage de Safari. */
export function ConnexionTelephone() {
  const compte = useCompte();
  const [email, setEmail] = useState("");
  const [lien, setLien] = useState("");
  const [attente, setAttente] = useState(0);

  useEffect(() => {
    if (!compte.prochaineDemande) return;
    const lire = () => setAttente(Math.max(0, compte.prochaineDemande! - Date.now()));
    lire();
    const id = setInterval(lire, 1000);
    return () => clearInterval(id);
  }, [compte.prochaineDemande]);

  const demander = (e: FormEvent) => {
    e.preventDefault();
    void compte.demanderLien(email);
  };

  const coller = async () => {
    try {
      const texte = await navigator.clipboard.readText();
      setLien(texte);
    } catch {
      /* Le champ reste éditable à la main. */
    }
  };

  if (compte.etat === "chargement") {
    return <p className="m-auto px-6 text-body-s text-texte-principal">Connexion à l’équipe…</p>;
  }
  if (compte.etat === "retire") {
    return (
      <div className="m-auto flex max-w-sm flex-col gap-4 px-6">
        <p className="text-body-s text-texte-principal">Ce compte ne fait plus partie de l’équipe.</p>
        <Bouton onClick={() => void compte.seDeconnecter()}>Se déconnecter de ce téléphone</Bouton>
      </div>
    );
  }

  return (
    <div className="m-auto flex w-full max-w-sm flex-col gap-6 px-6 py-10">
      <Image src="/brand/logotype-generic.svg" alt="KLYRA" width={125} height={32} priority />
      <h1 className="text-h3 font-medium text-texte-principal">Connecte-toi à KLYRA</h1>
      {/* Déconnecté depuis Réglages › Mobile : pas « retiré de l'équipe » (MO-T14). */}
      {compte.sessionFermee ? (
        <p role="status" className="text-body-s text-texte-principal">
          {texteDeconnecte(posteRetenu())}
        </p>
      ) : null}
      <form onSubmit={demander} className="flex flex-col gap-3">
        <label className="flex flex-col gap-2 text-ui text-texte-principal">
          Ton adresse e-mail
          <input
            type="email"
            required
            autoComplete="email"
            aria-label="Adresse e-mail"
            placeholder="prenom@klyra.design"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={CHAMP}
          />
        </label>
        <BoutonPrincipal type="submit" disabled={compte.occupe || attente > 0}>
          {compte.occupe ? "Envoi…" : "Recevoir un lien"}
        </BoutonPrincipal>
        {compte.adresseEnAttente ? (
          <p className="text-ui text-texte-secondaire">
            {compte.demandeRefusee
              ? `Si ${compte.adresseEnAttente} est invitée, un lien lui a été envoyé il y a peu`
              : `Si ${compte.adresseEnAttente} est invitée, un lien vient de partir`}
          </p>
        ) : null}
        {attente > 0 ? <p className="text-ui-xs text-texte-secondaire">Renvoyer dans {formaterAttente(attente)}</p> : null}
        {compte.erreur ? (
          <p role="alert" className="text-ui text-texte-principal">
            {compte.erreur}
          </p>
        ) : null}
      </form>
      <form
        className="flex flex-col gap-3 border-t border-bordure-subtile pt-6"
        onSubmit={(e) => {
          e.preventDefault();
          void compte.ouvrirLienColle(lien);
        }}
      >
        <label className="flex flex-col gap-2 text-ui text-texte-principal">
          Lien de connexion
          <span className="flex gap-2">
            <input aria-label="Lien de connexion" value={lien} onChange={(e) => setLien(e.target.value)} className={CHAMP} />
            <Bouton type="button" onClick={() => void coller()} className="h-12">
              Coller
            </Bouton>
          </span>
        </label>
        <Bouton type="submit" variant="sombre" className="h-12">
          Se connecter
        </Bouton>
      </form>
    </div>
  );
}
