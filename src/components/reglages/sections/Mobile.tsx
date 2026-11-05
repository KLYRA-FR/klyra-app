"use client";

import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { lireClePoste } from "@/components/compte/SignalPoste";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { useConfirmation } from "@/components/ui/Modale";
import { getBridge } from "@/lib/bridge";
import { messageErreur, useCompte, useSocketOuvert, type Membre } from "@/lib/compte";
import { useServeursRelies, useSondes } from "@/lib/lieux";
import {
  confirmationDeconnexion,
  detailTelephone,
  fermeDepuis,
  maillonAgent,
  majuscule,
  nomModele,
  phraseChemin,
  phrasePerdu,
  phraseVps,
  type ModeleTelephone,
} from "@/lib/mobile";
import { poste } from "@/lib/plateforme";
import { libelleServeur, type ServeurConnu } from "@/lib/serveur-vps";
import { QrCode } from "../QrCode";
import { ancreReglage, Erreur, Groupe, Ligne, Pastille, SeulementBureau, Valeur } from "../ui";

/** Une page de la liste des téléphones. Les suivantes se chargent à la demande : aucune n'est cachée. */
const PAGE = 20;

/** Hors ligne seulement après 2,5 s sans socket : une reconnexion brève ne grise pas la page. */
function useHorsLigne(): boolean {
  const socket = useSocketOuvert();
  const [reseau, setReseau] = useState(() => typeof navigator === "undefined" || navigator.onLine);
  const [horsLigne, setHorsLigne] = useState(false);
  useEffect(() => {
    const lire = () => setReseau(navigator.onLine);
    window.addEventListener("online", lire);
    window.addEventListener("offline", lire);
    return () => {
      window.removeEventListener("online", lire);
      window.removeEventListener("offline", lire);
    };
  }, []);
  const coupe = !socket || !reseau;
  useEffect(() => {
    const t = setTimeout(() => setHorsLigne(coupe), coupe ? 2500 : 0);
    return () => clearTimeout(t);
  }, [coupe]);
  return horsLigne;
}

/** L'heure de cet ordinateur, relue chaque minute (« vu à 18:42 », « Fermé depuis… »). */
function useMinute(): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return maintenant;
}

/** Une ligne de la liste, éclairée à son arrivée comme un réglage trouvé par la recherche. */
function LigneEclairee({ id, eclaire, children }: { id?: string; eclaire: boolean; children: ReactNode }) {
  return (
    <div id={id ? ancreReglage(id) : undefined} data-eclaire={eclaire ? "" : undefined} className="klyra-reglage -mx-4 flex scroll-mt-6 flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-3.5">
      {children}
    </div>
  );
}

