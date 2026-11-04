"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ListeCoffre } from "@/components/chat/navigateur/Coffre";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Modale, useConfirmation } from "@/components/ui/Modale";
import type { SecretCoffre } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { GENRES_SECRET, useCoffreKlyra, variableProposee, type GenreSecret } from "@/lib/coffre";
import { formatListDate } from "@/lib/format";
import { useRole } from "@/lib/workspace";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau } from "../ui";

/**
 * Réglages › Coffre (electron/coffre.ts) : tous les mots de passe et les clés de la personne, chiffrés
 * par le trousseau du système. Les clés API, jetons et mots de passe libres, puis les connexions de
 * sites du navigateur de KLYRA. L'écran n'a jamais une valeur : elle part au main quand on la tape,
 * « Copier » la met dans le presse-papiers depuis le main, vidé après 30 s.
 */

export const CHAMP_COFFRE =
  "h-9 w-full min-w-0 rounded-md border border-bordure-champ bg-fond-surface px-3 text-ui-s text-texte-principal outline-none transition-colors duration-[120ms] placeholder:text-texte-placeholder hover:border-bordure-champ-survol focus:border-focus";

const OPTIONS_GENRE = (Object.keys(GENRES_SECRET) as GenreSecret[]).map((g) => ({ value: g, label: GENRES_SECRET[g] }));

const jour = (t: number) => formatListDate(new Date(t).toISOString());

/** Le coffre lu une fois par l'écran des Réglages, passé à chaque ligne. */
type Pont = ReturnType<typeof useCoffreKlyra>;

/** Un champ de valeur masqué, avec « Afficher » : ce que la personne tape ne reste que dans ce champ. */
export function ChampSecret({
  valeur,
  onChange,
  libelle,
  placeholder = "Colle la valeur ici",
  autoFocus,
}: {
  valeur: string;
  onChange: (v: string) => void;
  libelle: string;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <span className="relative flex min-w-0 flex-1 items-center">
      <input
        type={visible ? "text" : "password"}
        value={valeur}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={libelle}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        data-1p-ignore
        data-lpignore="true"
        autoFocus={autoFocus}
        className={cn(CHAMP_COFFRE, "pr-20 font-[inherit]")}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        aria-pressed={visible}
        className="absolute right-1.5 h-6 cursor-pointer rounded-xs border-0 bg-transparent px-2 text-ui-2xs font-medium text-texte-secondaire hover:bg-fond-survol hover:text-texte-principal"
      >
        {visible ? "Masquer" : "Afficher"}
      </button>
    </span>
  );
}

/** Qui a rangé ce secret : la personne, ou un agent (son visuel). */
function Origine({ secret }: { secret: SecretCoffre }) {
  const roleId = secret.origine.par === "agent" ? secret.origine.roleId : "principal";
  const role = useRole(roleId);
  if (secret.origine.par !== "agent") return <>ajouté {jour(secret.ajouteLe)}</>;
  return (
    <span className="inline-flex items-center gap-1">
      <AgentRond roleId={roleId} taille={14} /> rangé par {role.name} {jour(secret.ajouteLe)}
    </span>
  );
}

