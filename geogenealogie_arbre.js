/* Démonstrateur ARTSGIS · geogenealogie — arbre de filiation relié à la carte.
   Aucune donnée nominative n'est embarquée. L'arbre est construit après
   connexion au portail, en interrogeant le service privé. */

const GEOGENEALOGIE_APP_ID = "udINS8SIv8TZ6OSV";

const PORTAIL_URL = "https://artsgis.maps.arcgis.com";
const SERVICE_URL =
  "https://services8.arcgis.com/oi4y3kiOYSwRlxqD/arcgis/rest/services/geogenealogie_lieux/FeatureServer";
const WEBMAP_ID = "93a058400dea4a37926cfb6f0d80bf00";

/* Couleur des cases : champ attributaire `couleur` (aucune clé nominative en dur). */

const BOX_W = 148;
const BOX_H = 54;
const GAP_X = 18;
const GAP_Y = 78;
const PAD = 28;

const params = new URLSearchParams(window.location.search);
const MODE_DEMO = params.get("demo") === "1" || params.has("demo");

const elArbre = document.getElementById("arbre");
const elStatut = document.getElementById("statut");
const elBtnTout = document.getElementById("btn-tout");
const elBanniere = document.getElementById("banniere-demo");
const elCarteNote = document.getElementById("carte-note");

let personnes = [];
let liens = [];
let evenementsMariage = [];
let selectionIds = null;
let selectionCible = null;
let couchesCarte = [];
let exprsOrigine = new Map();
let vueCarte = null;
let etendueInitiale = null;

function couleurPersonne(p) {
  const c = p && p.couleur;
  if (c && String(c).trim()) return String(c).trim();
  return "#1E6FB8";
}

function estVivant(valeur) {
  return valeur === 1 || valeur === true || valeur === "1";
}

function libellePersonne(p) {
  const prenoms = String(p.prenoms || "").trim();
  const nom = String(p.nom || "").trim().toUpperCase();
  return [prenoms, nom].filter(Boolean).join(" ") || "Sans nom";
}

function libelleAnnee(p) {
  if (p.annee === 0 || p.annee === "0") return "";
  if (p.annee === null || p.annee === undefined || p.annee === "") return "";
  const n = Number(p.annee);
  if (!Number.isFinite(n)) return String(p.annee);
  return String(Math.round(n));
}

function setStatut(texte) {
  elStatut.textContent = texte || "";
}