function Telephones({ horsLigne, vps, annoncer }: { horsLigne: boolean; vps: string[]; annoncer: (texte: string) => void }) {
  const { results, status, loadMore } = usePaginatedQuery(api.telephones.liste, {}, { initialNumItems: PAGE });
  const deconnecter = useMutation(api.telephones.deconnecter);
  const [demander, fenetre] = useConfirmation();
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [nouvelles, setNouvelles] = useState<Set<string>>(() => new Set());
  const connues = useRef<Set<string> | null>(null);
  const maintenant = useMinute();

  /* Une session qui arrive pendant que la page est ouverte : annoncée et éclairée (1,8 s). */
  useEffect(() => {
    if (status === "LoadingFirstPage") return;
    const ids = new Set(results.map((t) => t.sessionId as string));
    if (connues.current) {
      const arrivees = results.filter((t) => !connues.current!.has(t.sessionId));
      for (const t of arrivees) annoncer(`${nomModele(t.modele)} connecté à ton compte`);
      if (arrivees.length) {
        setNouvelles(new Set(arrivees.map((t) => t.sessionId as string)));
        const id = setTimeout(() => setNouvelles(new Set()), 1800);
        connues.current = ids;
        return () => clearTimeout(id);
      }
    }
    connues.current = ids;
  }, [results, status, annoncer]);

  const fermer = async (sessionId: Id<"authSessions">, modele: ModeleTelephone | null) => {
    if (!(await demander({ ...confirmationDeconnexion(modele, vps), confirmer: "Déconnecter" }))) return;
    setEnCours(sessionId);
    setErreurs((etat) => Object.fromEntries(Object.entries(etat).filter(([id]) => id !== sessionId)));
    try {
      await deconnecter({ sessionId });
      annoncer(`${nomModele(modele)} déconnecté`);
    } catch (e) {
      setErreurs((etat) => ({ ...etat, [sessionId]: messageErreur(e) }));
    } finally {
      setEnCours(null);
    }
  };

  return (
    <Groupe titre="Téléphones connectés">
      {status === "LoadingFirstPage" ? <Ligne id="mobile-telephones" libelle="Lecture des téléphones connectés…" /> : null}
      {status !== "LoadingFirstPage" && results.length === 0 && status === "Exhausted" ? (
        <Ligne id="mobile-telephones" libelle="Aucun téléphone connecté à ton compte" description="Relie-le ci-dessous." />
      ) : null}
      {results.map((t, i) => (
        <Fragment key={t.sessionId}>
          <LigneEclairee id={i === 0 ? "mobile-telephones" : undefined} eclaire={nouvelles.has(t.sessionId)}>
            <div className="flex min-w-[200px] flex-1 flex-col gap-0.5">
              <span className="text-ui-s font-medium text-texte-principal">{nomModele(t.modele)}</span>
              <span className="text-ui-xs leading-[1.45] text-texte-secondaire">{detailTelephone(t.connecteLe, t.vu, maintenant)}</span>
              {t.modele === null ? (
                <span className="text-ui-xs leading-[1.45] text-texte-secondaire">Une session de ton compte qui ne s’est pas encore signalée : un téléphone, un navigateur ou un ordinateur d’une version précédente.</span>
              ) : null}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              <Bouton variant="blanc" taille="compact" disabled={horsLigne || enCours !== null} onClick={() => void fermer(t.sessionId, t.modele)}>
                {enCours === t.sessionId ? "Déconnexion…" : "Déconnecter"}
              </Bouton>
              {horsLigne ? <span className="text-ui-xs text-texte-secondaire">Possible quand {poste.ce} est en ligne</span> : null}
            </div>
          </LigneEclairee>
          {erreurs[t.sessionId] ? <Erreur>{erreurs[t.sessionId]}</Erreur> : null}
        </Fragment>
      ))}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        /* Une page peut être courte (sessions d'ordinateur écartées) : on continue jusqu'au bout. */
        <Ligne id={results.length === 0 ? "mobile-telephones" : undefined} libelle="D’autres sessions de ton compte">
          <Bouton variant="blanc" taille="compact" disabled={status === "LoadingMore"} onClick={() => loadMore(PAGE)}>
            {status === "LoadingMore" ? "Chargement…" : "Afficher les suivantes"}
          </Bouton>
        </Ligne>
      ) : null}
      <p className="m-0 py-3 text-ui-xs leading-[1.45] text-texte-secondaire">{phrasePerdu(poste.ce, vps)}</p>
      {fenetre}
    </Groupe>
  );
}

function Ordinateurs({ postes, cle, maintenant }: { postes: { cle: string; nom: string; ouvert: boolean; dernierSignal: number }[]; cle: string | null; maintenant: number }) {
  if (postes.length < 2) return null;
  return (
    <Groupe titre="Ordinateurs de ton compte">
      {postes.map((p) => (
        <Ligne key={p.cle} libelle={p.nom} description={p.cle === cle ? majuscule(poste.ce) : undefined}>
          <Pastille ton={p.ouvert ? "ok" : "neutre"} texte={p.ouvert ? "Ouvert" : fermeDepuis(p.dernierSignal, maintenant)} />
        </Ligne>
      ))}
    </Groupe>
  );
}

function Etape({ numero, titre, children, aside }: { numero: number; titre: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-start gap-4 py-3.5">
      <div className="flex min-w-[260px] flex-1 gap-3">
        <span aria-hidden className="klyra-mono w-5 shrink-0 pt-px text-ui-s font-medium text-texte-accent">
          {numero}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-ui-s font-medium text-texte-principal">{titre}</span>
          {children}
        </div>
      </div>
      {aside}
    </li>
  );
}