/** Ajouter un secret : son nom, sa variable (tirée du nom), son genre, son service, sa valeur. */
function FormulaireSecret({ coffre, onFini }: { coffre: Pont; onFini?: () => void }) {
  const [nom, setNom] = useState("");
  const [variable, setVariable] = useState("");
  const [variableTouchee, setVariableTouchee] = useState(false);
  const [genre, setGenre] = useState<GenreSecret>("cle-api");
  const [service, setService] = useState("");
  const [valeur, setValeur] = useState("");
  const [agents, setAgents] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const variableEffective = variableTouchee ? variable : variableProposee(nom);
  const prise = !!coffre.etat?.secrets.some((s) => s.variable === variableProposee(variableEffective));

  const valider = async (e: FormEvent) => {
    e.preventDefault();
    if (!valeur || !variableEffective || prise) return;
    setEnvoi(true);
    const r = await coffre.ajouter({ variable: variableEffective, nom: nom || variableEffective, genre, service, valeur, agents });
    setEnvoi(false);
    if (!r) return;
    setNom("");
    setVariable("");
    setVariableTouchee(false);
    setService("");
    setValeur("");
    onFini?.();
  };

  return (
    <form onSubmit={valider} className="flex flex-col gap-2.5 py-1">
      <div className="grid gap-2.5 @[560px]:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-ui-xs font-medium text-texte-secondaire">Nom</span>
          <input value={nom} onChange={(e) => setNom(e.target.value)} placeholder="Clé secrète Stripe" className={CHAMP_COFFRE} autoComplete="off" spellCheck={false} />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ui-xs font-medium text-texte-secondaire">Nom de variable</span>
          <input
            value={variableEffective}
            onChange={(e) => {
              setVariableTouchee(true);
              setVariable(e.target.value.toUpperCase());
            }}
            placeholder="STRIPE_SECRET_KEY"
            aria-describedby="coffre-variable-aide"
            className={CHAMP_COFFRE}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ui-xs font-medium text-texte-secondaire">Genre</span>
          <ListeDeroulante options={OPTIONS_GENRE} value={genre} onChange={setGenre} libelle="Genre du secret" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-ui-xs font-medium text-texte-secondaire">Site ou service</span>
          <input value={service} onChange={(e) => setService(e.target.value)} placeholder="dashboard.stripe.com" className={CHAMP_COFFRE} autoComplete="off" spellCheck={false} />
        </label>
      </div>
      <span id="coffre-variable-aide" className={cn("text-ui-2xs leading-[1.45]", prise ? "text-texte-erreur" : "text-texte-tertiaire")}>
        {prise ? "Un secret porte déjà ce nom de variable : remplace sa valeur dans la liste, ou choisis un autre nom." : "Tes agents le retrouvent par ce nom, et l’écrivent sous ce nom dans un fichier .env."}
      </span>
      <label className="flex flex-col gap-1">
        <span className="text-ui-xs font-medium text-texte-secondaire">Valeur</span>
        <ChampSecret valeur={valeur} onChange={setValeur} libelle="Valeur du secret" />
      </label>
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui-xs leading-[1.45] text-texte-secondaire">Mes agents peuvent s’en servir (sans voir la valeur)</span>
        <Interrupteur libelle="Mes agents peuvent s’en servir" actif={agents} onChange={setAgents} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Bouton type="submit" variant="sombre" taille="compact" disabled={envoi || !valeur || !variableEffective || prise}>
          {envoi ? "Chiffrement…" : "Ranger dans le coffre"}
        </Bouton>
        {onFini && (
          <Bouton variant="discret" taille="compact" onClick={onFini}>
            Annuler
          </Bouton>
        )}
      </div>
      {coffre.erreur && <Erreur>{coffre.erreur}</Erreur>}
    </form>
  );
}