function citerIds(ids) {
  return ids
    .map((id) => "'" + String(id).replace(/'/g, "''") + "'")
    .join(",");
}

/* ---------- Données fictives (mode ?demo=1 uniquement) ---------- */

function donneesDemo() {
  const fictif = (id, nom, prenoms, sexe, generation, branche, annee, vivant, couleur) => ({
    id_personne: id,
    nom,
    prenoms,
    sexe,
    generation,
    branche_gp: branche,
    annee,
    est_vivant: vivant,
    couleur
  });
  return {
    personnes: [
      Object.assign(fictif("A", "A", "Personne", "F", 1, "Proband", 2000, 1, "#0A2F5C"), { id_conjoint: "I" }),
      fictif("B", "B", "Personne", "M", 2, "Branche nord", 1970, 0, "#1E6FB8"),
      fictif("C", "C", "Personne", "F", 2, "Branche sud", 1972, 0, "#E0662A"),
      fictif("D", "D", "Personne", "M", 3, "Branche nord", 1945, 0, "#1E6FB8"),
      fictif("E", "E", "Personne", "F", 3, "Branche nord", 1948, 0, "#1E6FB8"),
      fictif("F", "F", "Personne", "M", 3, "Branche sud", 1946, 0, "#E0662A"),
      fictif("G", "G", "Personne", "F", 3, "Branche sud", 1949, 0, "#E0662A"),
      fictif("H", "H", "Personne", "M", 0, "Proband", 2020, 1, "#0A2F5C"),
      Object.assign(fictif("I", "I", "Personne", "M", 1, "Proband", 1998, 1, "#0A2F5C"), { id_conjoint: "A" })
    ],
    liens: [
      { id_parent: "D", id_enfant: "B" },
      { id_parent: "E", id_enfant: "B" },
      { id_parent: "F", id_enfant: "C" },
      { id_parent: "G", id_enfant: "C" },
      { id_parent: "B", id_enfant: "A" },
      { id_parent: "C", id_enfant: "A" },
      { id_parent: "A", id_enfant: "H" },
      { id_parent: "I", id_enfant: "H" }
    ],
    mariages: [
      { id_personne: "A", type_evt: "mariage", annee: 2019, commune: "Demo" },
      { id_personne: "I", type_evt: "mariage", annee: 2019, commune: "Demo" }
    ]
  };
}

/* ---------- Agrégation depuis les couches 0 et 2 ---------- */

function agregerPersonnes(entites) {
  const parId = new Map();
  for (const f of entites) {
    const a = f.attributes || f;
    const id = a.id_personne;
    if (id === null || id === undefined || id === "") continue;
    const cle = String(id);
    const rec = {
      id_personne: cle,
      nom: a.nom,
      prenoms: a.prenoms,
      sexe: a.sexe,
      generation: a.generation == null || a.generation === "" ? 0 : Number(a.generation),
      branche_gp: a.branche_gp,
      annee: a.annee,
      est_vivant: a.est_vivant,
      type_evt: a.type_evt,
      id_pere: a.id_pere == null || a.id_pere === "" ? null : String(a.id_pere),
      id_mere: a.id_mere == null || a.id_mere === "" ? null : String(a.id_mere),
      id_conjoint: a.id_conjoint == null || a.id_conjoint === "" ? null : String(a.id_conjoint),
      couleur: a.couleur
    };
    const deja = parId.get(cle);
    if (!deja) {
      parId.set(cle, rec);
      continue;
    }
    if (String(rec.type_evt).toLowerCase() === "naissance") {
      deja.annee = rec.annee;
      deja.nom = rec.nom || deja.nom;
      deja.prenoms = rec.prenoms || deja.prenoms;
      deja.sexe = rec.sexe || deja.sexe;
      deja.branche_gp = rec.branche_gp || deja.branche_gp;
      if (!Number.isNaN(rec.generation)) deja.generation = rec.generation;
    } else if (
      (deja.annee === null || deja.annee === undefined || deja.annee === "") &&
      rec.annee !== null &&
      rec.annee !== undefined &&
      rec.annee !== ""
    ) {
      /* Pour un vivant, l'année affichée vient de la naissance si elle existe ;
         à défaut on n'affiche une autre année que si aucune naissance n'est trouvée. */
      if (!estVivant(deja.est_vivant)) deja.annee = rec.annee;
    }
    if (estVivant(rec.est_vivant)) deja.est_vivant = rec.est_vivant;
    if (rec.id_pere) deja.id_pere = rec.id_pere;
    if (rec.id_mere) deja.id_mere = rec.id_mere;
    if (rec.id_conjoint) deja.id_conjoint = rec.id_conjoint;
    if (rec.couleur) deja.couleur = rec.couleur;
  }
  return Array.from(parId.values());
}

function lireLiens(entites) {
  const out = [];
  const vus = new Set();
  for (const f of entites) {
    const a = f.attributes || f;
    if (a.id_parent == null || a.id_enfant == null) continue;
    const p = String(a.id_parent);
    const e = String(a.id_enfant);
    const cle = p + "->" + e;
    if (vus.has(cle)) continue;
    vus.add(cle);
    out.push({ id_parent: p, id_enfant: e });
  }
  return out;
}


function liensDepuisAttributs(liste, liensCouche) {
  const out = [];
  const vus = new Set();
  const ajouter = (p, e) => {
    if (p === null || p === undefined || p === "" || e === null || e === undefined || e === "") return;
    const cle = String(p) + "->" + String(e);
    if (vus.has(cle)) return;
    vus.add(cle);
    out.push({ id_parent: String(p), id_enfant: String(e) });
  };
  for (const pers of liste) {
    ajouter(pers.id_pere, pers.id_personne);
    ajouter(pers.id_mere, pers.id_personne);
  }
  for (const l of liensCouche || []) ajouter(l.id_parent, l.id_enfant);
  return out;
}

function indexFiliation(listeLiens) {
  const parentsDe = new Map();
  const enfantsDe = new Map();
  const ajouter = (map, cle, val) => {
    if (!map.has(cle)) map.set(cle, []);
    if (!map.get(cle).includes(val)) map.get(cle).push(val);
  };
  for (const l of listeLiens) {
    ajouter(parentsDe, l.id_enfant, l.id_parent);
    ajouter(enfantsDe, l.id_parent, l.id_enfant);
  }
  return { parentsDe, enfantsDe };
}

function extraireMariages(entites) {
  const out = [];
  for (const f of entites || []) {
    const a = f.attributes || f;
    if (String(a.type_evt || "").toLowerCase() !== "mariage") continue;
    if (a.id_personne === null || a.id_personne === undefined || a.id_personne === "") continue;
    out.push({
      id_personne: String(a.id_personne),
      type_evt: "mariage",
      date_evt: a.date_evt || "",
      annee: a.annee,
      commune: a.commune || ""
    });
  }
  return out;
}

function indexConjoints(listeLiens, mariages) {
  const conj = new Map();
  const ajouter = (a, b) => {
    if (a === null || a === undefined || a === "" || b === null || b === undefined || b === "") return;
    const x = String(a);
    const y = String(b);
    if (x === y) return;
    if (!conj.has(x)) conj.set(x, []);
    if (!conj.has(y)) conj.set(y, []);
    if (!conj.get(x).includes(y)) conj.get(x).push(y);
    if (!conj.get(y).includes(x)) conj.get(y).push(x);
  };
  const { parentsDe, enfantsDe } = indexFiliation(listeLiens);
  for (const enfants of enfantsDe.values()) {
    for (const enfant of enfants) {
      const pars = parentsDe.get(String(enfant)) || [];
      for (let i = 0; i < pars.length; i++) {
        for (let j = i + 1; j < pars.length; j++) ajouter(pars[i], pars[j]);
      }
    }
  }
  const groupes = new Map();
  for (const ev of mariages || []) {
    const dateCle = ev.date_evt || ev.annee;
    if (dateCle === null || dateCle === undefined || dateCle === "") continue;
    const cle = String(dateCle) + "|" + String(ev.commune || "");
    if (!groupes.has(cle)) groupes.set(cle, []);
    const id = String(ev.id_personne);
    if (!groupes.get(cle).includes(id)) groupes.get(cle).push(id);
  }
  for (const ids of groupes.values()) {
    if (ids.length === 2) ajouter(ids[0], ids[1]);
  }
  for (const pers of personnes || []) {
    if (pers && pers.id_conjoint) ajouter(pers.id_personne, pers.id_conjoint);
  }
  return conj;
}

function entourage(id, index, conjoints) {
  const ids = new Set([String(id)]);
  for (const p of index.parentsDe.get(String(id)) || []) ids.add(String(p));
  for (const e of index.enfantsDe.get(String(id)) || []) ids.add(String(e));
  for (const c of conjoints.get(String(id)) || []) ids.add(String(c));
  return Array.from(ids);
}

/* ---------- Disposition de l'arbre ---------- */

function atteint(enfantsDe, depart, but) {
  const objectif = String(but);
  const vus = new Set();
  const file = [String(depart)];
  while (file.length) {
    const x = file.shift();
    if (x === objectif) return true;
    if (vus.has(x)) continue;
    vus.add(x);
    for (const c of enfantsDe.get(x) || []) file.push(String(c));
  }
  return false;
}

function cleLignee(id, parId, parentsDe, enfantsDe, racine) {
  const cle = [];
  let cur = String(id);
  const garde = new Set();
  while (!garde.has(cur)) {
    garde.add(cur);
    const enf = enfantsDe.get(cur) || [];
    if (!enf.length) break;
    const versRacine = enf.find((c) => atteint(enfantsDe, c, racine)) || enf[0];
    const pars = parentsDe.get(String(versRacine)) || [];
    const pere = pars.find((p) => {
      const pers = parId.get(String(p));
      return pers && String(pers.sexe).toUpperCase() === "M";
    });
    if (pere && String(pere) === cur) cle.push("0");
    else if (pars.includes(cur) || pars.includes(String(cur))) cle.push("1");
    else cle.push("1");
    cur = String(versRacine);
  }
  return cle.join("");
}

function unitesGeneration(rangs, parentsDe, enfantsDe, parId) {
  const pris = new Set();
  const unites = [];
  const parEnfant = new Map();
  for (const p of rangs) {
    for (const e of enfantsDe.get(String(p.id_personne)) || []) {
      if (!parEnfant.has(e)) parEnfant.set(e, []);
      parEnfant.get(e).push(p);
    }
  }
  for (const membres of parEnfant.values()) {
    if (membres.length < 2) continue;
    const ids = membres.map((p) => String(p.id_personne));
    if (ids.some((id) => pris.has(id))) continue;
    const ordre = (p) => (String(p.sexe).toUpperCase() === "M" ? 0 : String(p.sexe).toUpperCase() === "F" ? 1 : 2);
    const couple = membres.slice().sort((a, b) => ordre(a) - ordre(b) || String(a.id_personne).localeCompare(String(b.id_personne), "fr", { numeric: true }));
    couple.forEach((p) => pris.add(String(p.id_personne)));
    unites.push(couple);
  }
  for (const p of rangs) {
    if (!pris.has(String(p.id_personne))) unites.push([p]);
  }
  return unites;
}

function disposer(liste, listeLiens) {
  const { parentsDe, enfantsDe } = indexFiliation(listeLiens);
  const parId = new Map(liste.map((p) => [String(p.id_personne), p]));
  const gens = new Map();
  for (const p of liste) {
    const g = Number.isFinite(p.generation) ? p.generation : 0;
    if (!gens.has(g)) gens.set(g, []);
    gens.get(g).push(p);
  }
  const generations = Array.from(gens.keys()).sort((a, b) => a - b);
  const gMax = generations.length ? generations[generations.length - 1] : 0;
  const minEcart = BOX_W + GAP_X;
  const racine = [...liste].sort((a, b) => (a.generation || 0) - (b.generation || 0))[0];
  const idRacine = racine ? String(racine.id_personne) : "1";

  const pos = new Map();
  for (let gi = generations.length - 1; gi >= 0; gi--) {
    const g = generations[gi];
    const y = PAD + (gMax - g) * (BOX_H + GAP_Y);
    const rangs = gens.get(g);
    const unites = unitesGeneration(rangs, parentsDe, enfantsDe, parId);
    const cibles = unites.map((membres, i) => {
      const ids = membres.map((p) => String(p.id_personne));
      const pars = ids.flatMap((id) => parentsDe.get(id) || []);
      const places = pars.map((id) => pos.get(String(id))).filter(Boolean);
      const largeur = membres.length * BOX_W + (membres.length - 1) * GAP_X;
      let x = null;
      if (places.length) {
        const mid = places.reduce((s, q) => s + q.x + BOX_W / 2, 0) / places.length;
        x = mid - largeur / 2;
      }
      const cle = membres
        .map((p) => cleLignee(p.id_personne, parId, parentsDe, enfantsDe, idRacine))
        .sort()[0];
      return { membres, i, x, largeur, cle };
    });
    cibles.sort((a, b) => {
      if (a.cle !== b.cle) return a.cle < b.cle ? -1 : 1;
      return a.i - b.i;
    });
    let dernier = PAD - minEcart;
    for (const c of cibles) {
      const souhait = c.x == null ? dernier + minEcart : c.x;
      c.x = Math.max(souhait, dernier + minEcart);
      dernier = c.x + c.largeur;
    }
    for (const c of cibles) {
      c.membres.forEach((p, j) => {
        pos.set(String(p.id_personne), { x: c.x + j * minEcart, y, personne: p });
      });
    }
  }

  let maxX = 0;
  let maxY = 0;
  for (const p of pos.values()) {
    maxX = Math.max(maxX, p.x + BOX_W);
    maxY = Math.max(maxY, p.y + BOX_H);
  }
  return { pos, parentsDe, enfantsDe, parId, largeur: maxX + PAD, hauteur: maxY + PAD };
}

function cheminLien(x1, y1, x2, y2) {
  const mil = (y1 + y2) / 2;
  return `M${x1},${y1} C${x1},${mil} ${x2},${mil} ${x2},${y2}`;
}

function eviterTexte(texte, max) {
  const t = String(texte || "");
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)).trimEnd() + "…";
}

