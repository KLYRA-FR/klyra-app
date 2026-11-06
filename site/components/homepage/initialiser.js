import { PASTELS, AGENTS, DEMOS, TICKETS, COLONNES, compte } from "./data";
import { creer, peindre, homographie, vitre, rng, clamp, lerp, smooth, masque, SIGNE, TYPO } from "./facade";
import { avatarSVG, poserAvatars, poserIcones, SIGNE_ICONE, formesSVG } from "./commun";

/** Moteur Canvas conservé de la maquette, isolé dans cette route.
 * @param {HTMLElement} racine
 * @returns {() => void}
 */
export function initialiserHomepage(racine) {
  const controle = new AbortController();
  
  
  
  const $ = (s, r = racine) => r.querySelector(s);
  const $$ = (s, r = racine) => [...r.querySelectorAll(s)];
  const CAPTURE = false;
  const signal = controle.signal;
  const E = { y: 0, vw: 0, vh: 0, now: 0, demo: 0, t0: 600 };
  const agentPar = Object.fromEntries(AGENTS.map((a) => [a.id, a]));
  const statique = () => racine.classList.contains("statique");

  /* ---- Construction ----------------------------------------------------- */
  const lg = $(".nav__logo svg");
  $(".lt", lg).setAttribute("d", TYPO);
  $(".ls", lg).setAttribute("d", SIGNE);
  const iconeK = `<svg viewBox="0 0 140.2 140.2"><rect width="140.2" height="140.2" rx="21" fill="#003fe4"/><path d="${SIGNE_ICONE}" fill="#fff"/></svg>`;
  const RAIL = [["grid-01", "accueil"], ["message-square", "chats"], ["list", "tickets"], ["calendar-02", "planning"], ["lightning-01", "auto"], ["package-02", "artefacts"]];
  $$(".rail").forEach((n) => {
    n.innerHTML = `<span class="rail__k">${iconeK}</span>` +
      RAIL.map(([i, k]) => `<span class="rail__i ${k === n.dataset.rail ? "on" : ""}"><i class="ic" data-i="${i}"></i></span>`).join("") +
      `<span class="rail__sep"></span><span class="rail__i"><i class="ic" data-i="folder"></i></span>`;
  });

  /* Écran de points du bouton Principal */
  const ecrans = $$(".bp__ecran");
  const ecranMaj = (t) => {
    const pas = Math.floor(t / 120) % 7;
    let s = "";
    for (let y = 0; y < 7; y++) for (let x = 0; x < 8; x++) {
      const dy = Math.abs(y - 3);
      const px = (x - pas + 14) % 7;
      const on = px === dy + 1 || px === (dy + 4) % 7;
      s += `<rect x="${3.2 + x * 3.9}" y="${3.6 + y * 3.9}" width="2.5" height="2.5" rx=".4" fill="#fff" opacity="${on ? 1 : 0.14}"/>`;
    }
    ecrans.forEach((e) => { e.innerHTML = `<svg viewBox="0 0 35 32">${s}</svg>`; });
  };
  ecranMaj(0);

  /* La démo : quatre conversations */
  const sel = $("#demoSel");
  DEMOS.forEach((d, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = d.sel; 
    b.setAttribute("aria-pressed", i === 0 ? "true" : "false");
    b.addEventListener("click", () => choisir(i, E.now), { signal });
    sel.append(b);
  });
  const CHATS = (d) => {
    const dansLaTache = [...new Set(d.taches.map((t) => t[0]))];
    const autres = ["designer", "dev", "commercial", "val"].filter((a) => !dansLaTache.includes(a));
    const lignes = [["principal", d.moi, true], ...dansLaTache.map((a) => [a, d.taches.find((t) => t[0] === a)[1]])];
    for (const a of autres) if (lignes.length < 5) lignes.push([a, agentPar[a].quoi]);
    return lignes;
  };
  const poser = (i) => {
    const d = DEMOS[i];
    $("#filCorps").innerHTML =
      `<p class="fil__date">Aujourd'hui · 16:42</p>` +
      `<div class="m m--moi" data-etape="0"><p>${d.moi}</p></div>` +
      `<div class="m m--a" data-etape="1"><p>${d.rep}</p></div>` +
      `<div class="confies" data-etape="2">${[...new Set(d.taches.map((t) => t[0]))].map((a) => `<span class="confie"><span class="av" data-a="${a}" style="--s:22px"></span>Confié à ${agentPar[a].nom}</span>`).join("")}</div>` +
      `<div class="trav" data-etape="3"><div class="trav__t"><span class="av" id="travA" style="--s:22px"></span><em id="travQ"></em><span id="travN"></span></div><span class="trav__b"><i id="travB"></i></span><div class="trav__a" id="travV"><span class="o">Valider</span><span class="s">Voir</span></div></div>`;
    $("#filTaches").innerHTML = d.taches.map(([a, t]) => `<li data-etape="2"><span class="av" data-a="${a}" style="--s:26px"></span><div><b>${t}</b><small data-nom="${agentPar[a].nom}"></small></div></li>`).join("");
    $("#nbTaches").textContent = d.taches.length;
    $("#chatsAgents").innerHTML = CHATS(d).map(([id, s, on]) => {
      const a = agentPar[id];
      return `<li class="ch-l ${on ? "on" : ""}"><span class="av" data-a="${id}" style="--s:36px"></span><div><span class="ch-l__n"><b>${a.nom}</b><span class="tag">${id === "principal" ? "Assistant" : a.tag}</span></span><small>${s}</small></div></li>`;
    }).join("");
    poserAvatars($("#appChat"));
    E.etapes = $$("[data-etape]", $("#appChat")).map((el) => [el, +el.dataset.etape]);
  };
  const choisir = (i, t) => {
    E.demo = i; E.t0 = mouvement.matches ? t - 7000 : t; poser(i);
    $$("button", sel).forEach((b, k) => b.setAttribute("aria-pressed", k === i ? "true" : "false"));
    image();
  };
  poser(0);

  /* Les cartes des agents */
  $("#cartes").innerHTML = AGENTS.map((a, i) => {
    const fond = a.id === "principal" ? "" : `background:linear-gradient(147.66deg,${PASTELS[a.teinte].bas} .4%,${PASTELS[a.teinte].haut} 93.65%)`;
    return `<article class="ag rv ${a.id === "principal" ? "ag--a" : ""}" data-d="${(i % 5) * 26}" style="${fond}">${formesSVG(a.id)}<b>${a.nom}</b><em>${a.tag}</em><p>${a.quoi}</p></article>`;
  }).join("") + `<article class="ag ag--plus rv"><span class="plus"><i class="ic" data-i="plus-01"></i></span><b>Le tien</b><p>Décris le métier à l'assistant. Il écrit la fiche, tu la modifies quand tu veux.</p></article>`;

  /* Le tableau */
  $("#tkTotal").textContent = `· ${TICKETS.length}`;
  const carte = (t) => {
    const prog = t.prog ? `<div class="t-c__p"><i><b style="width:${(t.prog[0] / t.prog[1]) * 100}%"></b></i>${t.prog[0]}/${t.prog[1]}</div>` : "";
    const det = t.detail ? `<div class="t-c__d">${t.detail}</div>` : "";
    const rai = t.raison ? `<div class="t-c__r">${t.raison}</div>` : "";
    const act = t.etape === "a-valider" ? `<div class="t-c__a"><span class="o">Valider</span><span class="s">Voir</span></div>` : "";
    return `<div class="t-c__t">${t.titre}</div>${det}${rai}${prog}${act}<div class="t-c__b"><span class="av" data-a="${t.agent}" style="--s:20px"></span><span>${t.projet}</span><time>${t.heure}</time></div>`;
  };
  const prT = TICKETS.find((t) => t.pr);
  $("#tkColonnes").innerHTML = COLONNES.map((col) => {
    const ts = TICKETS.filter((t) => t.etape === col.id);
    const avant = col.id === "en-cours" ? `<article class="t-c" id="carteAvant" style="visibility:hidden">${carte(prT)}</article>` : "";
    return `<section class="tk__col ${col.id === "a-valider" ? "tk__col--v" : ""}"><header class="tk__h">${col.nom}<span data-c="${col.id}">${ts.length}</span></header>${ts.map((t) => `<article class="t-c" ${t.pr ? 'id="carte"' : ""}>${carte(t)}</article>`).join("")}${avant}</section>`;
  }).join("");
  $("#mT").innerHTML = carte(prT);
  $("#demandeFixe").innerHTML = `<div class="demande__c">${$("#mD").innerHTML}</div>`;
  $("#telBilan").textContent = `${compte("termine")} tickets terminés. 3 t'attendent :`;

  poserAvatars();
  poserIcones();

  /* ---- Trame plate : les fenêtres sans l'immeuble --------------------------- */
  const CW = 28, CH = 31;
  const dessinerTrame = (cv, { intro = 1e9, graine = 7, part = 0.075 }) => {
    const b = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== Math.round(b.width * dpr)) { cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr); }
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, b.width, b.height);
    const r = rng(graine);
    for (let y = 3; y < b.height; y += CH) for (let x = 3; x < b.width; x += CW) {
      const t = r(), u = r(), w = r();
      if (t < part && y > 76) {
        const a = smooth((intro - u * 1500) / 420);
        g.fillStyle = `rgba(190,215,255,.08)`;
        g.fillRect(x, y, CW - 7, CH - 8);
        if (a > 0) {
          g.globalAlpha = a;
          g.shadowColor = "rgba(255,190,120,.7)"; g.shadowBlur = 13;
          const gl = g.createLinearGradient(0, y, 0, y + CH - 8);
          gl.addColorStop(0, "#fff3dc"); gl.addColorStop(1, "#ffc982");
          g.fillStyle = gl;
          g.fillRect(x, y, CW - 7, CH - 8);
          g.shadowBlur = 0; g.globalAlpha = 1;
        }
      } else {
        g.fillStyle = `rgba(190,215,255,${(0.05 + w * 0.05).toFixed(3)})`;
        g.fillRect(x, y, CW - 7, CH - 8);
      }
    }
  };

  /* ---- La façade de la séquence ---------------------------------------------- */
  const refl = new Image();
  refl.src = "/homepage/art/ville-heure-bleue.jpg";
  const COLS = 30, ROWS = 46, CO = 23, RO = 16;
  const spec = creer({ cols: COLS, rows: ROWS, seed: 909, choix: (c, r, rand) => {
    const x = rand(), y = rand();
    if (c === CO && r === RO) return { ton: "orange", v: 13, lumi: 1, fixe: 1 };
    return x < 0.27 ? { ton: x < 0.22 ? "chaud" : "ecran", ordre: y } : null;
  } });
  const DIST = 5600;
  const S = {};
  const mesurerSuite = () => {
    const st = $("#stage").getBoundingClientRect();
    S.W = st.width; S.H = st.height;
    S.dpr = Math.min(devicePixelRatio || 1, 2);
    const cv = $("#f");
    cv.width = Math.round(S.W * S.dpr); cv.height = Math.round(S.H * S.dpr);
    const box = $("#arriere").getBoundingClientRect();
    const rel = (el) => { const c = el.getBoundingClientRect(); return [c.left - box.left, c.top - box.top, c.width, c.height]; };
    S.R0 = rel($("#carte"));
    S.Rv = rel($("#carteAvant"));
    const mD = $("#mD");
    const dh = mD.offsetHeight || 470;
    const gx = parseFloat(getComputedStyle($(".t-nuit")).left) || 72;
    S.R1 = [S.W - gx - 480, S.H - dh - 40, 480, dh];
    /* Gros plan : la fenêtre orange juste au-dessus de la carte. */
    const cw = (1.08 * S.W) / COLS, ch = cw * 0.88;
    const x0 = S.R1[0] + 300 - (CO + 0.5) * cw, y0 = S.R1[1] - 100 - (RO + 0.42) * ch;
    const x1 = x0 + COLS * cw, y1 = y0 + ROWS * ch;
    S.q0 = [[x0, y0], [x1, y0 + 20], [x1 - 14, y1 + 10], [x0 + 14, y1]];
    const W = S.W, H = S.H;
    S.q1 = [[0.56 * W, 0.2 * H], [0.95 * W, 0.1 * H], [0.97 * W, 1.05 * H], [0.55 * W, 1.04 * H]];
    S.off = document.createElement("canvas");
    S.off.width = cv.width; S.off.height = cv.height;
    for (const f of spec.fenetres) if (!f.fixe) f.lumi = 0;
    peindre(S.off.getContext("2d"), S.dpr, spec, S.q0, { W, H, plaque: refl, reflet: 0.3, brume: 0, base: "#020717", liseret: "90,120,190", now: 1e9, niveau: (f) => f.lumi });
    const Hq = homographie(S.q0);
    const r = rng(404);
    const ox = S.R0[0] + S.R0[2] / 2, oy = S.R0[1] + S.R0[3] / 2;
    const dmax = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy));
    S.ordre = [];
    for (let rr = 0; rr < ROWS; rr++) for (let cc = 0; cc < COLS; cc++) {
      const a = Hq(cc / COLS, rr / ROWS), b = Hq((cc + 1) / COLS, rr / ROWS), d = Hq((cc + 1) / COLS, (rr + 1) / ROWS), e = Hq(cc / COLS, (rr + 1) / ROWS);
      if (Math.max(a[1], b[1]) < -5 || Math.min(d[1], e[1]) > H + 5) { r(); continue; }
      S.ordre.push({ a, b, d, e, t: (Math.hypot((a[0] + d[0]) / 2 - ox, (a[1] + d[1]) / 2 - oy) / dmax) * 0.74 + r() * 0.16 });
    }
    S.fen = vitre(Hq, spec, CO, RO);
    S.wf = $$("#wfL .wf__n");
    S.wfI = $$("#wfL > i");
    S.prec = -1;
  };

  const pts = (x, seg) => {
    if (x <= seg[0][0]) return seg[0][1];
    for (let i = 1; i < seg.length; i++) if (x <= seg[i][0]) return lerp(seg[i - 1][1], seg[i][1], smooth((x - seg[i - 1][0]) / (seg[i][0] - seg[i - 1][0])));
    return seg[seg.length - 1][1];
  };
  const eOut = (t) => 1 - Math.pow(1 - clamp(t), 3);

  /* p va de 0 à 1 sur toute la séquence. Les seuils sont aussi lus par la barre de navigation. */
  const SEUIL = { mv: [0.015, 0.06], f: [0.09, 0.29], c: [0.45, 0.53], r: [0.51, 0.7], s: [0.8, 0.92], k: [0.92, 0.96], i: [0.965, 1] };
  const prog = ([a, b], p) => clamp((p - a) / (b - a));

  const dessinerSuite = (p) => {
    if (p === S.prec) return;
    S.prec = p;
    const { W, H, dpr } = S;
    const cv = $("#f"), ctx = cv.getContext("2d");
    const pm = prog(SEUIL.mv, p), pf = prog(SEUIL.f, p), pc = prog(SEUIL.c, p), pr = prog(SEUIL.r, p), ps = prog(SEUIL.s, p), pk = prog(SEUIL.k, p), pi = prog(SEUIL.i, p);
    $("#clair").style.display = pf >= 1 ? "none" : "block";
    $("#plaque").style.opacity = pf >= 1 ? 1 : 0;
    $("#pv").style.opacity = smooth(pr * 1.4);

    /* Le ticket passe en À valider */
    const compteurs = { "en-cours": compte("en-cours") + (pm < 0.5 ? 1 : 0), "a-valider": compte("a-valider") - (pm < 0.5 ? 1 : 0) };
    for (const [k, v] of Object.entries(compteurs)) { const el = $(`[data-c="${k}"]`); if (el.textContent !== String(v)) el.textContent = v; }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cv.width, cv.height);
    if (pf > 0 && pf < 1) {
      /* Le fond se retourne, fenêtre par fenêtre, depuis la carte. */
      ctx.save();
      ctx.beginPath();
      for (const c of S.ordre) {
        const k = smooth((pf - c.t) / 0.1);
        if (k <= 0) continue;
        const dx = c.a[0] + (c.e[0] - c.a[0]) * k, dy = c.a[1] + (c.e[1] - c.a[1]) * k;
        const fx = c.b[0] + (c.d[0] - c.b[0]) * k, fy = c.b[1] + (c.d[1] - c.b[1]) * k;
        ctx.moveTo(c.a[0] * dpr - 0.5, c.a[1] * dpr - 0.5);
        ctx.lineTo(c.b[0] * dpr + 0.5, c.b[1] * dpr - 0.5);
        ctx.lineTo(fx * dpr + 0.5, fy * dpr + 0.5);
        ctx.lineTo(dx * dpr - 0.5, dy * dpr + 0.5);
        ctx.closePath();
      }
      ctx.clip();
      ctx.drawImage(S.off, 0, 0);
      ctx.restore();
    } else if (pf >= 1 && pr <= 0) {
      ctx.drawImage(S.off, 0, 0);
    } else if (pr > 0 && pk < 1) {
      /* La caméra recule, même immeuble. Les fenêtres s'allument. */
      const z = Math.pow(1 / 2.8, smooth(pr));
      const e = (1 - z) / (1 - 1 / 2.8);
      const q = S.q0.map((a, i) => [lerp(a[0], S.q1[i][0], e), lerp(a[1], S.q1[i][1], e)]);
      const pl = clamp((p - 0.57) / 0.17);
      for (const f of spec.fenetres) if (!f.fixe && f.ton) f.lumi = smooth((pl - f.ordre * 0.8) / 0.2);
      peindre(ctx, dpr, spec, q, { W, H, plaque: refl, reflet: 0.3 + 0.2 * pr, brume: 0.08 * pr, base: "#020717", liseret: "130,170,240", now: 1e9, niveau: (f) => f.lumi, haloK: 0.5 });
      const et = $("#etVps");
      et.style.transform = `translate(${q[0][0] + 10}px, ${Math.max(q[0][1] - 58, 82)}px)`;
    }
    $("#etVps").style.opacity = smooth((p - 0.64) / 0.05);

    /* La carte : ticket, puis demande, puis elle rentre dans la fenêtre. */
    const m = $("#morph");
    const tt = eOut(pf / 0.62);
    let r0 = [0, 1, 2, 3].map((i) => lerp(S.Rv[i], S.R0[i], smooth(pm)));
    let r = [0, 1, 2, 3].map((i) => lerp(r0[i], S.R1[i], tt));
    if (pc > 0) {
      const v = S.fen;
      const wr = [v[0][0], v[0][1], v[1][0] - v[0][0], v[3][1] - v[0][1]];
      const tc = smooth(pc);
      r = [0, 1, 2, 3].map((i) => lerp(S.R1[i], wr[i], tc));
    }
    m.style.left = `${r[0]}px`; m.style.top = `${r[1]}px`; m.style.width = `${r[2]}px`; m.style.height = `${r[3]}px`;
    m.style.borderRadius = `${lerp(10, 20, tt)}px`;
    m.style.boxShadow = `0 ${lerp(2, 30, tt)}px ${lerp(6, 70, tt)}px rgba(0,0,0,${lerp(0.05, 0.45, tt)})`;
    m.style.opacity = 1 - smooth((pc - 0.8) / 0.2);
    m.style.visibility = pc >= 1 ? "hidden" : "visible";
    const mT = $("#mT"), mD = $("#mD");
    mT.style.width = `${S.R0[2]}px`;
    mT.style.transform = `scale(${r[2] / S.R0[2]})`;
    mD.style.transform = `scale(${r[2] / 480})`;
    mT.style.opacity = 1 - smooth((tt - 0.28) / 0.22);
    mD.style.opacity = smooth((tt - 0.32) / 0.24);
    $("#carte").style.visibility = "hidden";

    /* Le fil entre la fenêtre et la carte */
    const fil = $("#fil"), v = S.fen;
    const fx = (v[2][0] + v[3][0]) / 2, fy = (v[2][1] + v[3][1]) / 2;
    fil.style.left = `${fx}px`; fil.style.top = `${fy}px`; fil.style.height = `${Math.max(0, S.R1[1] - fy)}px`;
    fil.style.opacity = smooth((p - 0.27) / 0.03) * (1 - smooth(pc / 0.25));

    /* Titres */
    const tA = $("#tAccord"), tS = $("#tServeur");
    const oA = pts(p, [[0.21, 0], [0.28, 1], [0.45, 1], [0.5, 0]]);
    tA.style.opacity = oA; tA.style.transform = `translateY(calc(-50% + ${(1 - oA) * 16}px))`;
    const oS = pts(p, [[0.61, 0], [0.68, 1]]);
    tS.style.opacity = oS; tS.style.transform = `translateY(calc(-50% + ${(1 - oS) * 16}px))`;

    /* La feuille cobalt monte, l'immeuble recule. */
    const f = $("#routines");
    const ks = smooth(ps);
    f.style.transform = `translateY(${(1 - ks) * 100}%)`;
    f.style.visibility = ps > 0 ? "visible" : "hidden";
    const rayon = lerp(28, 0, smooth((ps - 0.7) / 0.3));
    const ar = $("#arriere");
    ar.style.transform = `scale(${1 - 0.07 * ks})`;
    ar.style.filter = ks > 0 ? `brightness(${1 - 0.45 * ks})` : "none";
    ar.style.visibility = ps >= 1 ? "hidden" : "visible";

    /* Le workflow avance jusqu'à l'accord */
    const av = pk * 3;
    S.wf.forEach((n, i) => {
      const on = av >= i - 0.02 && av < i + 1 && i < 3;
      n.classList.toggle("encours", on);
      n.classList.toggle("att", i === 3 && pk >= 0.98);
      let em = $("em", n);
      if (on && !em) { em = document.createElement("em"); em.textContent = "en cours"; n.append(em); }
      if (!on && em) em.remove();
    });
    S.wfI.forEach((l, i) => l.style.setProperty("--k", clamp(av - i).toFixed(3)));

    /* La section se range : elle devient une carte sur le blanc. */
    const ki = smooth(pi);
    $("#stage").style.background = pi > 0 ? "#fff" : "#000d2e";
    f.style.clipPath = ps >= 1 ? `inset(0 ${lerp(0, 32, ki)}px ${lerp(0, 24, ki)}px ${lerp(0, 32, ki)}px round 0 0 ${lerp(0, 28, ki)}px ${lerp(0, 28, ki)}px)` : `inset(0 0 0 0 round ${rayon}px ${rayon}px 0 0)`;
  };

  /* ---- La fin : le fond se retourne vers le cobalt ------------------------------ */
  const F = {};
  const mesurerFin = () => {
    const cv = $("#flipFin"), b = cv.getBoundingClientRect();
    F.W = b.width; F.H = b.height; F.dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(F.W * F.dpr); cv.height = Math.round(F.H * F.dpr);
    F.cells = [];
    const r = rng(77), w = 56, h = 62;
    for (let y = 0; y < F.H; y += h) for (let x = 0; x < F.W; x += w) {
      F.cells.push({ x, y, w, h, t: (y / F.H) * 0.72 + r() * 0.18 });
    }
    F.prec = -1;
    F.dist = $("#acces").offsetHeight - E.vh;
  };
  const coulFin = (g) => {
    const l = g.createLinearGradient(0, 0, 0, F.H);
    l.addColorStop(0, "#003fe4"); l.addColorStop(1, "#001f8a");
    return l;
  };
  const dessinerFin = (p) => {
    if (p === F.prec) return;
    F.prec = p;
    const g = $("#flipFin").getContext("2d");
    g.setTransform(F.dpr, 0, 0, F.dpr, 0, 0);
    g.clearRect(0, 0, F.W, F.H);
    g.fillStyle = coulFin(g);
    if (p >= 1) { g.fillRect(0, 0, F.W, F.H); }
    else if (p > 0) {
      g.beginPath();
      for (const c of F.cells) {
        const k = smooth((p - c.t) / 0.1);
        if (k > 0) g.rect(c.x - 0.5, c.y - 0.5, c.w + 1, c.h * k + 1);
      }
      g.fill();
    }
    const o = smooth((p - 0.5) / 0.3);
    const fin = $("#fin");
    fin.style.opacity = o;
    fin.style.transform = `translateY(${(1 - o) * 18}px)`;
    fin.style.pointerEvents = o > 0.8 ? "auto" : "none";
    fin.inert = o <= 0.8;
  };

  /* Le pied : le logotype écrit par les fenêtres */
  const dessinerPied = () => {
    const cv = $("#fPied");
    const largeur = cv.parentElement.getBoundingClientRect().width;
    const cols = largeur < 640 ? 72 : 148, cw = largeur / cols;
    const ch = cw * 1.04;
    const rows = Math.ceil((187.856 * (cols - 8)) / 691.141) + 4;
    cv.style.height = `${rows * ch}px`;
    const b = cv.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr);
    const g = cv.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = masque(SIGNE, [172.104, 172.104]), t = masque(TYPO, [691.141, 187.856]);
    const ech = (cols - 8) / 691.141;
    const r = rng(515);
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const lx = (x + 0.5 - 4) / ech, ly = (y + 0.5 - 2) / ech;
      const u = r();
      const dans = a(lx, ly) || t(lx, ly);
      if (dans) {
        const gl = g.createLinearGradient(0, y * ch, 0, (y + 1) * ch);
        gl.addColorStop(0, "#fff3dc"); gl.addColorStop(1, "#ffd79a");
        g.fillStyle = gl;
      } else if (u < 0.012) g.fillStyle = "#ffc982";
      else g.fillStyle = `rgba(190,215,255,${(0.05 + (u % 0.1) * 0.5).toFixed(3)})`;
      g.fillRect(x * cw + cw * 0.12, y * ch + ch * 0.12, cw * 0.76, ch * 0.76);
    }
  };

  /* Images fixes en mode statique */
  const dessinerStatique = () => {
    const accord = $("#fA"), serv = $("#fS");
    const peint = (cv, sp, quad, opts) => {
      const b = cv.getBoundingClientRect();
      if (!b.width) return;
      const dpr = Math.min(devicePixelRatio || 1, 2);
      cv.width = Math.round(b.width * dpr); cv.height = Math.round(b.height * dpr);
      peindre(cv.getContext("2d"), dpr, sp, quad(b.width, b.height), { W: b.width, H: b.height, plaque: refl, now: 1e9, brume: 0, base: "#020717", liseret: "90,120,190", reflet: 0.3, ...opts });
    };
    /* Sur petit écran, la fenêtre orange tomberait sur le titre : la façade reste éteinte. */
    const spA = creer({ cols: 20, rows: 40, seed: 88, choix: (c, r) => (innerWidth >= 900 && c === 18 && r === 6 ? { ton: "orange", v: 13, at: 0 } : null) });
    peint(accord, spA, (W, H) => [[-20, -20], [W + 20, -10], [W + 20, Math.max(H, W * 1.8)], [-20, Math.max(H, W * 1.8)]], {});
    for (const f of spec.fenetres) if (!f.fixe && f.ton) f.lumi = 1;
    peint(serv, spec, (W, H) => [[W * 0.42, H * 0.6], [W * 1.05, H * 0.56], [W * 1.08, H * 1.3], [W * 0.4, H * 1.26]], { niveau: (f) => f.lumi, reflet: 0.4, haloK: 0.4 });
  };

  /* ---- Mesures ---------------------------------------------------------------------- */
  const M = {};
  const mesurer = () => {
    E.vw = innerWidth; E.vh = innerHeight;
    racine.style.setProperty("--dist", `${DIST}px`);
    const haut = (el) => el.getBoundingClientRect().top + scrollY;
    if (statique()) {
      $("#fin").inert = false;
      M.rv = $$(".rv");
      M.rv.forEach((e) => { e.style.opacity = 1; e.style.translate = "none"; });
      M.max = document.documentElement.scrollHeight - E.vh;
      dessinerTrame($("#trame"), {});
      dessinerStatique();
      dessinerPied();
      M.nav = null;
      return;
    }
    M.heroZoom = E.vh * 0.9; M.heroTenue = E.vh * 0.5;
    $("#hero").style.height = `${E.vh + M.heroZoom + M.heroTenue + E.vh}px`;
    M.telOuv = E.vh * 1.1; M.telTenue = E.vh * 0.35;
    $("#telephone").style.height = `${E.vh + M.telOuv + M.telTenue + E.vh}px`;
    /* L'app part juste sous le texte du hero, et remonte. */
    const tBas = $(".hero__note").getBoundingClientRect();
    M.demoY0 = tBas.bottom - $("#heroFixe").getBoundingClientRect().top + 16;
    M.demoY1 = 78;
    M.suite = haut($("#suite"));
    M.outils = haut($("#outils"));
    M.tel = haut($("#telephone"));
    M.etapes = haut($("#etapes"));
    M.acces = haut($("#acces"));
    M.pied = haut($("#pied"));
    M.agents = haut($("#agents"));
    M.rv = $$(".rv").map((el) => ({ el, d: +el.dataset.d || 0, v: -1 }));
    M.max = document.documentElement.scrollHeight - E.vh;
    mesurerSuite();
    mesurerFin();
    dessinerTrame($("#trame"), { intro: CAPTURE ? 1e9 : 0, graine: 7 });
    dessinerPied();
    E.prec = -1;
  };

  /* Quel fond sous la barre ? */
  const navJour = (y) => {
    if (y < M.agents - 60) return false;
    if (y < M.suite) return true;
    const ps = clamp((y - M.suite) / DIST);
    if (y < M.suite + DIST) return prog(SEUIL.f, ps) < 0.8;
    if (y < M.outils - 36) return false;
    return y < M.acces - 36;
  };

  const ZONES = [["#hero", false], ["#agents", true], ["#clair", true], ["#bAccord", false], ["#bServeur", false], ["#routines", false], ["#outils", true], ["#telephone", true], ["#etapes", true], ["#questions", true], ["#acces", false], ["#pied", false]];

  /* ---- Une image ----------------------------------------------------------------------- */
  const image = () => {
    const y = E.y;
    if (statique()) {
      /* En flux : la conversation et le bouton vivent, le reste est posé. */
      demoTemps();
      if (y !== E.prec) {
        let jour = false;
        for (const [s, clair] of ZONES) {
          const b = $(s).getBoundingClientRect();
          if (b.top <= 30 && b.bottom > 30) jour = clair;
        }
        const nav = $("#nav");
        nav.classList.toggle("jour", jour);
        nav.style.setProperty("--nav-fond", y > 20 ? 1 : 0);
        E.prec = y;
      }
      return;
    }
    const vh = E.vh;
    const change = y !== E.prec;

    /* Hero, puis l'app, puis la feuille blanche */
    if (y < M.heroZoom + M.heroTenue + vh + 10) {
      const p = clamp(y / M.heroZoom);
      const k = smooth(p);
      const t = $("#heroT");
      t.style.opacity = 1 - smooth(p / 0.46);
      t.style.transform = `translateY(${(-k * 60).toFixed(1)}px)`;
      t.style.visibility = p > 0.5 ? "hidden" : "visible";
      $("#demo").style.transform = `translateY(${lerp(M.demoY0, M.demoY1, k).toFixed(1)}px)`;
      const ks = smooth((y - M.heroZoom - M.heroTenue) / vh);
      const fx = $("#heroFixe");
      fx.style.transform = ks > 0 ? `scale(${1 - 0.06 * ks})` : "none";
      fx.style.filter = ks > 0 ? `brightness(${1 - 0.5 * ks})` : "none";
      if (E.now < 1900 && !CAPTURE) dessinerTrame($("#trame"), { intro: E.now, graine: 7 });
      demoTemps();
    }

    /* La séquence */
    if (y > M.suite - vh && y < M.suite + DIST + vh) dessinerSuite(clamp((y - M.suite) / DIST));

    /* Téléphone : la photo s'ouvre */
    if (y > M.tel - vh && y < M.tel + M.telOuv + M.telTenue + vh * 1.2) {
      const p = clamp((y - M.tel) / M.telOuv);
      const k = smooth(p);
      /* La photo s'ouvre en fondu, avec un léger recul. */
      const photo = $("#photoTel");
      photo.style.opacity = k.toFixed(3);
      photo.style.transform = `scale(${(1.07 - 0.07 * k).toFixed(4)})`;
      $("#voileTel").style.opacity = k.toFixed(3);
      $("#telE").style.transform = `translateY(${lerp(170, 0, smooth(clamp((y - M.tel + vh * 0.7) / (vh * 1.1)))).toFixed(1)}px)`;
      const ks = smooth((y - M.tel - M.telOuv - M.telTenue) / vh);
      const fx = $("#telFixe");
      fx.style.transform = ks > 0 ? `scale(${1 - 0.05 * ks})` : "none";
      fx.style.filter = ks > 0 ? `brightness(${1 - 0.3 * ks})` : "none";
    }

    /* La fin */
    if (y > M.acces - vh) dessinerFin(clamp((y - (M.acces - vh * 0.92)) / (F.dist + vh * 0.92)));

    /* Apparitions */
    if (change) {
      for (const it of M.rv) {
        const b = it.el.getBoundingClientRect();
        const q = smooth((vh * 0.96 - b.top - it.d) / (vh * 0.2));
        if (Math.abs(q - it.v) < 0.002) continue;
        it.v = q;
        it.el.style.opacity = q.toFixed(3);
        it.el.style.translate = `0 ${((1 - q) * 18).toFixed(1)}px`;
      }
      const nav = $("#nav");
      nav.classList.toggle("jour", navJour(y));
      /* Transparente seulement sur une scène épinglée, jamais quand une section défile dessous. */
      const fond = y < M.heroZoom * 0.2 ? 0 : (y >= M.suite + DIST * SEUIL.f[0] && y <= M.suite + DIST) ? 0 : (y >= M.acces - 4 && y < M.pied - 80) ? 0 : 1;
      nav.style.setProperty("--nav-fond", fond);
    }
    E.prec = y;
  };

  /* La conversation se joue toute seule */
  const demoTemps = () => {
    const t = E.now - E.t0;
    for (const [el, e] of E.etapes) {
      const q = smooth((t - [0, 900, 1800, 2500][e]) / 420);
      el.style.opacity = q.toFixed(3);
      el.style.transform = `translateY(${((1 - q) * 8).toFixed(1)}px)`;
    }
    /* Les tâches avancent une à une, puis tout t'attend pour valider. */
    const d = DEMOS[E.demo], nb = d.taches.length, PAS = 750, DEB = 2900;
    const fait = clamp(Math.floor((t - DEB) / PAS), 0, nb);
    const k = smooth((t - DEB - PAS * nb) / 320);
    const pret = fait === nb;
    const cle = `${E.demo}/${fait}`;
    if (E.travCle !== cle) {
      E.travCle = cle;
      const [ag, tache] = d.taches[Math.min(fait, nb - 1)];
      $("#travA").innerHTML = avatarSVG(pret ? "principal" : ag);
      $("#travQ").textContent = pret ? "Prêt à valider" : `${agentPar[ag].nom} · ${tache}`;
      $("#travN").textContent = `${fait}/${nb}`;
      $$("#filTaches small").forEach((s, i) => {
        s.textContent = `${s.dataset.nom} · ${i < fait ? (pret && i === nb - 1 ? "à valider" : "fait") : i === fait ? "en cours" : "à faire"}`;
      });
    }
    $("#travB").style.transform = `scaleX(${clamp((t - DEB) / (PAS * nb)).toFixed(3)})`;
    const bar = $(".trav__b");
    bar.style.height = `${(4 * (1 - k)).toFixed(1)}px`;
    bar.style.marginTop = `${(9 * (1 - k)).toFixed(1)}px`;
    bar.style.opacity = (1 - k).toFixed(3);
    const v = $("#travV");
    v.style.height = `${(28 * k).toFixed(1)}px`;
    v.style.marginTop = `${(10 * k).toFixed(1)}px`;
    v.style.opacity = k.toFixed(3);
    ecranMaj(E.now);
  };

  /* ---- Boucle ---------------------------------------------------------------------------- */
  let t0 = 0;
  const mouvement = matchMedia("(prefers-reduced-motion: reduce)");
  const boucle = (ts) => {
    if (!t0) t0 = ts;
    if (signal.aborted) return;
    E.now = mouvement.matches ? 1e9 : ts - t0;
    E.y = window.scrollY;
    image();
    if (!mouvement.matches) raf = requestAnimationFrame(boucle);
  };

  /* ---- Liens de la barre : les positions dans la séquence ------------------------------------ */
  $$("a[data-p]").forEach((a) => a.addEventListener("click", (e) => {
    if (statique()) return;
    e.preventDefault();
    window.scrollTo(0, M.suite + DIST * parseFloat(a.dataset.p));
  }, { signal }));
  $$('a[href="#acces"]').forEach((a) => a.addEventListener("click", (e) => {
    if (statique()) return;
    e.preventDefault();
    window.scrollTo(0, M.acces + F.dist);
  }, { signal }));


  let raf = 0, rt;
  const stylesInitiaux = new Map($$(".rv, #hero, #telephone, #heroT, #demo, #heroFixe, #arriere, #carte, #carteAvant, #clair, #morph, #mT, #mD, #tAccord, #tServeur, #routines, #etVps, #photoTel, #voileTel, #telE, #telFixe, #fin").map((el) => [el, el.getAttribute("style")]));
  const nettoyerStyles = () => {
    for (const [el, style] of stylesInitiaux) {
      if (style === null) el.removeAttribute("style");
      else el.setAttribute("style", style);
    }
  };
  const redimensionner = () => {
    cancelAnimationFrame(raf);
    nettoyerStyles();
    racine.classList.toggle("statique", innerWidth < 1180 || mouvement.matches);
    $("#fin").inert = !statique();
    mesurer();
    E.prec = -1; F.prec = -1;
    if (S) S.prec = -1;
    E.y = window.scrollY;
    if (mouvement.matches) { E.now = 1e9; E.t0 = E.now - 7000; }
    else if (E.now > 1e8) { E.now = 0; E.t0 = -7000; t0 = 0; }
    image();
    if (!mouvement.matches) raf = requestAnimationFrame(boucle);
  };
  Promise.all([
    document.fonts.ready,
    ...[refl, $("#plaque"), $("#photoTel")].map((im) => im.decode().catch(() => undefined)),
  ]).then(() => {
    if (signal.aborted) return;
    redimensionner();
    // L’épinglage change la hauteur du hero après le premier rendu statique.
    // Replacer les liens directs et le retour depuis le changelog après mesure.
    const id = location.hash.slice(1);
    const cible = id === "fonctionnalites" ? $("#agents") : id ? $(`#${CSS.escape(id)}`) : null;
    if (cible) {
      const haut = id === "acces" && !statique()
        ? M.acces + F.dist
        : cible.getBoundingClientRect().top + scrollY - $("#nav").offsetHeight;
      window.scrollTo(0, Math.max(0, haut));
      E.y = scrollY; E.prec = -1;
      image();
    }
    racine.dataset.pret = "true";
  }).catch((erreur) => {
    if (!signal.aborted) {
      racine.classList.add("statique");
      $("#fin").inert = false;
      console.error("La démonstration KLYRA n’a pas pu démarrer.", erreur);
    }
  });
  addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(redimensionner, 80);
  }, { signal });
  mouvement.addEventListener("change", redimensionner, { signal });
  addEventListener("scroll", () => {
    if (mouvement.matches) { E.y = scrollY; E.prec = -1; image(); }
  }, { signal, passive: true });
  return () => {
    controle.abort();
    cancelAnimationFrame(raf);
    clearTimeout(rt);
  };

}