/** Remplacer la valeur d'un secret (clé renouvelée) : la nouvelle part au main, l'ancienne est perdue. */
function ModaleRemplacer({ coffre, secret, onFermer }: { coffre: Pont; secret: SecretCoffre; onFermer: () => void }) {
  const [valeur, setValeur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const valider = async () => {
    if (!valeur) return;
    setEnvoi(true);
    const r = await coffre.remplacerValeur(secret.id, valeur);
    setEnvoi(false);
    if (r) onFermer();
  };
  return (
    <Modale
      titre={`Nouvelle valeur pour ${secret.nom}`}
      onFermer={onFermer}
      actions={
        <>
          <Bouton variant="blanc" taille="md" onClick={onFermer}>
            Annuler
          </Bouton>
          <Bouton variant="sombre" taille="md" disabled={!valeur || envoi} onClick={() => void valider()}>
            {envoi ? "Chiffrement…" : "Remplacer"}
          </Bouton>
        </>
      }
    >
      <div className="flex flex-col gap-2.5">
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          L’ancienne valeur de {secret.variable} est effacée du coffre. Les fichiers où un agent l’a déjà écrite ne changent pas : demande-lui de la réécrire.
        </span>
        <ChampSecret valeur={valeur} onChange={setValeur} libelle={`Nouvelle valeur de ${secret.variable}`} autoFocus />
        {coffre.erreur && <Erreur>{coffre.erreur}</Erreur>}
      </div>
    </Modale>
  );
}

/** Une ligne de la liste : le secret, qui l'a rangé, et ce qu'on peut en faire. */
function LigneSecret({ coffre, secret, onRemplacer }: { coffre: Pont; secret: SecretCoffre; onRemplacer: () => void }) {
  const [demander, fenetre] = useConfirmation();
  const [copie, setCopie] = useState(false);
  const minuteur = useRef<number | null>(null);
  useEffect(() => () => {
    if (minuteur.current) window.clearTimeout(minuteur.current);
  }, []);

  const copier = async () => {
    const r = await coffre.copier(secret.id);
    if (!r) return;
    setCopie(true);
    if (minuteur.current) window.clearTimeout(minuteur.current);
    minuteur.current = window.setTimeout(() => setCopie(false), r.delai);
  };
  const retirer = async () => {
    const oui = await demander({
      titre: `Retirer ${secret.nom} du coffre ?`,
      texte: `La valeur de ${secret.variable} est effacée du coffre de KLYRA. Les fichiers où un agent l’a écrite et le compte chez ${secret.service || "le service"} ne changent pas.`,
      confirmer: "Retirer",
    });
    if (oui) await coffre.retirer(secret.id);
  };

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md bg-fond-surface-grise px-3 py-2.5">
      <Icon name="lock-01" size={16} className="shrink-0 text-icone-secondaire" />
      <span className="flex min-w-[180px] flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-ui-s font-medium text-texte-principal">{secret.nom}</span>
          <span className="text-ui-2xs font-medium tracking-[0.01em] text-texte-secondaire">{secret.variable}</span>
        </span>
        <span className="text-ui-2xs leading-[1.45] text-texte-tertiaire">
          {GENRES_SECRET[secret.genre]}
          {secret.service ? ` · ${secret.service}` : ""} · <Origine secret={secret} />
          {secret.utiliseLe ? ` · utilisé ${jour(secret.utiliseLe)}` : ""}
        </span>
        {secret.note && <span className="text-ui-2xs leading-[1.45] text-texte-secondaire">{secret.note}</span>}
      </span>
      <span className="flex items-center gap-1.5 text-ui-2xs text-texte-secondaire">
        Agents
        <Interrupteur libelle={`Mes agents peuvent utiliser ${secret.nom}`} actif={secret.agents} onChange={(v) => void coffre.modifier(secret.id, { agents: v })} />
      </span>
      <span className="flex items-center gap-1">
        <Bouton variant="blanc" taille="mini" iconeGauche={<Icon name={copie ? "check-01" : "copy-left"} size={14} />} onClick={() => void copier()}>
          {copie ? "Copié" : "Copier"}
        </Bouton>
        <Bouton variant="discret" taille="mini" onClick={onRemplacer}>
          Remplacer
        </Bouton>
        <Bouton variant="discret" taille="mini" onClick={() => void retirer()}>
          Retirer
        </Bouton>
      </span>
      {fenetre}
    </li>
  );
}

