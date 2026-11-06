/* Veilleuse — pièces communes à la page et à la planche de tokens. */

  import { PASTELS, AGENTS } from './data';
import { rng } from './facade';
import { ICONS } from './icones';
  
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const agentPar = Object.fromEntries(AGENTS.map((a) => [a.id, a]));

  /* ---- Avatars : AgentFormes.tsx de l'app ------------------------------ */
  const etoile = (cx, cy, n, rE, rI) => {
    const p = [];
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 === 0 ? rE : rI, a = (Math.PI * i) / n - Math.PI / 2;
      p.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
    }
    return p.join(" ");
  };
  const hexa = (cx, cy, r) => Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
  const DESSINS = {
    dev: (f) => [30, 90, 150].map((y) => `<circle cx="44" cy="${y}" r="27" fill="${f}"/><rect x="80" y="${y - 27}" width="110" height="54" rx="27" fill="${f}"/>`).join(""),
    designer: (f) => [0, 45, 90, 135].map((r) => `<ellipse cx="108" cy="92" rx="30" ry="72" fill="${f}" transform="rotate(${r} 108 92)"/>`).join(""),
    motion: (f) => [96, 66, 36].map((r) => `<circle cx="132" cy="96" r="${r}" fill="${f}"/>`).join(""),
    qa: (f) => `<polygon points="${etoile(106, 88, 12, 78, 62)}" fill="${f}"/><circle cx="106" cy="88" r="36" fill="${f}"/>`,
    commercial: (f) => [[26, 120], [64, 88], [102, 52], [140, 16]].map(([x, y]) => `<rect x="${x}" y="${y}" width="30" height="${210 - y}" rx="15" fill="${f}"/>`).join(""),
    stratege: (f) => `<path d="M108 6 C116 62 134 80 190 88 C134 96 116 114 108 170 C100 114 82 96 26 88 C82 80 100 62 108 6 Z" fill="${f}"/><path d="M40 132 C43 152 50 159 70 162 C50 165 43 172 40 192 C37 172 30 165 10 162 C30 159 37 152 40 132 Z" fill="${f}"/>`,
    growth: (f) => [0, 1, 2, 3].map((i) => `<rect x="${24 + i * 36}" y="${140 - i * 40}" width="150" height="34" rx="17" fill="${f}"/>`).join(""),
    redacteur: (f) => [[76, 52, -35], [150, 40, 35], [76, 136, -35], [150, 124, 35]].map(([x, y, r]) => `<path d="M${x} ${y - 46} C${x + 34} ${y - 46} ${x + 34} ${y + 10} ${x} ${y + 46} C${x - 34} ${y + 10} ${x - 34} ${y - 46} ${x} ${y - 46} Z" fill="${f}" transform="rotate(${r} ${x} ${y})"/>`).join(""),
    val: (f) => `<rect x="30" y="34" width="130" height="92" rx="18" fill="${f}" transform="rotate(-12 95 80)"/><rect x="54" y="88" width="130" height="92" rx="18" fill="${f}" transform="rotate(8 119 134)"/>`,
    "diego-discord-ops": (f) => `<polygon points="${hexa(80, 56, 44)}" fill="${f}"/><polygon points="${hexa(146, 94, 44)}" fill="${f}"/><polygon points="${hexa(80, 132, 44)}" fill="${f}"/>`,
    prompty: (f) => `<path d="M40 20 H170 a24 24 0 0 1 24 24 V96 a24 24 0 0 1 -24 24 H86 L58 146 V120 H40 a24 24 0 0 1 -24 -24 V44 a24 24 0 0 1 24 -24 Z" fill="${f}"/><path d="M96 112 H178 a20 20 0 0 1 20 20 V166 a20 20 0 0 1 -20 20 H170 V206 L148 186 H96 a20 20 0 0 1 -20 -20 V132 a20 20 0 0 1 20 -20 Z" fill="${f}"/>`,
  };
  let uid = 0;
  const SIGNE_ICONE = "M61.2218 80.3443V109.021H32.5451V80.3443H61.2218ZM61.2218 32.5474V54.0552C61.2219 56.0413 62.0286 57.8259 63.3244 59.1216L89.8986 32.5474H109.005V51.6655L80.3292 80.3423H97.2482C98.6606 80.3423 100.01 80.8939 101.008 81.8921L109.016 89.9009V109.018H89.8986L35.6574 54.7769C33.6607 52.7908 32.5451 50.0826 32.5451 47.2681V32.5474H61.2218Z";
  const avatarSVG = (id) => {
    if (id === "principal") return `<svg viewBox="0 0 140.2 140.2" style="background:#003fe4"><path d="${SIGNE_ICONE}" fill="#fff"/></svg>`;
    const a = agentPar[id], p = PASTELS[a.teinte], u = `g${uid++}`;
    return `<svg viewBox="0 0 100 100" style="background:linear-gradient(147.66deg,${p.bas} .4%,${p.haut} 93.65%)"><defs><linearGradient id="${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".72"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient></defs><svg x="11" y="11" width="78" height="78" viewBox="0 0 200 200">${DESSINS[id](`url(#${u})`)}</svg></svg>`;
  };
  /* Les formes seules, en grand, pour les cartes d'agents. */
  const formesSVG = (id) => {
    const u = `gf${uid++}`;
    if (id === "principal") return `<svg viewBox="0 0 140.2 140.2" aria-hidden="true"><path d="${SIGNE_ICONE}" fill="rgba(255,255,255,.92)"/></svg>`;
    return `<svg viewBox="0 0 200 200" aria-hidden="true"><defs><linearGradient id="${u}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".72"/><stop offset="1" stop-color="#fff" stop-opacity=".18"/></linearGradient></defs>${DESSINS[id](`url(#${u})`)}</svg>`;
  };
  const poserAvatars = (r = document) => $$(".av[data-a]", r).forEach((el) => { if (!el.firstChild) el.innerHTML = avatarSVG(el.dataset.a); });
  const poserIcones = (r = document) => $$(".ic[data-i]", r).forEach((el) => {
    if (el.firstChild) return;
    const b = ICONS[el.dataset.i];
    if (b) el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">${b}</svg>`;
  });

  /* Heures écrites en fenêtres : une matrice 5 × 7. */
  const CHIFFRES = {
    0: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"], 1: ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
    2: ["01110", "10001", "00001", "00110", "01000", "10000", "11111"], 3: ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
    4: ["00010", "00110", "01010", "10010", "11111", "00010", "00010"], 5: ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
    6: ["00110", "01000", "10000", "11110", "10001", "10001", "01110"], 7: ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
    8: ["01110", "10001", "10001", "01110", "10001", "10001", "01110"], 9: ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
    ":": ["0", "0", "1", "0", "1", "0", "0"],
  };
  const matriceHeure = (el, txt, graine) => {
    const col = [];
    [...txt].forEach((ch, i) => {
      const g = CHIFFRES[ch];
      for (let x = 0; x < g[0].length; x++) col.push(g.map((l) => l[x] === "1"));
      if (i < txt.length - 1) col.push(Array(7).fill(false));
    });
    const W = 9, H = 11, rand = rng(graine);
    let s = "";
    col.forEach((c, x) => c.forEach((on, y) => {
      if (on) s += `<rect class="L" x="${x * W + 1}" y="${y * H + 1}" width="${W - 2}" height="${H - 2}" rx=".6" data-o="${rand().toFixed(3)}"/>`;
    }));
    el.setAttribute("aria-label", txt);
    el.setAttribute("role", "img");
    el.innerHTML = `<svg viewBox="0 0 ${col.length * W} ${7 * H}">${s}</svg>`;
  };

  export { avatarSVG, formesSVG, poserAvatars, poserIcones, SIGNE_ICONE, matriceHeure };