function dessinerArbre() {
  const layout = disposer(personnes, liens);
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "arbre-svg");
  svg.setAttribute("viewBox", `0 0 ${layout.largeur} ${layout.hauteur}`);
  svg.setAttribute("width", String(layout.largeur));
  svg.setAttribute("height", String(layout.hauteur));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "Arbre de filiation");

  const gLiens = document.createElementNS(ns, "g");
  gLiens.setAttribute("class", "liens");
  for (const l of liens) {
    const a = layout.pos.get(String(l.id_parent));
    const b = layout.pos.get(String(l.id_enfant));
    if (!a || !b) continue;
    const path = document.createElementNS(ns, "path");
    path.setAttribute("class", "lien");
    path.dataset.parent = String(l.id_parent);
    path.dataset.enfant = String(l.id_enfant);
    const personne = layout.parId.get(String(l.id_enfant)) || layout.parId.get(String(l.id_parent));
    path.setAttribute(
      "stroke",
      couleurPersonne(personne)
    );
    path.setAttribute(
      "d",
      cheminLien(a.x + BOX_W / 2, a.y + BOX_H, b.x + BOX_W / 2, b.y)
    );
    gLiens.appendChild(path);
  }
  svg.appendChild(gLiens);

  const gCases = document.createElementNS(ns, "g");
  gCases.setAttribute("class", "cases");
  for (const [id, p] of layout.pos) {
    const pers = p.personne;
    const couleur = couleurPersonne(pers);
    const g = document.createElementNS(ns, "g");
    g.setAttribute("class", "case");
    g.dataset.id = id;
    g.setAttribute("tabindex", "0");
    g.setAttribute("role", "button");
    const annee = libelleAnnee(pers);
    const titre = libellePersonne(pers) + (annee ? " · " + annee : "");
    g.setAttribute("aria-label", titre);
    g.setAttribute("transform", `translate(${p.x},${p.y})`);

    const fond = document.createElementNS(ns, "rect");
    fond.setAttribute("x", "0");
    fond.setAttribute("y", "0");
    fond.setAttribute("width", String(BOX_W));
    fond.setAttribute("height", String(BOX_H));
    fond.setAttribute("rx", "6");
    g.appendChild(fond);

    const barre = document.createElementNS(ns, "rect");
    barre.setAttribute("class", "barre");
    barre.setAttribute("x", "0");
    barre.setAttribute("y", "0");
    barre.setAttribute("width", "7");
    barre.setAttribute("height", String(BOX_H));
    barre.setAttribute("rx", "6");
    barre.setAttribute("fill", couleur);
    g.appendChild(barre);
    const barre2 = document.createElementNS(ns, "rect");
    barre2.setAttribute("class", "barre");
    barre2.setAttribute("x", "4");
    barre2.setAttribute("y", "0");
    barre2.setAttribute("width", "3");
    barre2.setAttribute("height", String(BOX_H));
    barre2.setAttribute("fill", couleur);
    g.appendChild(barre2);

    const nom = document.createElementNS(ns, "text");
    nom.setAttribute("class", "nom");
    nom.setAttribute("x", "16");
    nom.setAttribute("y", annee ? "22" : "32");
    nom.textContent = eviterTexte(libellePersonne(pers), 22);
    g.appendChild(nom);

    if (annee) {
      const an = document.createElementNS(ns, "text");
      an.setAttribute("class", "annee");
      an.setAttribute("x", "16");
      an.setAttribute("y", "40");
      /* Les vivants n'affichent que l'année (pas de date complète). */
      an.textContent = annee;
      g.appendChild(an);
    }

    const activer = () => selectionner(id);
    g.addEventListener("click", activer);
    g.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        activer();
      }
    });
    gCases.appendChild(g);
  }
  svg.appendChild(gCases);

  elArbre.replaceChildren(svg);
  appliquerSurbrillance();
}

