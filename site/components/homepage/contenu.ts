// HTML fixe de la maquette approuvée ; aucun contenu utilisateur.
export const contenuHomepage = `
<header class="nav" id="nav">
  <a class="nav__logo" href="#hero" aria-label="KLYRA, accueil">
    <svg viewBox="0 0 691.141 187.856" aria-hidden="true"><path class="lt" d=""/><path class="ls" d=""/></svg>
  </a>
  <nav class="nav__liens" aria-label="Principale">
    <a href="#agents">Agents</a>
    <a href="#suite" data-p="0">Tâches</a>
    <a href="#suite" data-p="0.74">Serveur</a>
    <a href="#outils">Outils</a>
    <a href="#questions">Questions</a>
  </nav>
  <div class="nav__droite"><a class="bp bp--nav" href="#acces"><span>Demander l'accès</span></a></div>
</header>

<main>


<section class="pin" id="hero" aria-label="KLYRA, ton équipe d’agents IA">
  <div class="pin__fixe hero" id="heroFixe">
    <canvas id="trame" aria-hidden="true"></canvas>
    <div class="hero__t" id="heroT">
      <p class="hero__plat">Mac · Windows · Téléphone · Serveur</p>
      <h1 class="h1">Confie le travail à <span class="pile" aria-hidden="true"><span class="av" data-a="principal"></span><span class="av" data-a="designer"></span><span class="av" data-a="dev"></span><span class="av" data-a="commercial"></span></span><br>ton équipe d'agents IA.</h1>
      <p class="hero__sous">Une app sur ton ordinateur. L'assistant répartit le travail entre les agents et te rend le résultat vérifié, avec ton compte Claude, ChatGPT ou Grok.</p>
      <div class="hero__cta">
        <a class="bp bp--clair" href="#acces"><span>Demander l'accès</span><i class="bp__ecran" aria-hidden="true"></i></a>
        <a class="bs" href="#agents">Voir l'équipe</a>
      </div>
      <p class="hero__note">Sur invitation pour le moment. L'équipe KLYRA travaille avec cette app.</p>
    </div>
    <div class="demo" id="demo"><p class="demo__legende">Démonstration interactive · contenus fictifs</p>
      <div class="demo__sel" id="demoSel" role="group" aria-label="Exemples de travail à confier"><span>Essaie :</span></div>
      <div class="app" id="appChat" aria-label="Démonstration fictive : une demande répartie entre les agents">
        <nav class="rail" aria-hidden="true" data-rail="chats"></nav>
        <aside class="ch-liste">
          <header><b>Chats</b><i class="ic" data-i="message-chat-01"></i></header>
          <p class="ch-liste__g"><i class="ic ic--s" data-i="chevron-down"></i>Mes agents <span>12</span></p>
          <ul id="chatsAgents"></ul>
        </aside>
        <div class="fil">
          <header class="fil__t">
            <span class="av" data-a="principal" style="--s:36px"></span>
            <div><b>Assistant</b><small>Ton assistant</small></div>
            <span class="cerveau">Claude · Opus 5.5<i class="ic ic--s" data-i="chevron-down"></i></span>
          </header>
          <div class="fil__c" id="filCorps"></div>
          <footer class="fil__s">
            <div class="saisie"><span>Écris à l'assistant…</span><div><i class="ic" data-i="paperclip-01"></i><span class="sp"></span><i class="ic" data-i="microphone-02"></i><b class="env"><i class="ic" data-i="arrow-up"></i></b></div></div>
          </footer>
        </div>
        <aside class="ch-det">
          <div class="onglets"><b>Tâches</b><span>Fichiers</span><span>Réglages</span></div>
          <p class="ch-det__t">Ce travail <span id="nbTaches"></span></p>
          <ul class="tach" id="filTaches"></ul>
          <p class="ch-det__t">Lieu</p>
          <div class="lieu"><i class="ic" data-i="server-01"></i><div><b>Serveur de l'atelier</b><small>En ligne</small></div><i class="pt-vert"></i></div>
        </aside>
      </div>
    </div>
  </div>
</section>


<section class="feuille-page agents" id="agents">
  <span id="fonctionnalites" aria-hidden="true"></span>
  <div class="gabarit">
    <header class="tete2 rv">
      <h2 class="h2">Un agent par métier.</h2>
      <p class="p">Onze métiers sont prêts. Tu prends ceux qu'il te faut ou tu crées les tiens, et chacun garde ses souvenirs et ses compétences.</p>
    </header>
    <div class="cartes" id="cartes"></div>
  </div>
</section>


<section id="suite">
  <div class="stage" id="stage">
    <div class="arriere" id="arriere">
      <img id="plaque" src="/homepage/art/ville-deux-heures.jpg" alt="">
      <div class="plaque-voile" id="pv"></div>
      <div class="clair" id="clair">
        <div class="t-jour">
          <h2 class="h2">Tu vois où en est chaque tâche.</h2>
          <p class="p">À faire, en cours, bloqué, à valider, terminé. Et tu valides ce qui t'attend.</p>
        </div>
        <div class="app app--tickets">
          <nav class="rail" aria-hidden="true" data-rail="tickets"></nav>
          <div class="tk">
            <header class="tk__t"><b>Tickets</b><span class="tk__n" id="tkTotal"></span><div class="seg"><b>Tableau</b><span>À moi</span></div><span class="tk__lieu"><i class="ic ic--s" data-i="server-01"></i>Serveur de l'atelier</span></header>
            <div class="tk__c" id="tkColonnes"></div>
          </div>
        </div>
      </div>
      <canvas id="f" aria-hidden="true"></canvas>
      <div class="fil-acc" id="fil"></div>
      <div class="b-accord" id="bAccord">
        <canvas id="fA" aria-hidden="true"></canvas>
        <div class="t-nuit" id="tAccord">
          <h2 class="h2">À toi de dire quand ils s'arrêtent pour te demander.</h2>
          <p class="p">Un niveau pour ton ordinateur, un par serveur : avant chaque modification, seulement avant ce qui pourrait casser, ou jamais.</p>
        </div>
        <div class="demande-fixe" id="demandeFixe"></div>
      </div>
      <div class="b-serveur" id="bServeur">
        <canvas id="fS" aria-hidden="true"></canvas>
        <div class="t-nuit" id="tServeur">
          <h2 class="h2">Ordinateur fermé, ils continuent sur ton serveur.</h2>
          <p class="p">Un serveur, c'est une machine louée, toujours allumée. L'équipe, les conversations, le coffre et les enchaînements y restent, et les connexions à tes outils aussi.</p>
        </div>
        <div class="etiq" id="etVps"><i class="ic" data-i="server-01"></i><div><b>Serveur de l'atelier</b><small><i class="pt-vert"></i>En ligne</small></div></div>
      </div>
    </div>
    <div class="morph" id="morph" aria-hidden="true">
      <div class="m-ticket" id="mT"></div>
      <div class="demande__c" id="mD">
        <header><span class="av" data-a="commercial" style="--s:36px"></span><div><b>Thomas demande ton accord</b><small>En attente depuis ce matin</small></div></header>
        <h3>Envoyer les 11 relances</h3>
        <dl>
          <div><dt>Devis relus</dt><dd>14</dd></div>
          <div><dt>Relances prêtes</dt><dd>11</dd></div>
          <div><dt>Mis de côté</dt><dd>3, déjà conclus</dd></div>
          <div><dt>Envoi</dt><dd>Depuis ton compte mail</dd></div>
        </dl>
        <div class="demande__a"><span class="b-s">Refuser</span><span class="b-s">Voir les mails</span><span class="b-o">Autoriser</span></div>
        <div class="demande__niv" aria-label="Niveau d'accès de ce serveur"><b>Me demander à chaque fois</b><span>Le projet en autonomie</span><span>Tout accepter</span></div>
      </div>
    </div>
    <div class="feuille" id="routines">
      <div class="feuille__t">
        <h2 class="h2">Ce qui revient chaque semaine se fait tout seul.</h2>
        <p class="p">Une routine part au moment que tu fixes, sans toi. Un enchaînement réunit plusieurs agents, avec ton accord au milieu.</p>
      </div>
      <div class="rangee">
        <div><span class="av" data-a="growth" style="--s:44px"></span><b style="margin-top:6px">Sacha</b><small>Croissance</small></div>
        <div><b>Recherche de prospects</b><small><i class="ic ic--s" data-i="clock-01"></i>Lundi et mardi à 08:00</small><em>Dernière : mardi, réussie</em></div>
        <div class="on"><b>Veille des prix</b><small><i class="ic ic--s" data-i="clock-01"></i>Tous les jeudis à 09:30</small><em><i class="pt-k"></i>En cours depuis 09:30</em></div>
        <div><b>Rapport de référencement</b><small><i class="ic ic--s" data-i="clock-01"></i>Tous les lundis à 08:00</small><em>Prochaine : lundi</em></div>
      </div>
      <div class="wf wf--k">
        <header><b>Publier une page</b><span>Sur le serveur de l'atelier</span></header>
        <div class="wf__l" id="wfL">
          <div class="wf__n"><span class="av" data-a="designer" style="--s:30px"></span><b>Maquette</b></div><i><b></b></i>
          <div class="wf__n"><span class="av" data-a="dev" style="--s:30px"></span><b>Code</b></div><i><b></b></i>
          <div class="wf__n"><span class="av" data-a="qa" style="--s:30px"></span><b>Relecture</b></div><i><b></b></i>
          <div class="wf__n"><span class="wf__ok"><i class="ic ic--s" data-i="check-02"></i></span><b>Ton accord</b></div><i><b></b></i>
          <div class="wf__n"><span class="av" data-a="dev" style="--s:30px"></span><b>Mise en ligne</b></div>
        </div>
      </div>
      <div class="sem" aria-label="Les routines de la semaine">
        <div><p>Lun</p><span><i class="av" data-a="growth" style="--s:18px"></i>Prospects</span><span><i class="av" data-a="growth" style="--s:18px"></i>Référencement</span></div>
        <div><p>Mar</p><span><i class="av" data-a="growth" style="--s:18px"></i>Prospects</span></div>
        <div><p>Mer</p><span><i class="av" data-a="val" style="--s:18px"></i>Tri du support</span></div>
        <div class="on"><p>Jeu</p><span><i class="av" data-a="growth" style="--s:18px"></i>Veille des prix</span></div>
        <div><p>Ven</p><span><i class="av" data-a="principal" style="--s:18px"></i>Bilan de la semaine</span></div>
        <div><p>Sam</p></div>
        <div><p>Dim</p><span><i class="av" data-a="diego-discord-ops" style="--s:18px"></i>Sauvegarde</span></div>
      </div>
    </div>
  </div>
</section>


<section class="outils" id="outils">
  <div class="gabarit">
    <header class="tete2 rv">
      <h2 class="h2">Avec les comptes que tu as déjà.</h2>
      <p class="p">Claude, ChatGPT ou Grok : chaque agent travaille avec le compte que tu relies.</p>
    </header>
    <div class="bento">
      <article class="c c--cerveau rv">
        <header><h3>Le modèle que tu veux.</h3><p>Pour un agent, ou pour une seule conversation.</p></header>
        <div class="selecteur">
          <p>Modèle d'Iris</p>
          <div class="sel__o sel__o--on"><b>Claude</b><span>Opus 5.5</span><i class="ic ic--s" data-i="check-02"></i></div>
          <div class="sel__o"><b>ChatGPT</b></div>
          <div class="sel__o"><b>Grok</b></div>
          
        </div>
      </article>
      <article class="c c--nav rv">
        <header><h3>Un navigateur à eux.</h3><p>Ils ouvrent les pages, les lisent et relèvent ce qu'il faut, avec leurs propres onglets.</p></header>
        <div class="mini-nav">
          <div class="mini-nav__b"><i></i><i></i><i></i><span>fournisseur.example/tarifs</span></div>
          <div class="mini-nav__c">
            <div class="mini-nav__tab">
              <p class="tete-t"><span>Référence</span><b>Prix HT</b></p>
              <p><span>Carton double cannelure, lot de 50</span><b>22,90 €</b></p>
              <p class="vis"><span>Adhésif renforcé, lot de 36</span><b>24,15 €</b></p>
              <p><span>Étiquette d'expédition, rouleau</span><b>18,70 €</b></p>
              <p><span>Film de calage, 100 m</span><b>16,35 €</b></p>
            </div>
            <span class="curseur" style="--c:#f3eec1"><i class="ic" data-i="cursor-arrow"></i><em>Sacha</em></span>
          </div>
        </div>
      </article>
      <article class="c c--pc rv">
        <header><h3>Ton ordinateur, si tu l'autorises.</h3><p>Ils cliquent et tapent à ta place, sous tes yeux.</p></header>
        <div class="pc">
          <div class="pc__b"><i></i><b>Diego agit sur cet ordinateur</b><span>Arrêter</span></div>
          <div class="pc__t">
            <p><span>Export_stock_fevrier</span><span>214 lignes</span></p>
            <p><span>Export_stock_janvier</span><span>198 lignes</span></p>
            <p><span>Exporter en CSV</span><span>⌘ E</span></p>
            <span class="curseur curseur--g" style="--c:#cde6bb"><i class="ic" data-i="cursor-arrow"></i><em>Diego</em></span>
          </div>
        </div>
      </article>
      <article class="c c--coffre rv">
        <header><h3>Les clés au coffre.</h3><p>Chiffrées, sur ton ordinateur comme sur ton serveur.</p></header>
        <ul class="coffre">
          <li><i class="ic ic--s" data-i="key-02"></i><span>Accès au stock</span><b>••••••••</b></li>
          <li><i class="ic ic--s" data-i="key-02"></i><span>Envoi des devis</span><b>••••••••</b></li>
          <li><i class="ic ic--s" data-i="key-02"></i><span>Mise en ligne</span><b>••••••••</b></li>
        </ul>
      </article>
    </div>
    <ul class="liste-o rv">
      <li><b>Tes services</b><p>Mail, agenda, drive : tu choisis le compte que tes agents utilisent, ou aucun.</p></li>
      <li><b>Tes dossiers</b><p>Tes agents travaillent dans tes projets, sur ton ordinateur ou ton serveur.</p></li>
    </ul>
  </div>
</section>


<section class="pin" id="telephone">
  <div class="pin__fixe" id="telFixe">
    <img id="photoTel" src="/homepage/art/ville-aube.jpg" alt="">
    <div id="voileTel" aria-hidden="true"></div>
    <div class="t-tel rv">
      <h2 class="h2">Tu suis et tu réponds depuis le téléphone.</h2>
      <p class="p">L'app web est sur app.klyra.fr. Tu y vois les conversations, le planning, les agents et les projets, et tu réponds.</p>
    </div>
    <div class="tel__e" id="telE" role="img" aria-label="Téléphone : le bilan du matin dans la conversation avec l'assistant">
      <div class="tel__h"><span>7:12</span><i></i></div>
      <div class="tel__t"><i class="ic" data-i="chevron-right" style="transform:scaleX(-1)"></i><span class="av" data-a="principal" style="--s:30px"></span><b>Assistant</b></div>
      <div class="tel__c">
        <p class="fil__date">Ce matin · 07:00</p>
        <div class="m m--a m--tel">
          <p><b>Le bilan.</b> <span id="telBilan"></span></p>
          <div class="tel-cartes">
            <div class="tel-carte"><span class="av" data-a="designer" style="--s:32px"></span><div><b>Maquette abonnements</b><small>Iris · 3 écrans</small></div><span class="ok">Voir</span></div>
            <div class="tel-carte"><span class="av" data-a="dev" style="--s:32px"></span><div><b>Mettre la page en ligne</b><small>Hugo · relue par Agathe</small></div><span class="ok">Voir</span></div>
            <div class="tel-carte"><span class="av" data-a="commercial" style="--s:32px"></span><div><b>11 relances prêtes</b><small>Thomas · 3 devis mis de côté</small></div><span class="ok">Voir</span></div>
          </div>
          <p>Val attend le numéro de commande de Mme&nbsp;Perrault.</p>
        </div>
        <div class="m m--moi m--tel"><p>Le numéro, c'est 48213. Je valide le reste en arrivant.</p></div>
        <span class="confie confie--tel"><span class="av" data-a="val" style="--s:22px"></span>Confié à Val</span>
        <div class="m m--a m--tel"><p>La réponse à Mme&nbsp;Perrault est prête. Tu la valides avec le reste.</p></div>
      </div>
      <div class="tel__s"><div class="saisie"><span>Écris à l'assistant…</span><div><i class="ic" data-i="paperclip-01"></i><span class="sp"></span><i class="ic" data-i="microphone-02"></i><b class="env"><i class="ic" data-i="arrow-up"></i></b></div></div></div>
    </div>
  </div>
</section>


<section class="feuille-page etapes" id="etapes">
  <div class="gabarit plan">
    <h2 class="h2 rv">Trois étapes pour commencer.</h2>
    <div class="trois">
      <article class="et rv"><span class="et__n">1</span><h3>Demande l'accès.</h3><p>L'accès se fait sur invitation, pour le moment.</p><div class="et__v"><div class="champ"><span>ton@adresse.fr</span><b>Demander</b></div></div></article>
      <article class="et rv"><span class="et__n">2</span><h3>Connecte ton compte.</h3><p>Claude, ChatGPT ou Grok, avec ton abonnement.</p><div class="et__v"><div class="puces"><span class="on">Claude</span><span>ChatGPT</span><span>Grok</span></div></div></article>
      <article class="et rv"><span class="et__n">3</span><h3>Écris ce qu'il faut faire.</h3><p>Tu l'écris à l'assistant. Tu ajoutes les agents qu'il te faut, ceux déjà prêts ou les tiens.</p><div class="et__v"><div class="champ"><span>Relance les devis ouverts…</span><b style="width:36px;padding:0"><i class="ic ic--s" data-i="arrow-up"></i></b></div></div></article>
    </div>
  </div>
</section>


<section class="outils questions" id="questions">
  <div class="gabarit plan q">
    <h2 class="h2 rv">Questions</h2>
    <div class="q__l rv">
      <details open><summary>Quels comptes je connecte ?</summary><p>Claude, ChatGPT ou Grok, avec ton abonnement. </p></details>
      <details><summary>Où vont mes données ?</summary><p>L'app est sur ton ordinateur. Si tu relies un serveur, il garde l'équipe, les conversations, les enchaînements et le coffre, même ordinateur fermé. Le coffre est chiffré. Ce que les agents envoient à Claude, ChatGPT ou Grok part sur le compte que tu as connecté.</p></details>
      <details><summary>Un agent peut-il agir sans me demander ?</summary><p>Oui, selon le niveau de l'endroit où il travaille : un pour l'ordinateur, un par serveur relié, le même pour tous les agents. « Me demander à chaque fois » : il lit seul, et il te demande avant de modifier un fichier ou de lancer une action. « Le projet en autonomie » : il avance seul tant que ça ne risque rien, et il te demande pour ce qui pourrait casser ou sortir du projet. « Tout accepter » : rien n'est demandé, chaque action est acceptée. Depuis le téléphone, tu peux baisser ce niveau, pas l'élargir : ça se fait sur l'ordinateur.</p></details>
      <details><summary>Qui peut l'utiliser ?</summary><p>L'accès se fait sur invitation, pour le moment.</p></details>
      <details><summary>Ça continue si l'ordinateur est fermé ?</summary><p>Sur un serveur, oui : l'équipe, le coffre et les enchaînements continuent. Sans serveur, le travail se fait sur l'ordinateur pendant qu'il est ouvert.</p></details>
    </div>
  </div>
</section>


<section id="acces">
  <div class="pin__fixe" id="finFixe">
    <canvas id="flipFin" aria-hidden="true"></canvas>
    <div class="fin" id="fin">
      <h2 class="h2 h2--xl">Confie le<br>premier travail.</h2>
      <p class="p">Tu demandes l'accès, tu connectes ton compte, et tu écris ce qu'il faut faire.</p>
      <div class="form" id="form">
        <span class="form__adresse">contact@klyra.fr</span>
        <a class="bp bp--clair" href="mailto:contact@klyra.fr?subject=Demande%20d%27acc%C3%A8s%20%C3%A0%20KLYRA"><span>Demander l'accès</span><i class="bp__ecran" aria-hidden="true"></i></a>
      </div>
      <p class="form__ok">Sur invitation. La demande s’ouvre dans ton application mail.</p>
    </div>
  </div>
</section>

</main>

<footer class="pied" id="pied">
  <div class="gabarit pied__l">
    <p class="pied__b">KLYRA, une équipe d'agents IA sur ton ordinateur, ton serveur et ton téléphone.</p>
    <div class="pied__c">
      <div><p>Produit</p><a href="#agents">Agents</a><a href="#suite" data-p="0">Tâches</a><a href="#outils">Outils</a><a href="https://github.com/KLYRA-FR/klyra-app-versions/releases/latest">Télécharger</a></div>
      <div><p>Suivre</p><a href="#questions">Questions</a><a href="/changelog/">Changelog</a></div>
      <div><p>KLYRA</p><a href="https://klyra.fr">klyra.fr</a><a href="mailto:contact@klyra.fr?subject=Demande%20d%27acc%C3%A8s%20%C3%A0%20KLYRA">Contact</a></div>
    </div>
  </div>
  <canvas id="fPied" aria-hidden="true"></canvas>
  <p class="pied__m"><span>© 2026 KLYRA</span><span>Démonstrations de l’app : contenus fictifs.</span></p>
</footer>
`;
