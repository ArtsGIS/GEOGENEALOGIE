/* Démonstrateur ARTSGIS · geogenealogie — arbre de filiation relié à la carte.
   Aucune donnée nominative n'est embarquée. L'arbre est construit après
   connexion au portail, en interrogeant le service privé. */

const GEOGENEALOGIE_APP_ID = "udINS8SIv8TZ6OSV";

const PORTAIL_URL = "https://artsgis.maps.arcgis.com";
const SERVICE_URL =
  "https://services8.arcgis.com/oi4y3kiOYSwRlxqD/arcgis/rest/services/geogenealogie_lieux/FeatureServer";
const WEBMAP_ID = "93a058400dea4a37926cfb6f0d80bf00";

const COULEURS_BRANCHE = {
  proband: "#0A2F5C"
};

const ORDRE_BRANCHES = ["proband"]; // autres branches : couleur portée par la donnée (champ couleur), aucun prénom en dur

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
let selectionIds = null;
let couchesCarte = [];
let exprsOrigine = new Map();
let vueCarte = null;
let etendueInitiale = null;

function couleurBranche(branche, secours) {
  const cle = String(branche || "").trim().toLowerCase();
  return COULEURS_BRANCHE[cle] || secours || "#1E6FB8";
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
      fictif("A", "A", "Personne", "F", 1, "Proband", 2000, 1, "#0A2F5C"),
      fictif("B", "B", "Personne", "M", 2, "Branche nord", 1970, 0, "#1E6FB8"),
      fictif("C", "C", "Personne", "F", 2, "Branche sud", 1972, 0, "#E0662A"),
      fictif("D", "D", "Personne", "M", 3, "Branche nord", 1945, 0, "#1E6FB8"),
      fictif("E", "E", "Personne", "F", 3, "Branche nord", 1948, 0, "#1E6FB8"),
      fictif("F", "F", "Personne", "M", 3, "Branche sud", 1946, 0, "#E0662A"),
      fictif("G", "G", "Personne", "F", 3, "Branche sud", 1949, 0, "#E0662A"),
      fictif("H", "H", "Personne", "M", 0, "Proband", 2020, 1, "#0A2F5C")
    ],
    liens: [
      { id_parent: "D", id_enfant: "B" },
      { id_parent: "E", id_enfant: "B" },
      { id_parent: "F", id_enfant: "C" },
      { id_parent: "G", id_enfant: "C" },
      { id_parent: "B", id_enfant: "A" },
      { id_parent: "C", id_enfant: "A" },
      { id_parent: "A", id_enfant: "H" }
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
      type_evt: a.type_evt
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

function filiationDirecte(id, index) {
  const ids = new Set([String(id)]);
  for (const p of index.parentsDe.get(String(id)) || []) ids.add(String(p));
  for (const e of index.enfantsDe.get(String(id)) || []) ids.add(String(e));
  return Array.from(ids);
}

/* ---------- Disposition de l'arbre ---------- */

function ordreBranche(b) {
  const i = ORDRE_BRANCHES.indexOf(String(b || "").trim().toLowerCase());
  return i === -1 ? 50 : i;
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

  const comparer = (a, b) => {
    const db = ordreBranche(a.branche_gp) - ordreBranche(b.branche_gp);
    if (db) return db;
    const enfantsA = (enfantsDe.get(String(a.id_personne)) || []).slice().sort();
    const enfantsB = (enfantsDe.get(String(b.id_personne)) || []).slice().sort();
    if (enfantsA[0] && enfantsB[0] && enfantsA[0] !== enfantsB[0]) {
      return enfantsA[0] < enfantsB[0] ? -1 : 1;
    }
    const sexeOrdre = (s) =>
      String(s).toUpperCase() === "M" ? 0 : String(s).toUpperCase() === "F" ? 1 : 2;
    const ds = sexeOrdre(a.sexe) - sexeOrdre(b.sexe);
    if (ds) return ds;
    return String(a.id_personne).localeCompare(String(b.id_personne), "fr", { numeric: true });
  };

  const pos = new Map();
  for (let gi = generations.length - 1; gi >= 0; gi--) {
    const g = generations[gi];
    const y = PAD + (gMax - g) * (BOX_H + GAP_Y);
    const rang = gens.get(g).slice().sort(comparer);
    const cibles = rang.map((p, i) => {
      const pars = (parentsDe.get(String(p.id_personne)) || [])
        .map((id) => pos.get(String(id)))
        .filter(Boolean);
      const x = pars.length ? pars.reduce((s, q) => s + q.x, 0) / pars.length : null;
      return { p, i, x };
    });
    cibles.sort((a, b) => {
      if (a.x == null && b.x == null) return a.i - b.i;
      if (a.x == null) return 1;
      if (b.x == null) return -1;
      return a.x - b.x || a.i - b.i;
    });
    let dernier = PAD - minEcart;
    for (const c of cibles) {
      const souhait = c.x == null ? dernier + minEcart : c.x;
      c.x = Math.max(souhait, dernier + minEcart);
      dernier = c.x;
    }
    for (const c of cibles) {
      pos.set(String(c.p.id_personne), { x: c.x, y, personne: c.p });
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
      couleurBranche(personne && personne.branche_gp, personne && personne.couleur)
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
    const couleur = couleurBranche(pers.branche_gp, pers.couleur);
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
  elArbre.querySelectorAll(".case").forEach((n) => {
    n.classList.toggle("actif", !!(actif && actif.has(n.dataset.id)));
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
  selectionIds = filiationDirecte(id, index);
  const cible = personnes.find((p) => String(p.id_personne) === String(id));
  const nom = cible ? libellePersonne(cible) : "";
  setStatut(nom ? "Filiation directe de " + nom : "Filiation directe");
  elBtnTout.disabled = false;
  appliquerSurbrillance();
  appliquerFiltreCarte(selectionIds);
}

function toutAfficher() {
  selectionIds = null;
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
    interrogerCouche(FeatureLayer, SERVICE_URL + "/0", [
      "id_personne",
      "nom",
      "prenoms",
      "sexe",
      "generation",
      "branche_gp",
      "annee",
      "est_vivant",
      "type_evt"
    ]),
    interrogerCouche(FeatureLayer, SERVICE_URL + "/2", ["id_parent", "id_enfant"])
  ]);
  personnes = agregerPersonnes(pts);
  liens = lireLiens(fil);
  dessinerArbre();
  setStatut(personnes.length + " personnes");
  elBtnTout.disabled = true;
  await initCarteWeb(WebMap, MapView, Portal);
}

async function demarrerDemo() {
  elBanniere.hidden = false;
  const data = donneesDemo();
  personnes = data.personnes;
  liens = data.liens;
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