function appliquerSurbrillance() {
  const actif = selectionIds ? new Set(selectionIds.map(String)) : null;
  const cible = selectionCible != null ? String(selectionCible) : null;
  elArbre.querySelectorAll(".case").forEach((n) => {
    n.classList.toggle("actif", !!(actif && actif.has(n.dataset.id)));
    n.classList.toggle("cible", !!(cible && n.dataset.id === cible));
    n.classList.toggle("attenue", !!(actif && !actif.has(n.dataset.id)));
  });
  elArbre.querySelectorAll(".lien").forEach((n) => {
    const dedans =
      actif && actif.has(n.dataset.parent) && actif.has(n.dataset.enfant);
    n.classList.toggle("actif", !!dedans);
    n.classList.toggle("attenue", !!(actif && !dedans));
  });
}

/* ---------- Carte et filtres ---------- */

function couchesCibles(layer) {
  if (!layer || layer.type !== "feature") return null;
  const url = String(layer.url || "");
  const champs = (layer.fields || []).map((f) => f.name);
  if (champs.includes("id_personne_1") && champs.includes("id_personne_2")) {
    return "conjoint";
  }
  if (/\/FeatureServer\/2$/i.test(url) || (champs.includes("id_parent") && champs.includes("id_enfant"))) {
    return "filiation";
  }
  if (/\/FeatureServer\/[01]$/i.test(url) || champs.includes("id_personne")) {
    return "personne";
  }
  return null;
}