function ListeSecrets({ coffre }: { coffre: Pont }) {
  const [recherche, setRecherche] = useState("");
  const [remplacer, setRemplacer] = useState<SecretCoffre | null>(null);
  const [ajout, setAjout] = useState(false);
  const secrets = useMemo(() => coffre.etat?.secrets ?? [], [coffre.etat]);
  const visibles = useMemo(() => {
    const q = recherche.trim().toLowerCase();
    if (!q) return secrets;
    return secrets.filter((s) => [s.nom, s.variable, s.service, s.note].some((t) => t.toLowerCase().includes(q)));
  }, [recherche, secrets]);

  if (!coffre.etat) return <span className="text-ui-xs text-texte-tertiaire">Lecture du coffre…</span>;

  return (
    <div className="flex flex-col gap-3">
      {!coffre.etat.chiffrement && <Erreur>Le trousseau de cet ordinateur est indisponible : aucun secret ne peut être ajouté tant qu’il ne l’est pas.</Erreur>}
      {secrets.length > 6 && (
        <label className="relative flex items-center">
          <Icon name="search-01" size={16} className="pointer-events-none absolute left-2.5 text-icone-secondaire" />
          <span className="sr-only">Chercher dans le coffre</span>
          <input type="search" value={recherche} onChange={(e) => setRecherche(e.target.value)} placeholder="Chercher un secret…" className={cn(CHAMP_COFFRE, "pl-8")} />
        </label>
      )}
      {visibles.length ? (
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {visibles.map((s) => (
            <LigneSecret key={s.id} coffre={coffre} secret={s} onRemplacer={() => setRemplacer(s)} />
          ))}
        </ul>
      ) : (
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          {recherche ? `Aucun secret ne correspond à « ${recherche} ».` : "Aucune clé ni aucun mot de passe dans le coffre pour l’instant. Ajoute-en un, ou laisse un agent te le demander quand il en a besoin."}
        </span>
      )}
      {ajout ? (
        <div className="rounded-md border border-bordure-subtile px-3 py-2">
          <FormulaireSecret coffre={coffre} onFini={() => setAjout(false)} />
        </div>
      ) : (
        <Bouton variant="blanc" taille="compact" className="self-start" iconeGauche={<Icon name="plus-01" size={16} />} disabled={!coffre.etat.chiffrement} onClick={() => setAjout(true)}>
          Ajouter un secret
        </Bouton>
      )}
      {remplacer && <ModaleRemplacer coffre={coffre} secret={remplacer} onFermer={() => setRemplacer(null)} />}
    </div>
  );
}

export function Coffre() {
  const coffre = useCoffreKlyra();
  if (!coffre.disponible) {
    return (
      <Groupe>
        <Ligne id="coffre-secrets" libelle="Clés et mots de passe">
          <SeulementBureau>Le coffre est dans l’app de bureau : tes secrets ne quittent pas l’ordinateur.</SeulementBureau>
        </Ligne>
      </Groupe>
    );
  }
  return (
    <>
      <Groupe
        titre="Clés et mots de passe"
        description="Clés API, jetons et mots de passe, chacun chiffré par le trousseau de ton ordinateur. Ils ne quittent pas cet ordinateur et ne s’affichent jamais : « Copier » le met dans ton presse-papiers, vidé après 30 secondes."
      >
        <Ligne id="coffre-secrets" libelle="Dans le coffre" pile>
          <ListeSecrets coffre={coffre} />
        </Ligne>
      </Groupe>

      <Groupe
        titre="Connexions de sites"
        description="Identifiant et mot de passe d’un site, pour le navigateur de KLYRA : « Remplir » est dans la barre de chaque onglet, et un agent que tu y autorises remplit la page de connexion sans voir le mot de passe."
      >
        <Ligne id="coffre-connexions" libelle="Connexions enregistrées" pile>
          <ListeCoffre />
        </Ligne>
      </Groupe>

      <Groupe titre="Avec tes agents">
        <Ligne
          id="coffre-agents"
          libelle="Ce que tes agents en font"
          description="Un agent ne voit jamais une valeur. Il liste ce que tu lui permets (le nom, pas le secret), et quand il lui manque une clé, il te la demande dans la conversation : une carte sécurisée où tu la colles, rangée aussitôt dans le coffre sans passer par le fil. Il range aussi ce qu’il obtient (une clé qu’il a créée, un jeton rendu par une commande), et l’écrit pour toi dans un fichier .env hors de Git, avec ton accord en accès « Projet »."
        />
        <Ligne
          id="coffre-demander"
          libelle="Lui donner une clé"
          description="Demande-le simplement (« range ma clé OpenAI dans le coffre ») : il t’ouvre la carte sécurisée. Ne colle pas un secret dans un message, il resterait dans la conversation."
        />
      </Groupe>
    </>
  );
}
