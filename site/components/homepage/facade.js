/* Veilleuse — le moteur de façade, en Canvas 2D.
   Rien n'est tiré au hasard à l'exécution : PRNG à graine, résultat identique à chaque rendu.
   Tout est redessiné en vectoriel à chaque image, donc aucun bitmap agrandi pendant le zoom. */

  const rng = (seed) => {
    let x = seed >>> 0 || 1;
    return () => {
      x ^= x << 13; x >>>= 0;
      x ^= x >>> 17;
      x ^= x << 5; x >>>= 0;
      return x / 4294967296;
    };
  };
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };

  /* Homographie du carré unité vers un quadrilatère (Heckbert). q : (0,0) (1,0) (1,1) (0,1). */
  const homographie = (q) => {
    const [x0, y0] = q[0], [x1, y1] = q[1], [x2, y2] = q[2], [x3, y3] = q[3];
    const dx1 = x1 - x2, dx2 = x3 - x2, sx = x0 - x1 + x2 - x3;
    const dy1 = y1 - y2, dy2 = y3 - y2, sy = y0 - y1 + y2 - y3;
    const den = dx1 * dy2 - dx2 * dy1;
    const g = (sx * dy2 - dx2 * sy) / den, h = (dx1 * sy - sx * dy1) / den;
    const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
    const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
    return (u, v) => {
      const w = g * u + h * v + 1;
      return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
    };
  };

  /* Géométrie d'une travée : la vitre dans sa cellule. */
  const GEO = { gx: 0.075, ht: 0.1, hb: 0.17 };
  const vitre = (H, spec, c, r) => {
    const { cols, rows } = spec;
    const u0 = (c + GEO.gx) / cols, u1 = (c + 1 - GEO.gx) / cols;
    const v0 = (r + GEO.ht) / rows, v1 = (r + 1 - GEO.hb) / rows;
    return [H(u0, v0), H(u1, v0), H(u1, v1), H(u0, v1)];
  };

  /* ---- Intérieurs ---------------------------------------------------- */
  const TONS = {
    chaud: { plafond: "#fff6e6", mur: "#ffdca6", sol: "#a8682f", silhouette: "rgba(46,24,10,.78)", ecran: "#e8f3ff" },
    blanc: { plafond: "#ffffff", mur: "#fff4df", sol: "#d9b284", silhouette: "rgba(60,36,18,.55)", ecran: "#ffffff" },
    ecran: { plafond: "#26407f", mur: "#16306f", sol: "#06123a", silhouette: "rgba(2,8,28,.86)", ecran: "#bfe4ff" },
    orange: { plafond: "#ffb98d", mur: "#fc5404", sol: "#8e2a00", silhouette: "rgba(50,14,0,.7)", ecran: "#ffe9d6" },
  };

  /* Dessine une pièce éclairée dans un rectangle w × h (coordonnées locales). */
  const interieur = (g, w, h, ton, v) => {
    const T = TONS[ton] || { plafond: ton, mur: ton, sol: "rgba(0,0,0,.55)", silhouette: "rgba(10,16,40,.7)", ecran: "#ffffff" };
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, T.plafond);
    grad.addColorStop(0.38, T.mur);
    grad.addColorStop(1, T.sol);
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    /* Plafonniers */
    g.fillStyle = "rgba(255,255,255,.75)";
    const n = 1 + (v % 3);
    for (let i = 0; i < n; i++) {
      const x = w * ((i + 0.5) / n) - w * 0.11;
      g.fillRect(x, h * 0.05, w * 0.22, h * 0.035);
    }
    /* Cloison du fond */
    g.fillStyle = "rgba(0,0,0,.05)";
    g.fillRect(w * (0.12 + (v % 5) * 0.1), h * 0.1, w * 0.012, h * 0.6);
    /* Bureaux */
    g.fillStyle = T.silhouette;
    const by = h * 0.66;
    if (v % 4 !== 3) {
      g.fillRect(w * 0.08, by, w * 0.42, h * 0.035);
      g.fillRect(w * 0.1, by, w * 0.015, h * 0.3);
      g.fillRect(w * 0.46, by, w * 0.015, h * 0.3);
      /* Écran */
      g.fillStyle = T.ecran;
      g.fillRect(w * 0.22, h * 0.47, w * 0.16, h * 0.17);
      g.fillStyle = T.silhouette;
      g.fillRect(w * 0.29, h * 0.64, w * 0.02, h * 0.03);
    }
    if (v % 3 === 1) {
      g.fillStyle = T.silhouette;
      g.fillRect(w * 0.58, by + h * 0.02, w * 0.34, h * 0.035);
      g.fillRect(w * 0.88, by, w * 0.015, h * 0.3);
      g.fillStyle = T.ecran;
      g.fillRect(w * 0.68, h * 0.5, w * 0.13, h * 0.15);
    }
    /* Une plante, parfois */
    if (v % 5 === 2) {
      g.fillStyle = T.silhouette;
      g.beginPath();
      g.ellipse(w * 0.86, h * 0.58, w * 0.05, h * 0.1, 0, 0, 7);
      g.fill();
      g.fillRect(w * 0.84, h * 0.66, w * 0.04, h * 0.1);
    }
    /* Stores à moitié baissés */
    if (v % 6 === 0) {
      const hs = h * (0.18 + (v % 4) * 0.08);
      g.fillStyle = "rgba(255,255,255,.34)";
      g.fillRect(0, 0, w, hs);
      g.fillStyle = "rgba(0,0,0,.09)";
      for (let y = 0; y < hs; y += Math.max(2, h * 0.035)) g.fillRect(0, y, w, 1);
    }
    /* Le verre : un léger voile bleu, du ciel sur la vitre. */
    const verre = g.createLinearGradient(0, 0, w, h);
    verre.addColorStop(0, "rgba(120,170,255,.1)");
    verre.addColorStop(0.5, "rgba(120,170,255,0)");
    g.fillStyle = verre;
    g.fillRect(0, 0, w, h);
  };

  const cacheSprites = new Map();
  const sprite = (ton, v) => {
    const k = `${ton}/${v}`;
    if (cacheSprites.has(k)) return cacheSprites.get(k);
    const c = document.createElement("canvas");
    c.width = 240; c.height = 160;
    const g = c.getContext("2d");
    interieur(g, 240, 160, ton, v);
    cacheSprites.set(k, c);
    return c;
  };

  const cacheHalos = new Map();
  const halo = (couleur) => {
    if (cacheHalos.has(couleur)) return cacheHalos.get(couleur);
    const c = document.createElement("canvas");
    c.width = c.height = 128;
    const g = c.getContext("2d");
    const r = g.createRadialGradient(64, 64, 2, 64, 64, 64);
    r.addColorStop(0, couleur);
    r.addColorStop(0.28, couleur.replace(/,[\d.]+\)$/, ",.34)"));
    r.addColorStop(1, couleur.replace(/,[\d.]+\)$/, ",0)"));
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
    cacheHalos.set(couleur, c);
    return c;
  };

  const HALOS = {
    chaud: "rgba(255,190,120,.9)",
    blanc: "rgba(255,226,180,1)",
    ecran: "rgba(90,160,255,.8)",
    orange: "rgba(252,84,4,1)",
  };

  /* ---- Spécification d'une façade ------------------------------------- */
  const creer = ({ cols, rows, seed = 7, choix }) => {
    const rand = rng(seed);
    const fenetres = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const j1 = rand(), j2 = rand(), j3 = rand(), j4 = rand();
        const f = { c, r, j1, j2, j3, v: Math.floor(j4 * 60), ton: null, at: 0 };
        const res = choix ? choix(c, r, rand) : null;
        if (res) Object.assign(f, res);
        fenetres.push(f);
      }
    }
    return { cols, rows, fenetres, seed };
  };

  /* ---- Peinture ------------------------------------------------------- */
  /* opts : plaque (image), teinte du verre, temps, surbrillance, flood (fenêtre qui devient l'app). */
  const peindre = (ctx, dpr, spec, quad, opts) => {
    const { W, H: VH, plaque, now = 1e9, verre = [2, 8, 30], reflet = 0.82, cible = null, flood = 0, base = "#030a22", brume = 0.2, liseret = "255,190,140", niveau = null, zone = [0, 0.56], haloK = 1, masqueCible = 0, airBas = 0 } = opts;
    const H = homographie(quad);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    /* Masse du bâtiment */
    const coin = quad;
    ctx.beginPath();
    ctx.moveTo(coin[0][0], coin[0][1]);
    for (let i = 1; i < 4; i++) ctx.lineTo(coin[i][0], coin[i][1]);
    ctx.closePath();
    const massG = ctx.createLinearGradient(0, Math.min(coin[0][1], coin[1][1]), 0, Math.max(coin[2][1], coin[3][1]));
    massG.addColorStop(0, base);
    massG.addColorStop(1, "#010514");
    ctx.fillStyle = massG;
    ctx.fill();

    /* Allèges et montants : des droites, la perspective les garde droites. */
    ctx.lineWidth = 1;
    for (let r = 0; r <= spec.rows; r++) {
      const a = H(0, r / spec.rows), b = H(1, r / spec.rows);
      if (Math.max(a[1], b[1]) < -10 || Math.min(a[1], b[1]) > VH + 10) continue;
      ctx.strokeStyle = "rgba(170,200,255,.07)";
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    for (let c = 0; c <= spec.cols; c++) {
      const a = H(c / spec.cols, 0), b = H(c / spec.cols, 1);
      ctx.strokeStyle = "rgba(170,200,255,.05)";
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }

    const pw = plaque ? plaque.naturalWidth || plaque.width : 0;
    const ph = plaque ? plaque.naturalHeight || plaque.height : 0;
    const lumieres = [];

    for (const f of spec.fenetres) {
      const q = vitre(H, spec, f.c, f.r);
      const xs = [q[0][0], q[1][0], q[2][0], q[3][0]], ys = [q[0][1], q[1][1], q[2][1], q[3][1]];
      const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
      if (maxX < -40 || minX > W + 40 || maxY < -40 || minY > VH + 40) continue;
      const a = q[1][0] - q[0][0], b = q[1][1] - q[0][1], cx = q[3][0] - q[0][0], d = q[3][1] - q[0][1];
      const tw = Math.hypot(a, b), th = Math.hypot(cx, d);

      let lum = 0;
      if (f.ton) {
        lum = niveau ? niveau(f, now) : smooth((now - f.at) / 420);
      }
      const estCible = cible && f.c === cible[0] && f.r === cible[1];

      ctx.setTransform(a * dpr, b * dpr, cx * dpr, d * dpr, q[0][0] * dpr, q[0][1] * dpr);

      /* Verre sombre : chaque vitre reflète un morceau du ciel, légèrement décalé. */
      if (lum < 1) {
        if (plaque && pw) {
          const sw = pw * (0.08 + f.j3 * 0.03), sh = sw * 0.62;
          const sx = clamp(pw * (0.22 + 0.5 * (f.c / spec.cols)) + (f.j1 - 0.5) * pw * 0.07, 0, pw - sw);
          const sy = clamp(ph * (zone[0] + (zone[1] - zone[0]) * (f.r / spec.rows)) + (f.j2 - 0.5) * ph * 0.05, 0, ph * 0.8 - sh);
          ctx.globalAlpha = reflet * (0.58 + f.j2 * 0.42);
          ctx.drawImage(plaque, sx, sy, sw, sh, 0, 0, 1, 1);
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = `rgba(${verre[0]},${verre[1]},${verre[2]},${0.34 + f.j3 * 0.3})`;
        ctx.fillRect(0, 0, 1, 1);
      }

      /* Lumière */
      if (lum > 0) {
        ctx.globalAlpha = lum;
        if (tw > 200) {
          /* Grande à l'écran : on dessine la pièce en vrai, pas un sprite agrandi. */
          ctx.save();
          ctx.setTransform((a / tw) * dpr, (b / tw) * dpr, (cx / th) * dpr, (d / th) * dpr, q[0][0] * dpr, q[0][1] * dpr);
          interieur(ctx, tw, th, f.ton, f.v);
          ctx.restore();
        } else {
          ctx.drawImage(sprite(f.ton, f.v), 0, 0, 240, 160, 0, 0, 1, 1);
        }
        ctx.globalAlpha = 1;
        lumieres.push([f, q, lum, tw, th]);
      }

      /* La fenêtre qui devient l'app : sa lumière remplit tout. */
      if (estCible && flood > 0) {
        ctx.globalAlpha = flood;
        ctx.fillStyle = "#f9f9f9";
        ctx.fillRect(0, 0, 1, 1);
        ctx.globalAlpha = 1;
      }

      if (estCible && masqueCible > 0) {
        ctx.globalAlpha = masqueCible;
        ctx.fillStyle = "#030a22";
        ctx.fillRect(0, 0, 1, 1);
        ctx.globalAlpha = 1;
      }

      /* Meneau central et cadre */
      const mf = estCible ? 1 - flood : 1;
      if (mf > 0) {
        ctx.fillStyle = `rgba(1,5,20,${0.92 * mf})`;
        const e = Math.max(0.012, 1.1 / Math.max(tw, 1));
        ctx.fillRect(0.5 - e / 2, 0, e, 1);
        const lh = Math.max(0.012, 0.9 / Math.max(th, 1));
        ctx.fillStyle = `rgba(190,215,255,${0.16 * mf})`;
        ctx.fillRect(0, 1 - lh, 1, lh);
      }
    }

    /* Halos */
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    for (const [f, q, lum, tw, th] of lumieres) {
      const cxm = (q[0][0] + q[2][0]) / 2, cym = (q[0][1] + q[2][1]) / 2;
      const coul = HALOS[f.ton] || `${f.halo || "rgba(200,210,255,.7)"}`;
      const k = (f.ton === "blanc" ? 3.1 : f.ton === "orange" ? 7 : 2.5);
      const s = Math.max(tw, th) * k;
      ctx.globalAlpha = haloK * lum * (f.ton === "blanc" ? 0.3 : f.ton === "orange" ? 0.7 : 0.17);
      ctx.drawImage(halo(coul), cxm - s / 2, cym - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";

    /* Brume sur le côté lointain */
    if (brume > 0) {
      const a0 = H(0, 0.5), a1 = H(0.55, 0.5);
      const g = ctx.createLinearGradient(a0[0], a0[1], a1[0], a1[1]);
      g.addColorStop(0, `rgba(30,110,235,${brume})`);
      g.addColorStop(1, "rgba(30,110,235,0)");
      ctx.beginPath();
      ctx.moveTo(coin[0][0], coin[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(coin[i][0], coin[i][1]);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
    }

    /* Acrotère et arête : le dernier filet de lumière du ciel. */
    const ep = 0.012;
    const t0 = H(0, -ep), t1 = H(1, -ep), t2 = H(1, 0), t3 = H(0, 0);
    ctx.beginPath();
    ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.lineTo(t2[0], t2[1]); ctx.lineTo(t3[0], t3[1]); ctx.closePath();
    ctx.fillStyle = "#050f32";
    ctx.fill();
    ctx.strokeStyle = `rgba(${liseret},.55)`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(t0[0], t0[1]); ctx.lineTo(t1[0], t1[1]); ctx.stroke();
    const e0 = H(0, -ep), e1 = H(0, 1);
    ctx.strokeStyle = `rgba(${liseret},.28)`;
    ctx.beginPath(); ctx.moveTo(e0[0], e0[1]); ctx.lineTo(e1[0], e1[1]); ctx.stroke();

    /* Quelques volumes techniques sur le toit */
    const blocs = [[0.1, 0.16, 0.014], [0.34, 0.46, 0.02], [0.56, 0.6, 0.012], [0.76, 0.84, 0.016]];
    for (const [u0, u1, hh] of blocs) {
      const p0 = H(u0, -ep - hh), p1 = H(u1, -ep - hh), p2 = H(u1, -ep), p3 = H(u0, -ep);
      const gb = ctx.createLinearGradient(p0[0], p0[1], p3[0], p3[1]);
      gb.addColorStop(0, "#14306f");
      gb.addColorStop(1, "#04102f");
      ctx.fillStyle = gb;
      ctx.beginPath();
      ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(p3[0], p3[1]); ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = `rgba(${liseret},.4)`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(p0[0], p0[1]); ctx.lineTo(p1[0], p1[1]); ctx.stroke();
    }
    /* Le bas de la tour dans l'air du soir */
    if (airBas > 0) {
      const ga = ctx.createLinearGradient(0, VH * 0.72, 0, VH);
      ga.addColorStop(0, "rgba(12,38,120,0)");
      ga.addColorStop(1, `rgba(12,38,120,${0.62 * airBas})`);
      ctx.beginPath();
      ctx.moveTo(coin[0][0], coin[0][1]);
      for (let i = 1; i < 4; i++) ctx.lineTo(coin[i][0], coin[i][1]);
      ctx.closePath();
      ctx.fillStyle = ga;
      ctx.fill();
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  };

  /* Échantillonne un tracé vectoriel sur une grille : le signe et le logotype sont les vrais. */
  const SIGNE = "M64.5391 107.564L64.5391 172.104L0 172.104L5.64219e-06 107.564L64.5391 107.564ZM64.5391 5.64218e-06L64.5391 48.4043C64.5391 52.874 66.3554 56.8895 69.2715 59.8057L129.077 1.12843e-05L172.079 1.50436e-05L172.079 43.0254L107.541 107.564L145.618 107.564C148.797 107.564 151.833 108.808 154.08 111.055L172.104 129.077L172.104 172.104L129.077 172.104L7.00392 50.0293C2.51012 45.5594 1.6634e-05 39.4642 1.21495e-05 33.1299L1.50458e-05 0L64.5391 5.64218e-06Z";
  const TYPO = "M431.98 96.928C431.98 113.708 438.793 121.094 452.083 121.094C465.373 121.094 474.958 112.608 474.958 94.3459L474.982 94.3459L474.982 51.3918L503.738 51.3918L503.738 134.001C503.738 170.884 484.376 187.856 449.717 187.856C431.454 187.856 413.742 183.242 402.316 174.206L413.742 153.554C422.036 160.39 434.944 164.621 447.302 164.621C466.664 164.621 474.958 155.586 474.958 137.706L474.958 134.384C467.38 141.937 457.054 145.81 445.629 145.81C420.746 145.81 403.225 131.97 403.224 101.183L403.224 51.3918L431.98 51.3918L431.98 96.928ZM632.698 49.9348C644.864 49.9349 655.191 53.8073 662.385 61.9104L662.385 51.3928L691.141 51.3928L691.141 150.615L663.676 150.615L663.676 139.19C656.482 147.866 645.964 152.097 632.698 152.097C604.683 152.097 583.098 132.186 583.098 101.016C583.098 69.8461 604.659 49.9348 632.698 49.9348ZM255.573 21.5129L255.573 81.8205L312.75 21.5129L345.927 21.5129L292.456 79.0481L349.058 150.59L314.208 150.59L272.903 99.8918L255.573 117.962L255.573 150.59L225.885 150.59L225.885 21.5129L255.573 21.5129ZM386.706 150.59L357.951 150.59L357.951 21.5129L386.706 21.5129L386.706 150.59ZM581.805 76.4426C579.415 76.2753 577.575 76.0842 575.352 76.0842C559.504 76.0842 548.986 84.7374 548.986 103.74L548.986 150.567L520.231 150.567L520.231 51.3684L547.696 51.3684L547.696 64.4436C554.7 54.8585 566.507 49.886 581.805 49.886L581.805 76.4426ZM637.67 73.5266C623.28 73.5266 612.213 83.8531 612.213 100.991C612.213 118.13 623.28 128.456 637.67 128.456C651.868 128.456 662.935 118.13 662.935 100.991C662.935 83.8532 652.059 73.5268 637.67 73.5266Z";

  const masque = (d, boite) => {
    const c = document.createElement("canvas");
    c.width = c.height = 4;
    const g = c.getContext("2d");
    const p = new Path2D(d);
    return (x, y) => x >= 0 && y >= 0 && x <= boite[0] && y <= boite[1] && g.isPointInPath(p, x, y);
  };

  export { creer, peindre, homographie, vitre, GEO, rng, clamp, lerp, smooth, masque, SIGNE, TYPO };