function expressionFiltre(ids, type) {
  if (!ids || !ids.length) return null;
  const liste = citerIds(ids);
  if (type === "filiation") {
    return `id_parent IN (${liste}) AND id_enfant IN (${liste})`;
  }
  if (type === "conjoint") {
    return `id_personne_1 IN (${liste}) AND id_personne_2 IN (${liste})`;
  }
  return `id_personne IN (${liste})`;
}

function combinerExpr(base, extra) {
  if (!extra) return base || null;
  if (!base) return extra;
  return `(${base}) AND (${extra})`;
}

async function appliquerFiltreCarte(ids) {
  if (!couchesCarte.length) return;
  for (const layer of couchesCarte) {
    const type = couchesCibles(layer);
    if (!type) continue;
    const base = exprsOrigine.has(layer) ? exprsOrigine.get(layer) : layer.definitionExpression || "";
    layer.definitionExpression = combinerExpr(base, expressionFiltre(ids, type));
  }
  if (!vueCarte) return;
  if (!ids || !ids.length) {
    if (etendueInitiale) await vueCarte.goTo(etendueInitiale).catch(() => {});
    return;
  }
  const points = couchesCarte.filter((l) => couchesCibles(l) === "personne");
  let etendue = null;
  for (const layer of points) {
    try {
      const res = await layer.queryExtent({ where: layer.definitionExpression || "1=1" });
      if (res && res.count && res.extent) {
        etendue = etendue ? etendue.union(res.extent) : res.extent.clone();
      }
    } catch (err) {
      /* requête d'emprise impossible : on conserve la vue courante */
    }
  }
  if (etendue) {
    if (etendue.width === 0 && etendue.height === 0) {
      await vueCarte.goTo({ target: etendue, scale: Math.min(vueCarte.scale || 50000, 50000) }).catch(() => {});
    } else {
      await vueCarte.goTo(etendue.expand(1.4)).catch(() => {});
    }
  }
}

