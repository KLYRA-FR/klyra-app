"use client";

import { useEffect, useState } from "react";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { getBridge, type AutreIa } from "@/lib/bridge";
import { cn } from "@/lib/cn";

type Fournisseurs = Record<string, { nom: string; url: string; modele: string }>;

/** Où créer la clé de chaque fournisseur. */
const OU_CREER_LA_CLE: Record<string, string> = {
  openai: "platform.openai.com/api-keys",
  gemini: "aistudio.google.com/apikey",
  mistral: "console.mistral.ai/api-keys",
  deepseek: "platform.deepseek.com/api_keys",
  xai: "console.x.ai",
  openrouter: "openrouter.ai/keys",
};

/** Le résultat du dernier test de chaque IA. */
type Test = { etat: "en-cours" } | { etat: "ok" } | { etat: "erreur"; message: string };

function Formulaire({ fournisseurs, onAjoutee, onAnnuler }: { fournisseurs: Fournisseurs; onAjoutee: (liste: AutreIa[]) => void; onAnnuler: () => void }) {
  const [fournisseur, setFournisseur] = useState("openai");
  const [nom, setNom] = useState(fournisseurs.openai?.nom ?? "");
  const [modele, setModele] = useState(fournisseurs.openai?.modele ?? "");
  const [url, setUrl] = useState("");
  const [cle, setCle] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const autre = fournisseur === "autre";

  const choisir = (f: string) => {
    setFournisseur(f);
    setNom(f === "autre" ? "" : (fournisseurs[f]?.nom ?? ""));
    setModele(fournisseurs[f]?.modele ?? "");
  };

  const ajouter = async () => {
    const ia = getBridge()?.ia;
    if (!ia) return;
    setEnvoi(true);
    setErreur(null);
    const r = await ia.ajouter({ nom, fournisseur, url: autre ? url : "", modele, cle });
    setEnvoi(false);
    if (!r.ok) return setErreur(r.message);
    setCle("");
    onAjoutee(r.data);
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void ajouter();
      }}
      className="flex flex-col gap-4 rounded-md border border-bordure-subtile p-4"
    >
      <div className="grid gap-4 @lg:grid-cols-2">
        <Champ label="IA">
          <ListeDeroulante
            value={fournisseur}
            options={Object.entries(fournisseurs).map(([id, f]) => ({ value: id, label: f.nom }))}
            onChange={choisir}
          />
        </Champ>
        <Champ label="Nom" aide="Celui que tu diras aux agents : « demande à Gemini ».">
          <Input size="sm" value={nom} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        </Champ>
        {autre && (
          <Champ label="Adresse de l’API" aide="Compatible OpenAI, par exemple https://api.exemple.com/v1.">
            <Input size="sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" className={CHAMP} />
          </Champ>
        )}
        <Champ label="Modèle" aide="Laisse celui proposé si tu ne sais pas.">
          <Input size="sm" value={modele} onChange={(e) => setModele(e.target.value)} spellCheck={false} className={cn(CHAMP, "klyra-mono")} />
        </Champ>
        <Champ
          label="Clé API"
          aide={OU_CREER_LA_CLE[fournisseur] ? `À créer sur ${OU_CREER_LA_CLE[fournisseur]}. Chiffrée dans le trousseau de ce poste.` : "Chiffrée dans le trousseau de ce poste."}
          className="@lg:col-span-2"
        >
          <Input
            size="sm"
            type="password"
            value={cle}
            onChange={(e) => setCle(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className={cn(CHAMP, "klyra-mono")}
          />
        </Champ>
      </div>
      {erreur && (
        <p role="alert" className="m-0 text-ui-s text-texte-erreur">
          {erreur}
        </p>
      )}
      <div className="flex gap-2">
        <Bouton type="submit" variant="sombre" taille="md" disabled={envoi || !nom.trim() || !modele.trim() || !cle.trim() || (autre && !url.trim())}>
          {envoi ? "Ajout…" : "Ajouter"}
        </Bouton>
        <Bouton variant="blanc" taille="md" onClick={onAnnuler}>
          Annuler
        </Bouton>
      </div>
    </form>
  );
}

/**
 * Les autres IA que Claude (ChatGPT, Gemini, Mistral…) : on les ajoute avec leur
 * clé API, et les agents peuvent les interroger. La clé ne revient jamais à
 * l'interface : elle reste chiffrée côté app.
 */
export function AutresIa() {
  const bridge = getBridge()?.ia;
  const [fournisseurs, setFournisseurs] = useState<Fournisseurs | null>(null);
  const [liste, setListe] = useState<AutreIa[]>([]);
  const [ajout, setAjout] = useState(false);
  const [tests, setTests] = useState<Record<string, Test>>({});

  useEffect(() => {
    if (!bridge) return;
    void bridge.fournisseurs().then((r) => r.ok && setFournisseurs(r.data));
    void bridge.lister().then((r) => r.ok && setListe(r.data));
  }, [bridge]);

  if (!bridge) {
    return <div className="klyra-carte-flottante rounded-lg p-4 text-ui-s text-texte-secondaire">Les autres IA s’ajoutent dans l’app de bureau.</div>;
  }

  const tester = async (id: string) => {
    setTests((t) => ({ ...t, [id]: { etat: "en-cours" } }));
    const r = await bridge.tester(id);
    setTests((t) => ({ ...t, [id]: r.ok ? { etat: "ok" } : { etat: "erreur", message: r.message } }));
  };
  const retirer = async (id: string) => {
    const r = await bridge.retirer(id);
    if (r.ok) setListe(r.data);
  };

  return (
    <div className="klyra-carte-flottante flex flex-col gap-4 rounded-lg p-4">
      {liste.length > 0 && (
        <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile rounded-md border border-bordure-subtile p-0 px-3">
          {liste.map((ia) => {
            const test = tests[ia.id];
            return (
              <li key={ia.id} className="flex flex-wrap items-center gap-3 py-2.5">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="text-ui-s font-medium text-texte-principal">{ia.nom}</span>
                  <span className="klyra-mono truncate text-ui-xs text-texte-tertiaire">{ia.modele}</span>
                </div>
                {test?.etat === "ok" && <span className="text-ui-xs text-texte-secondaire">Répond bien</span>}
                {test?.etat === "erreur" && (
                  <span role="alert" title={test.message} className="max-w-[320px] truncate text-ui-xs text-texte-erreur">
                    {test.message}
                  </span>
                )}
                <Bouton variant="blanc" taille="compact" disabled={test?.etat === "en-cours"} onClick={() => void tester(ia.id)}>
                  {test?.etat === "en-cours" ? "Test…" : "Tester"}
                </Bouton>
                <BoutonIcone taille="compact" icone={<Icon name="trash-01" size={16} />} libelle={`Retirer ${ia.nom}`} onClick={() => void retirer(ia.id)} />
              </li>
            );
          })}
        </ul>
      )}

      {ajout && fournisseurs ? (
        <Formulaire
          fournisseurs={fournisseurs}
          onAjoutee={(l) => {
            setListe(l);
            setAjout(false);
          }}
          onAnnuler={() => setAjout(false)}
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Bouton variant="blanc" taille="md" iconeGauche={<Icon name="plus-01" size={20} />} onClick={() => setAjout(true)}>
            Ajouter une IA
          </Bouton>
          {!liste.length && (
            <span className="text-ui-xs text-texte-tertiaire">ChatGPT, Gemini, Mistral, DeepSeek, Grok… avec leur clé API.</span>
          )}
        </div>
      )}
    </div>
  );
}