function Relier({ adresse, moi }: { adresse: string | null | undefined; moi: Membre }) {
  const [copie, setCopie] = useState(false);
  if (adresse === undefined) return <Groupe titre="Relier un téléphone"><Ligne id="mobile-relier" libelle="Lecture de l’adresse de KLYRA…" /></Groupe>;
  if (adresse === null) {
    return (
      <Groupe titre="Relier un téléphone">
        <Ligne
          id="mobile-relier"
          libelle="L’adresse de KLYRA pour le téléphone n’est pas encore en ligne."
          description="Elle apparaîtra ici, avec son QR, quand l’app web sera publiée à une adresse https stable. Sans elle, le téléphone ne peut pas ouvrir KLYRA."
        />
      </Groupe>
    );
  }
  const copier = () => {
    void navigator.clipboard?.writeText(adresse).then(() => {
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    });
  };
  return (
    <Groupe titre="Relier un téléphone">
      <ol id={ancreReglage("mobile-relier")} className="klyra-reglage -mx-4 m-0 flex scroll-mt-6 list-none flex-col divide-y divide-bordure-subtile px-4">
        <Etape numero={1} titre="Ouvre KLYRA sur ton téléphone" aside={<QrCode texte={adresse} libelle="QR de l’adresse de KLYRA" />}>
          <span className="text-ui-xs leading-[1.45] text-texte-secondaire">Scanne ce code avec l’appareil photo.</span>
          <span className="flex flex-wrap items-center gap-2 pt-1">
            <Valeur mono>{adresse}</Valeur>
            <Bouton variant="blanc" taille="compact" onClick={copier}>
              {copie ? "Adresse copiée" : "Copier l’adresse"}
            </Bouton>
          </span>
        </Etape>
        <Etape numero={2} titre="Pose-la sur l’écran d’accueil">
          <span className="text-ui-xs leading-[1.45] text-texte-secondaire">iPhone : menu Partager de Safari. Android : menu de Chrome.</span>
        </Etape>
        <Etape numero={3} titre={`Connecte-toi avec ${moi.email}`}>
          <span className="text-ui-xs leading-[1.45] text-texte-secondaire">
            La même adresse que {poste.ce}. Le lien s’ouvre dans Safari et pas dans l’app ? Colle-le dans KLYRA, sous « Lien de connexion ».
          </span>
        </Etape>
      </ol>
    </Groupe>
  );
}

function Vps({ serveurs }: { serveurs: ServeurConnu[] }) {
  const router = useRouter();
  const sondes = useSondes(serveurs);
  const ouvrir = (
    <Bouton variant="blanc" taille="compact" onClick={() => router.push("/serveurs")}>
      Ouvrir Serveurs
    </Bouton>
  );
  if (!serveurs.length) {
    return (
      <Groupe titre="Le VPS et ton téléphone">
        <Ligne id="mobile-vps" libelle={`Aucun VPS relié à ${poste.ce}`} description={`Sans VPS, tes agents tournent sur ${poste.ce}.`}>
          {ouvrir}
        </Ligne>
      </Groupe>
    );
  }
  return (
    <Groupe titre={serveurs.length === 1 ? `${serveurs[0].nom} et ton téléphone` : "Tes VPS et ton téléphone"}>
      {serveurs.map((s, i) => {
        const lu = sondes[s.id];
        return (
          <Ligne key={s.id} id={i === 0 ? "mobile-vps" : undefined} libelle={s.nom} description={s.adresse}>
            <Pastille ton={lu?.sonde === "repond" ? "ok" : "neutre"} texte={libelleServeur(s.etat, lu?.sonde, lu?.agents, lu?.retard)} />
          </Ligne>
        );
      })}
      <div className="flex flex-wrap items-end justify-between gap-3 py-3.5">
        <p className="m-0 min-w-[260px] flex-1 text-ui-s leading-[1.45] text-texte-secondaire">{phraseVps(poste.ce, serveurs.length)}</p>
        {ouvrir}
      </div>
    </Groupe>
  );
}