function selectionner(id) {
  const index = indexFiliation(liens);
  const conjoints = indexConjoints(liens, evenementsMariage);
  selectionCible = String(id);
  selectionIds = entourage(id, index, conjoints);
  const cible = personnes.find((p) => String(p.id_personne) === String(id));
  const nom = cible ? libellePersonne(cible) : "";
  setStatut(nom ? "Parents, conjoint et enfants de " + nom : "Parents, conjoint et enfants");
  elBtnTout.disabled = false;
  appliquerSurbrillance();
  appliquerFiltreCarte(selectionIds);
}

function toutAfficher() {
  selectionIds = null;
  selectionCible = null;
  setStatut(personnes.length ? personnes.length + " personnes" : "");
  elBtnTout.disabled = true;
  appliquerSurbrillance();
  appliquerFiltreCarte(null);
}

elBtnTout.addEventListener("click", toutAfficher);
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Escape") toutAfficher();
});

/* ---------- Chargement AGOL ---------- */

function chargerModules(noms) {
  return new Promise((resolve, reject) => {
    if (typeof require === "undefined") {
      reject(new Error("ArcGIS Maps SDK indisponible"));
      return;
    }
    require(noms, (...mods) => resolve(mods), reject);
  });
}

async function assurerConnexion(IdentityManager, OAuthInfo) {
  const serveur = PORTAIL_URL + "/sharing";
  if (GEOGENEALOGIE_APP_ID) {
    IdentityManager.registerOAuthInfos([
      new OAuthInfo({
        appId: GEOGENEALOGIE_APP_ID,
        portalUrl: PORTAIL_URL,
        popup: true,
        expiration: 20160
      })
    ]);
  }
  try {
    await IdentityManager.checkSignInStatus(serveur);
  } catch (e) {
    await IdentityManager.getCredential(serveur);
  }
}

async function interrogerCouche(FeatureLayer, url, champs) {
  const couche = new FeatureLayer({ url });
  await couche.load();
  const entites = [];
  let depasse = 0;
  const totalEstime = await couche.queryFeatureCount({ where: "1=1" }).catch(() => 0);
  while (entites.length < (totalEstime || 1) || depasse === 0) {
    const res = await couche.queryFeatures({
      where: "1=1",
      outFields: champs,
      returnGeometry: false,
      start: depasse,
      num: 1000
    });
    const feats = (res.features || []);
    entites.push(...feats);
    depasse += feats.length;
    if (!feats.length || (totalEstime && entites.length >= totalEstime) || feats.length < 1000) break;
  }
  return entites;
}

async function initCarteWeb(WebMap, MapView, Portal) {
  const portail = new Portal({ url: PORTAIL_URL });
  const webmap = new WebMap({
    portalItem: { id: WEBMAP_ID, portal: portail }
  });
  const view = new MapView({
    container: "carte",
    map: webmap,
    ui: { components: ["zoom"] }
  });
  await webmap.load();
  await view.when();
  vueCarte = view;
  etendueInitiale = view.extent ? view.extent.clone() : null;
  couchesCarte = [];
  webmap.allLayers.forEach((layer) => {
    if (layer.type !== "feature") return;
    if (!exprsOrigine.has(layer)) {
      exprsOrigine.set(layer, layer.definitionExpression || "");
    }
    couchesCarte.push(layer);
  });
  return view;
}

async function initCarteFond(Map, MapView, esriConfig) {
  if (esriConfig && esriConfig.assetsPath) {
    /* rien à changer */
  }
  const map = new Map({ basemap: "gray-vector" });
  const view = new MapView({
    container: "carte",
    map,
    center: [0.3, 49.45],
    zoom: 9,
    ui: { components: ["zoom"] }
  });
  await view.when().catch(() => {});
  vueCarte = view;
  return view;
}

async function demarrerReel() {
  setStatut("Connexion au portail…");
  const [
    IdentityManager,
    OAuthInfo,
    FeatureLayer,
    WebMap,
    MapView,
    Portal
  ] = await chargerModules([
    "esri/identity/IdentityManager",
    "esri/identity/OAuthInfo",
    "esri/layers/FeatureLayer",
    "esri/WebMap",
    "esri/views/MapView",
    "esri/portal/Portal"
  ]);
  await assurerConnexion(IdentityManager, OAuthInfo);
  setStatut("Chargement des données…");
  const [pts, fil] = await Promise.all([
    interrogerCouche(FeatureLayer, SERVICE_URL + "/0", ["*"]),
    interrogerCouche(FeatureLayer, SERVICE_URL + "/2", ["id_parent", "id_enfant"])
  ]);
  personnes = agregerPersonnes(pts);
  evenementsMariage = extraireMariages(pts);
  liens = liensDepuisAttributs(personnes, lireLiens(fil));
  dessinerArbre();
  setStatut(personnes.length + " personnes");
  elBtnTout.disabled = true;
  await initCarteWeb(WebMap, MapView, Portal);
}

async function demarrerDemo() {
  elBanniere.hidden = false;
  const data = donneesDemo();
  personnes = data.personnes;
  evenementsMariage = extraireMariages(data.mariages || []);
  liens = liensDepuisAttributs(personnes, data.liens);
  dessinerArbre();
  setStatut("Démo — données fictives · " + personnes.length + " personnes");
  elCarteNote.hidden = false;
  elCarteNote.textContent = "Carte : fond seul en mode démo (service privé non chargé)";
  try {
    const [Map, MapView] = await chargerModules(["esri/Map", "esri/views/MapView"]);
    await initCarteFond(Map, MapView);
  } catch (err) {
    /* le fond SDK est facultatif en démo */
  }
  selectionner("A");
  document.body.dataset.ready = "1";
}

async function principal() {
  try {
    if (MODE_DEMO) {
      await demarrerDemo();
      return;
    }
    await demarrerReel();
    document.body.dataset.ready = "1";
  } catch (err) {
    const msg = document.createElement("p");
    msg.className = "msg";
    msg.textContent =
      "Impossible de charger l'arbre. Vérifiez la connexion au portail ArtsGIS et que votre compte a accès au service privé. " +
      (err && err.message ? err.message : "");
    elArbre.replaceChildren(msg);
    setStatut("Connexion requise");
    document.body.dataset.ready = "erreur";
  }
}

principal();