function MobileConnecte({ moi }: { moi: Membre }) {
  const serveurs = useServeursRelies();
  const vps = serveurs.map((s) => s.nom);
  const postes = useQuery(api.postes.etat, {});
  const adresse = useQuery(api.telephones.adresseApp, {});
  const horsLigne = useHorsLigne();
  const maintenant = useMinute();
  const [cle] = useState(lireClePoste);
  const [annonce, setAnnonce] = useState("");
  const cePoste = postes?.find((p) => p.cle === cle);

  const pastille = horsLigne ? (
    <Pastille ton="attente" texte="Hors ligne" />
  ) : !cePoste ? (
    <Pastille ton="neutre" texte="Vérification…" />
  ) : cePoste.ouvert ? (
    <Pastille ton="ok" texte="Ouvert" />
  ) : (
    <Pastille ton="neutre" texte={fermeDepuis(cePoste.dernierSignal, maintenant)} />
  );
  const maillons = ["Téléphone", "Ton compte KLYRA", majuscule(poste.ce), maillonAgent(poste.ce, vps)];

  return (
    <>
      <Groupe titre="Par où passe ton téléphone">
        <div className="flex flex-col gap-2 py-3.5">
          <ol aria-label="Chemin de tes messages" className="m-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0">
            {maillons.map((m, i) => (
              <li key={m} className="flex items-center gap-1.5 text-ui-s text-texte-principal">
                {i > 0 ? <Icon name="chevron-right" size={16} aria-hidden className="text-icone-secondaire" /> : null}
                {m}
              </li>
            ))}
          </ol>
          <p className="m-0 text-ui-s leading-[1.45] text-texte-secondaire">{phraseChemin(poste.ce, vps)}</p>
        </div>
        <Ligne id="mobile-chemin" libelle={`Ton téléphone voit ${poste.ce}`} description={horsLigne ? `${majuscule(poste.ce)} n’est pas en ligne : ton téléphone le voit fermé.` : undefined}>
          {pastille}
        </Ligne>
      </Groupe>
      <Telephones horsLigne={horsLigne} vps={vps} annoncer={setAnnonce} />
      <Ordinateurs postes={postes ?? []} cle={cle} maintenant={maintenant} />
      <Relier adresse={adresse} moi={moi} />
      <Vps serveurs={serveurs} />
      <p aria-live="polite" className="sr-only">
        {annonce}
      </p>
    </>
  );
}

export function Mobile() {
  const router = useRouter();
  const { etat, moi } = useCompte();

  /* Sans app de bureau, il n'y a pas d'ordinateur qui relaie le téléphone (MO-D9). */
  if (!getBridge()) {
    return (
      <Groupe>
        <Ligne id="mobile-chemin" libelle="Mobile">
          <SeulementBureau>La page Mobile se règle dans l’app de bureau, sur l’ordinateur qui relaie ton téléphone.</SeulementBureau>
        </Ligne>
      </Groupe>
    );
  }
  if (etat === "indisponible") {
    return (
      <Groupe>
        <Ligne id="mobile-chemin" libelle="Compte d’équipe">
          <SeulementBureau>Le compte d’équipe se règle dans l’app de bureau.</SeulementBureau>
        </Ligne>
      </Groupe>
    );
  }
  if (etat === "chargement") {
    return (
      <Groupe>
        <Ligne id="mobile-chemin" libelle="Connexion à l’équipe…" />
      </Groupe>
    );
  }
  if (etat === "deconnecte") {
    return (
      <Groupe>
        <Ligne id="mobile-chemin" libelle={`Connecte d’abord ${poste.ce} à ton compte d’équipe`} description="Ton téléphone passe par ce compte : sans lui, il ne voit pas tes conversations.">
          <Bouton variant="sombre" taille="compact" onClick={() => router.push("/reglages?section=equipe")}>
            Se connecter dans Équipe
          </Bouton>
        </Ligne>
      </Groupe>
    );
  }
  if (etat === "retire" || !moi) {
    return (
      <Groupe>
        <Ligne id="mobile-chemin" libelle="Ce compte ne fait plus partie de l’équipe" description="Demande à un admin de t’inviter de nouveau." />
      </Groupe>
    );
  }
  return <MobileConnecte moi={moi} />;
}
