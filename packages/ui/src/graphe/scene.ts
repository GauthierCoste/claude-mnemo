/**
 * Scène 3D du graphe de la mémoire : formes pleines (fiche : boule, notion : icosaèdre), halos, liens, axe du temps,
 * étiquettes, caméra orbitale et vol vers une fiche. Les couleurs viennent des jetons
 * (`CouleursGraphe`), les étiquettes s'écrivent par `textContent` et portent `data-genre` (`forte`, `axe`) pour leur
 * style.
 * Rendu à la demande : une image seulement quand la caméra, la disposition, un vol ou la rotation lente changent.
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { CouleursGraphe } from './couleurs.ts';
import type { AxeDuTemps, Simulation } from './disposition.ts';
import type { GraphePrepare, LienNoeud, Noeud } from './donnees.ts';
import { SEUIL_PIXELS_UN } from './plafond.ts';

const DUREE_VOL_MS = 750;
const BUDGET_DISPOSITION_MS = 12;
const ETIQUETTES_PAR_DEFAUT = 26;
const ETIQUETTES_RESERVE = 56;
const SEUIL_GLISSER_PX = 4;
// Relance douce de la disposition pendant un déplacement : les voisins suivent sans tout rebrasser.
const RECHAUFFE_GLISSER = 0.3;
const ECART_ETIQUETTES = { x: 120, y: 18 };
const RAYON_LIEN_SURVOLE = 6;
// Rayon d'une forme rapporté à la taille du nœud (diamètre de son halo) : le cœur lumineux d'avant.
const RAYON_SUR_TAILLE = 0.22;
const AGRANDI_SELECTION = 1.3;
const ESTOMPE = 0.86;

const NUANCEUR_SOMMETS = `attribute vec3 aColor; attribute float aSize; attribute float aAlpha; attribute float aKind;
uniform float uScale; uniform float uFade; varying vec3 vColor; varying float vAlpha; varying float vKind;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
	vColor = aColor; vKind = aKind; vAlpha = aAlpha * clamp(1.3 - d / uFade, 0.28, 1.0);
	gl_PointSize = max(aSize * uScale / d, 2.0); gl_Position = projectionMatrix * mv; }`;
// Halo léger teinté de la lueur autour de chaque forme ; anneau pour la cible d'un lien cassé et pour un épinglé.
const NUANCEUR_FRAGMENTS = `varying vec3 vColor; varying float vAlpha; varying float vKind;
uniform vec3 uHolo;
void main(){ float d = length(gl_PointCoord - 0.5); if (d > 0.5) discard;
	float halo = pow(1.0 - d * 2.0, 2.2);
	vec3 c = mix(pow(vColor, vec3(1.0 / 2.2)), uHolo, 0.4);
	float a = halo * 0.32;
	if (vKind > 0.5) { c = pow(vColor, vec3(1.0 / 2.2)); a = smoothstep(0.5, 0.45, d) * smoothstep(0.30, 0.36, d); }
	gl_FragColor = vec4(c, vAlpha * a); }`;

/** État de lecture passé à `appliquer`. */
export type EtatScene = {
	/** Nœuds mis en avant (les autres estompés), ou null. */
	focus: Set<Noeud> | null;
	selection: Noeud | null;
	survol: Noeud | null;
	/** Ordre des étiquettes, les plus importantes d'abord. */
	ordre: Noeud[];
	liensVisibles: LienNoeud[];
	parentesVisibles: LienNoeud[];
	notionsVisibles?: LienNoeud[];
};

export type RappelsScene = {
	survol(noeud: Noeud | null): void;
	lienSurvole(lien: LienNoeud | null, x: number, y: number): void;
	clic(noeud: Noeud | null): void;
	doubleClic(noeud: Noeud): void;
	/** Après un nœud déplacé ou libéré à la main. */
	epingles(nombre: number): void;
};

export type SceneGraphe = {
	/** Remplace les nœuds et liens dessinés ; garde la caméra. */
	charger(graphe: GraphePrepare): void;
	/** Couleurs, tailles, visibilité et mise en avant. */
	appliquer(etat: EtatScene): void;
	/** Lance une disposition ; `axeDuTemps` (ou null) dessine l'axe et ses graduations. */
	disposer(simulation: Simulation, axeDuTemps: AxeDuTemps | null, recadrerEnsuite: boolean): void;
	recadrer(oblique?: boolean): void;
	centrerSur(noeud: Noeud): void;
	/** Densité des étiquettes : `maximum` hors fiche sélectionnée ou survolée, `chevauchements` permis ou masqués. */
	densiteEtiquettes(densite: { maximum: number; chevauchements: boolean }): void;
	/** Libère les nœuds épinglés à la main ; `relancer` laisse la disposition les replacer. */
	libererEpingles(relancer?: boolean): void;
	rotation(active: boolean): void;
	/** Couleurs relues dans les jetons (l'accent a changé) : teinte les matériaux en place, sans recréer la scène (positions gardées). */
	majCouleurs(nouvelles: CouleursGraphe): void;
	demander(): void;
	detruire(): void;
};

// Une géométrie par sorte d'objet du graphe, de même encombrement : instanciée, un seul appel de dessin par forme.
function geometriesDesFormes() {
	return {
		fiche: new THREE.SphereGeometry(1, 18, 12),
		notion: new THREE.IcosahedronGeometry(1.12, 0),
	};
}

function tamponPositions(nombre: number): THREE.BufferGeometry {
	const geometrie = new THREE.BufferGeometry();
	geometrie.setAttribute('position', new THREE.BufferAttribute(new Float32Array(Math.max(1, nombre) * 6), 3));
	geometrie.setDrawRange(0, 0);
	return geometrie;
}

/** Tirets de la parenté, en unités de la scène. */
const TIRET = 4;
const ESPACE_TIRET = 3;

/** Segments en tirets : `LineDashedMaterial` lit la distance de chaque sommet au début de son segment (`lineDistance`). */
function tamponTirets(nombre: number): THREE.BufferGeometry {
	const geometrie = tamponPositions(nombre);
	geometrie.setAttribute('lineDistance', new THREE.BufferAttribute(new Float32Array(Math.max(1, nombre) * 2), 1));
	return geometrie;
}

type Projete = { x: number; y: number; w: number };

/**
 * Lève une erreur si WebGL est indisponible.
 */
export function creerSceneGraphe({
	conteneur,
	calqueEtiquettes,
	couleurs,
	mouvementReduit = () => false,
	rappels,
}: {
	conteneur: HTMLElement;
	calqueEtiquettes: HTMLElement;
	couleurs: CouleursGraphe;
	mouvementReduit?: () => boolean;
	rappels: RappelsScene;
}): SceneGraphe {
	const fond = new THREE.Color(couleurs.fond);
	const rendu = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
	const pixelsEcran = Math.min(window.devicePixelRatio || 1, 2);
	rendu.setPixelRatio(pixelsEcran);
	rendu.setClearColor(fond, 0);
	rendu.domElement.setAttribute('aria-hidden', 'true');
	conteneur.prepend(rendu.domElement);
	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);
	camera.position.set(0, 120, 900);
	const controles = new OrbitControls(camera, rendu.domElement);
	controles.enableDamping = true;
	controles.dampingFactor = 0.08;
	controles.rotateSpeed = 0.6;
	controles.autoRotateSpeed = 0.35;
	controles.minDistance = 20;
	controles.maxDistance = 9000;

	const materielPoints = new THREE.ShaderMaterial({
		uniforms: { uScale: { value: 1 }, uFade: { value: 2000 }, uHolo: { value: new THREE.Color(couleurs.lueur) } },
		vertexShader: NUANCEUR_SOMMETS,
		fragmentShader: NUANCEUR_FRAGMENTS,
		transparent: true,
		depthWrite: false,
		depthTest: false,
		blending: THREE.AdditiveBlending,
	});
	const geometries = geometriesDesFormes();
	const materielFormes = new THREE.MeshLambertMaterial({ color: couleurs.lumiere, flatShading: false });
	const materielIcosaedres = new THREE.MeshLambertMaterial({ color: couleurs.lumiere, flatShading: true });
	scene.add(new THREE.AmbientLight(couleurs.lumiere, 1.15));
	const lumiere = new THREE.DirectionalLight(couleurs.lumiere, 1.9);
	lumiere.position.set(0.4, 0.8, 1);
	camera.add(lumiere);
	scene.add(camera);
	const materielLiens = new THREE.LineBasicMaterial({ color: couleurs.lien, transparent: true, opacity: 0.22, depthWrite: false, depthTest: false });
	// Parenté de l'arbre : couleur à part, plus discrète que les relations, pour ne pas se lire comme un lien direct.
	const materielParentes = new THREE.LineDashedMaterial({ color: couleurs.parente, dashSize: TIRET, gapSize: ESPACE_TIRET, transparent: true, opacity: 0.16, depthWrite: false, depthTest: false });
	const materielParentesEclairees = new THREE.LineDashedMaterial({ color: couleurs.eclaire, dashSize: TIRET, gapSize: ESPACE_TIRET, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false });
	// Liens de notion (fiche vers la notion de ses faits) : troisième forme de lien, ni relation ni parenté.
	const materielNotions = new THREE.LineBasicMaterial({ color: couleurs.eclaire, transparent: true, opacity: 0.14, depthWrite: false, depthTest: false });
	const materielEclaires = new THREE.LineBasicMaterial({ color: couleurs.eclaire, transparent: true, opacity: 0.85, depthWrite: false, depthTest: false });
	const materielSurvole = new THREE.LineBasicMaterial({ color: couleurs.survol, transparent: true, opacity: 1, depthWrite: false, depthTest: false });
	const materielAxe = new THREE.LineBasicMaterial({ color: couleurs.axe, transparent: true, opacity: 0.5, depthTest: false });

	let points: THREE.Points | null = null;
	let formes: THREE.InstancedMesh[] = [];
	const formeDe = new Map<Noeud, { forme: THREE.InstancedMesh; rang: number }>();
	let segments: THREE.LineSegments | null = null;
	let parentes: THREE.LineSegments | null = null;
	let parentesVisibles: LienNoeud[] = [];
	let parentesEclairees: THREE.LineSegments | null = null;
	let listeParentesEclairees: LienNoeud[] = [];
	let notions: THREE.LineSegments | null = null;
	let notionsVisibles: LienNoeud[] = [];
	let eclaires: THREE.LineSegments | null = null;
	let survole: THREE.LineSegments | null = null;
	let axe: THREE.LineSegments | null = null;
	let donneesAxe: AxeDuTemps | null = null;
	let noeuds: Noeud[] = [];
	let liensVisibles: LienNoeud[] = [];
	let liensEclaires: LienNoeud[] = [];
	let lienSurvole: LienNoeud | null = null;
	let etat: EtatScene = { focus: null, selection: null, survol: null, ordre: [], liensVisibles: [], parentesVisibles: [] };
	let simulation: Simulation | null = null;
	let derniereSimulation: Simulation | null = null;
	let recadrerApresDisposition = false;
	let vol: { debut: number; camera0: THREE.Vector3; cible0: THREE.Vector3; camera1: THREE.Vector3; cible1: THREE.Vector3 } | null = null;
	let demande = 0;
	let pointeur: { x: number; y: number; glisse: boolean } | null = null;
	let appui: { x: number; y: number } | null = null;
	let largeur = 1;
	let hauteur = 1;
	const matrice = new THREE.Matrix4();
	const projete: Projete = { x: 0, y: 0, w: 0 };
	const couleur = new THREE.Color();
	const placement = new THREE.Matrix4();
	const position = new THREE.Vector3();
	const orientation = new THREE.Quaternion();
	const echelle = new THREE.Vector3();

	let densite = { maximum: ETIQUETTES_PAR_DEFAUT, chevauchements: false };
	let glisser: { noeud: Noeud; x: number; y: number; actif: boolean } | null = null;
	const etiquettes: HTMLDivElement[] = [];
	const plan = new THREE.Plane();
	const rayon = new THREE.Raycaster();
	const pointeurNormalise = new THREE.Vector2();
	const point = new THREE.Vector3();

	function etiquetteDeRang(rang: number): HTMLDivElement {
		while (etiquettes.length <= rang) {
			const etiquette = document.createElement('div');
			etiquette.hidden = true;
			calqueEtiquettes.append(etiquette);
			etiquettes.push(etiquette);
		}
		return etiquettes[rang]!;
	}
	etiquetteDeRang(ETIQUETTES_RESERVE - 1);

	function demander(): void {
		if (demande === 0) demande = requestAnimationFrame(image);
	}

	function projeter(x: number, y: number, z: number, sortie: Projete): boolean {
		const e = matrice.elements;
		const w = e[3]! * x + e[7]! * y + e[11]! * z + e[15]!;
		if (w <= 0.5) return false;
		sortie.x = (((e[0]! * x + e[4]! * y + e[8]! * z + e[12]!) / w) * 0.5 + 0.5) * largeur;
		sortie.y = (0.5 - ((e[1]! * x + e[5]! * y + e[9]! * z + e[13]!) / w) * 0.5) * hauteur;
		sortie.w = w;
		return true;
	}

	function ecrirePositions(): void {
		if (!points) return;
		const positions = points.geometry.attributes['position']!.array as Float32Array;
		for (const noeud of noeuds) {
			positions[noeud.id * 3] = noeud.x;
			positions[noeud.id * 3 + 1] = noeud.y;
			positions[noeud.id * 3 + 2] = noeud.z;
		}
		points.geometry.attributes['position']!.needsUpdate = true;
		for (const noeud of noeuds) {
			const instance = formeDe.get(noeud);
			if (instance) {
				const r = noeud.visible ? noeud.taille * RAYON_SUR_TAILLE * (noeud === etat.selection || noeud === etat.survol ? AGRANDI_SELECTION : 1) : 0;
				instance.forme.setMatrixAt(instance.rang, placement.compose(position.set(noeud.x, noeud.y, noeud.z), orientation, echelle.setScalar(r)));
			}
		}
		for (const forme of formes) forme.instanceMatrix.needsUpdate = true;
		const lignes: [THREE.LineSegments | null, LienNoeud[]][] = [
			[segments, liensVisibles],
			[parentes, parentesVisibles],
			[notions, notionsVisibles],
			[eclaires, liensEclaires],
			[parentesEclairees, listeParentesEclairees],
			[survole, lienSurvole ? [lienSurvole] : []],
		];
		for (const [objet, liste] of lignes) {
			if (!objet) continue;
			const tampon = objet.geometry.attributes['position']!.array as Float32Array;
			liste.forEach((lien, rang) => {
				tampon.set([lien.source.x, lien.source.y, lien.source.z, lien.cible.x, lien.cible.y, lien.cible.z], rang * 6);
			});
			objet.geometry.setDrawRange(0, liste.length * 2);
			objet.geometry.attributes['position']!.needsUpdate = true;
			const distances = objet.geometry.attributes['lineDistance'];
			if (distances) {
				const tamponDistances = distances.array as Float32Array;
				liste.forEach((lien, rang) => {
					tamponDistances[rang * 2] = 0;
					tamponDistances[rang * 2 + 1] = Math.hypot(lien.cible.x - lien.source.x, lien.cible.y - lien.source.y, lien.cible.z - lien.source.z);
				});
				distances.needsUpdate = true;
			}
		}
		if (axe) {
			let plusBas = 0;
			for (const noeud of noeuds) if (noeud.visible) plusBas = Math.min(plusBas, noeud.y);
			axe.position.y = plusBas * 1.08 - 12;
		}
	}

	function placerEtiquettes(): void {
		matrice.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const candidats: { noeud: Noeud; x: number; y: number; forte: boolean }[] = [];
		const principal = etat.selection ?? etat.survol;
		const liste = [...(principal ? [principal] : []), ...etat.ordre.filter((noeud) => noeud !== principal && (!etat.focus || etat.focus.has(noeud)))];
		for (const noeud of liste) {
			if (noeud !== principal && candidats.length - (principal ? 1 : 0) >= densite.maximum) break;
			if (noeud.visible && projeter(noeud.x, noeud.y, noeud.z, projete) && projete.x > 0 && projete.x < largeur && projete.y > 0 && projete.y < hauteur) {
				candidats.push({ noeud, x: projete.x, y: projete.y, forte: noeud === principal });
			}
		}
		const posees: typeof candidats = [];
		let rang = 0;
		for (const candidat of candidats) {
			if (
				!candidat.forte &&
				!densite.chevauchements &&
				posees.some((posee) => Math.abs(posee.y - candidat.y) < ECART_ETIQUETTES.y && Math.abs(posee.x - candidat.x) < ECART_ETIQUETTES.x)
			) {
				continue;
			}
			posees.push(candidat);
			const etiquette = etiquetteDeRang(rang++);
			if (etiquette.textContent !== candidat.noeud.titre) etiquette.textContent = candidat.noeud.titre;
			etiquette.dataset['genre'] = candidat.forte ? 'forte' : '';
			etiquette.style.color = candidat.noeud.couleur;
			etiquette.style.transform = `translate(${Math.round(candidat.x + 9)}px, ${Math.round(candidat.y - 10)}px)`;
			etiquette.hidden = false;
		}
		if (axe && donneesAxe) {
			const graduations = [...donneesAxe.graduations, { z: donneesAxe.planSansDate, texte: 'Sans date' }];
			for (const graduation of graduations) {
				if (!projeter(14, axe.position.y, graduation.z, projete)) continue;
				const etiquette = etiquetteDeRang(rang++);
				etiquette.textContent = graduation.texte;
				etiquette.dataset['genre'] = 'axe';
				etiquette.style.color = '';
				etiquette.style.transform = `translate(${Math.round(projete.x + 6)}px, ${Math.round(projete.y - 9)}px)`;
				etiquette.hidden = false;
			}
		}
		for (; rang < etiquettes.length; rang++) etiquettes[rang]!.hidden = true;
	}

	function noeudSous(x: number, y: number): Noeud | null {
		matrice.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
		const echellePixels = hauteur / (2 * Math.tan((camera.fov * Math.PI) / 360));
		let trouve: Noeud | null = null;
		let meilleur = Infinity;
		for (const noeud of noeuds) {
			if (!noeud.visible || (etat.focus && etat.selection && !etat.focus.has(noeud)) || !projeter(noeud.x, noeud.y, noeud.z, projete)) continue;
			const distance = Math.hypot(projete.x - x, projete.y - y);
			if (distance < Math.max(8, ((noeud.taille * echellePixels) / projete.w) * 0.5) && distance < meilleur) {
				meilleur = distance;
				trouve = noeud;
			}
		}
		return trouve;
	}

	function lienSous(x: number, y: number): LienNoeud | null {
		const a: Projete = { x: 0, y: 0, w: 0 };
		const b: Projete = { x: 0, y: 0, w: 0 };
		let trouve: LienNoeud | null = null;
		let meilleur = RAYON_LIEN_SURVOLE;
		for (const lien of etat.focus ? liensEclaires : liensVisibles) {
			if (!projeter(lien.source.x, lien.source.y, lien.source.z, a) || !projeter(lien.cible.x, lien.cible.y, lien.cible.z, b)) continue;
			const dx = b.x - a.x;
			const dy = b.y - a.y;
			const longueur2 = dx * dx + dy * dy;
			const t = longueur2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / longueur2));
			const distance = Math.hypot(a.x + t * dx - x, a.y + t * dy - y);
			if (distance < meilleur) {
				meilleur = distance;
				trouve = lien;
			}
		}
		return trouve;
	}

	function examinerPointeur(): void {
		if (!pointeur || pointeur.glisse || vol) return;
		const { x, y } = pointeur;
		pointeur = null;
		const noeud = noeudSous(x, y);
		rendu.domElement.style.cursor = noeud ? 'pointer' : 'grab';
		if (noeud !== etat.survol) rappels.survol(noeud);
		const lien = noeud ? null : lienSous(x, y);
		if (lien !== lienSurvole) {
			lienSurvole = lien;
			ecrirePositions();
		}
		rappels.lienSurvole(lien, x, y);
	}

	function image(): void {
		demande = 0;
		let encore = false;
		if (simulation) {
			encore = simulation.avancer(BUDGET_DISPOSITION_MS);
			ecrirePositions();
			if (!encore) {
				simulation = null;
				if (recadrerApresDisposition) {
					recadrerApresDisposition = false;
					// L'axe du temps se lit de biais.
					recadrer(donneesAxe !== null);
				}
			}
			encore = true;
		}
		if (vol) {
			const avancement = Math.min(1, (performance.now() - vol.debut) / DUREE_VOL_MS);
			const adouci = avancement < 0.5 ? 4 * avancement ** 3 : 1 - (-2 * avancement + 2) ** 3 / 2;
			camera.position.lerpVectors(vol.camera0, vol.camera1, adouci);
			controles.target.lerpVectors(vol.cible0, vol.cible1, adouci);
			vol = avancement >= 1 ? null : vol;
			encore = true;
		}
		if (controles.update()) encore = true;
		if (controles.autoRotate) encore = true;
		materielPoints.uniforms['uFade']!.value = Math.max(600, camera.position.distanceTo(controles.target) * 2.6);
		examinerPointeur();
		rendu.render(scene, camera);
		placerEtiquettes();
		if (encore) demander();
	}

	function voler(cible: THREE.Vector3, distance: number, direction: THREE.Vector3 | null = null): void {
		const sens = direction ?? camera.position.clone().sub(controles.target).normalize();
		const arrivee = cible.clone().add(sens.multiplyScalar(distance));
		if (mouvementReduit()) {
			camera.position.copy(arrivee);
			controles.target.copy(cible);
			vol = null;
		} else {
			vol = { debut: performance.now(), camera0: camera.position.clone(), cible0: controles.target.clone(), camera1: arrivee, cible1: cible.clone() };
		}
		demander();
	}

	function recadrer(oblique = false): void {
		const visibles = noeuds.filter((noeud) => noeud.visible);
		if (visibles.length === 0) return;
		const centre = new THREE.Vector3();
		for (const noeud of visibles) centre.add(new THREE.Vector3(noeud.x, noeud.y, noeud.z));
		centre.divideScalar(visibles.length);
		let rayon2 = 0;
		for (const noeud of visibles) rayon2 = Math.max(rayon2, (noeud.x - centre.x) ** 2 + (noeud.y - centre.y) ** 2 + (noeud.z - centre.z) ** 2);
		const distance = Math.max(120, (Math.sqrt(rayon2) / Math.sin((camera.fov * Math.PI) / 360)) * 0.82);
		voler(centre, distance, oblique ? new THREE.Vector3(0.94, 0.22, 0.26).normalize() : null);
	}

	// L'anneau d'un épinglé garde sa taille au survol : seul le halo s'agrandit.
	function tailleDuHalo(noeud: Noeud): number {
		return noeud.taille * ((noeud === etat.selection || noeud === etat.survol) && !noeud.epingle ? 2 : 1);
	}

	function marquerEpingles(): void {
		if (!points) return;
		const aKind = points.geometry.attributes['aKind']!;
		const aSize = points.geometry.attributes['aSize']!;
		for (const noeud of noeuds) {
			(aKind.array as Float32Array)[noeud.id] = noeud.fantome || noeud.epingle ? 1 : 0;
			(aSize.array as Float32Array)[noeud.id] = tailleDuHalo(noeud);
		}
		aKind.needsUpdate = true;
		aSize.needsUpdate = true;
	}

	function relancerDisposition(): void {
		if (!derniereSimulation || mouvementReduit()) return;
		derniereSimulation.rechauffer(RECHAUFFE_GLISSER);
		simulation = derniereSimulation;
		recadrerApresDisposition = false;
		demander();
	}

	function poserSousLePointeur(noeud: Noeud, x: number, y: number): void {
		pointeurNormalise.set((x / largeur) * 2 - 1, -(y / hauteur) * 2 + 1);
		rayon.setFromCamera(pointeurNormalise, camera);
		if (rayon.ray.intersectPlane(plan, point)) {
			noeud.x = point.x;
			noeud.y = point.y;
			noeud.z = point.z;
		}
	}

	function echelleDesHalos(): void {
		materielPoints.uniforms['uScale']!.value = (hauteur * rendu.getPixelRatio()) / (2 * Math.tan((camera.fov * Math.PI) / 360));
	}

	// En capture sur le conteneur : décidé avant qu'OrbitControls ne commence une rotation sur le même appui.
	const surAppuiNoeud = (evenement: PointerEvent) => {
		if (evenement.target !== rendu.domElement || evenement.button !== 0 || evenement.altKey) return;
		const cadre = rendu.domElement.getBoundingClientRect();
		const noeud = noeudSous(evenement.clientX - cadre.left, evenement.clientY - cadre.top);
		if (!noeud) return;
		controles.enabled = false;
		camera.getWorldDirection(point);
		plan.setFromNormalAndCoplanarPoint(point, position.set(noeud.x, noeud.y, noeud.z));
		glisser = { noeud, x: evenement.clientX, y: evenement.clientY, actif: false };
		rendu.domElement.setPointerCapture(evenement.pointerId);
	};
	const surAppui = (evenement: PointerEvent) => {
		appui = { x: evenement.clientX, y: evenement.clientY };
		vol = null;
	};
	const surDeplacement = (evenement: PointerEvent) => {
		const cadre = rendu.domElement.getBoundingClientRect();
		if (glisser) {
			if (!glisser.actif && Math.hypot(evenement.clientX - glisser.x, evenement.clientY - glisser.y) <= SEUIL_GLISSER_PX) return;
			glisser.actif = true;
			glisser.noeud.epingle = true;
			rendu.domElement.style.cursor = 'grabbing';
			poserSousLePointeur(glisser.noeud, evenement.clientX - cadre.left, evenement.clientY - cadre.top);
			ecrirePositions();
			relancerDisposition();
			demander();
			return;
		}
		pointeur = { x: evenement.clientX - cadre.left, y: evenement.clientY - cadre.top, glisse: evenement.buttons !== 0 };
		demander();
	};
	const surSortie = () => {
		pointeur = null;
		if (etat.survol) rappels.survol(null);
		if (lienSurvole) {
			lienSurvole = null;
			ecrirePositions();
			demander();
		}
		rappels.lienSurvole(null, 0, 0);
	};
	const surRelache = (evenement: PointerEvent) => {
		const deplace = glisser?.actif ? glisser.noeud : null;
		if (glisser) {
			glisser = null;
			controles.enabled = true;
			rendu.domElement.style.cursor = 'pointer';
		}
		if (deplace) {
			marquerEpingles();
			rappels.epingles(noeuds.filter((noeud) => noeud.epingle).length);
			demander();
			return;
		}
		if (!appui || Math.hypot(evenement.clientX - appui.x, evenement.clientY - appui.y) > SEUIL_GLISSER_PX) return;
		const cadre = rendu.domElement.getBoundingClientRect();
		const noeud = noeudSous(evenement.clientX - cadre.left, evenement.clientY - cadre.top);
		if (evenement.altKey && noeud?.epingle) {
			noeud.epingle = false;
			marquerEpingles();
			relancerDisposition();
			rappels.epingles(noeuds.filter((autre) => autre.epingle).length);
			return;
		}
		rappels.clic(noeud);
	};
	const surDoubleClic = (evenement: MouseEvent) => {
		const cadre = rendu.domElement.getBoundingClientRect();
		const noeud = noeudSous(evenement.clientX - cadre.left, evenement.clientY - cadre.top);
		if (noeud) rappels.doubleClic(noeud);
	};
	const surAnnulation = () => {
		if (glisser) {
			glisser = null;
			controles.enabled = true;
			marquerEpingles();
		}
	};
	conteneur.addEventListener('pointerdown', surAppuiNoeud, true);
	rendu.domElement.addEventListener('pointerdown', surAppui);
	rendu.domElement.addEventListener('pointermove', surDeplacement);
	rendu.domElement.addEventListener('pointerleave', surSortie);
	rendu.domElement.addEventListener('pointerup', surRelache);
	rendu.domElement.addEventListener('dblclick', surDoubleClic);
	rendu.domElement.addEventListener('pointercancel', surAnnulation);
	controles.addEventListener('change', demander);
	const observateur = new ResizeObserver(() => {
		largeur = Math.max(1, conteneur.clientWidth);
		hauteur = Math.max(1, conteneur.clientHeight);
		rendu.setSize(largeur, hauteur);
		camera.aspect = largeur / hauteur;
		camera.updateProjectionMatrix();
		echelleDesHalos();
		demander();
	});
	observateur.observe(conteneur);

	return {
		charger(graphe) {
			for (const objet of [points, segments, parentes, parentesEclairees, notions, eclaires, survole]) {
				if (objet) {
					scene.remove(objet);
					objet.geometry.dispose();
				}
			}
			for (const forme of formes) {
				scene.remove(forme);
				forme.dispose();
			}
			formeDe.clear();
			noeuds = graphe.noeuds;
			const parSorte = { fiche: noeuds.filter((noeud) => !noeud.fantome && !noeud.notion), notion: noeuds.filter((noeud) => noeud.notion) };
			formes = (Object.entries(parSorte) as ['fiche' | 'notion', Noeud[]][])
				.filter(([, liste]) => liste.length > 0)
				.map(([sorte, liste]) => {
					const forme = new THREE.InstancedMesh(geometries[sorte], sorte === 'notion' ? materielIcosaedres : materielFormes, liste.length);
					forme.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
					forme.frustumCulled = false;
					liste.forEach((noeud, rang) => {
						formeDe.set(noeud, { forme, rang });
						forme.setColorAt(rang, couleur.set(noeud.couleur || couleurs.texteSecondaire));
					});
					return forme;
				});
			const geometrie = new THREE.BufferGeometry();
			geometrie.setAttribute('position', new THREE.BufferAttribute(new Float32Array(noeuds.length * 3), 3));
			geometrie.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(noeuds.length * 3), 3));
			geometrie.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(noeuds.length), 1));
			geometrie.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(noeuds.length), 1));
			geometrie.setAttribute('aKind', new THREE.BufferAttribute(new Float32Array(noeuds.map((noeud) => (noeud.fantome ? 1 : 0))), 1));
			points = new THREE.Points(geometrie, materielPoints);
			segments = new THREE.LineSegments(tamponPositions(graphe.liens.length), materielLiens);
			parentes = new THREE.LineSegments(tamponTirets(graphe.parentes.length), materielParentes);
			parentesVisibles = [];
			parentesEclairees = new THREE.LineSegments(tamponTirets(graphe.parentes.length), materielParentesEclairees);
			listeParentesEclairees = [];
			notions = new THREE.LineSegments(tamponPositions(graphe.liensDeNotion.length), materielNotions);
			notionsVisibles = [];
			eclaires = new THREE.LineSegments(tamponPositions(graphe.liens.length), materielEclaires);
			survole = new THREE.LineSegments(tamponPositions(1), materielSurvole);
			for (const objet of [points, segments, parentes, parentesEclairees, notions, eclaires, survole]) objet.frustumCulled = false;
			// Halos et liens d'abord, sans profondeur ; les formes pleines ensuite, dessinées par-dessus.
			for (const objet of [parentes, notions, segments, parentesEclairees, eclaires, survole, points]) objet.renderOrder = -1;
			scene.add(parentes, notions, segments, parentesEclairees, eclaires, survole, points, ...formes);
			lienSurvole = null;
			marquerEpingles();
		},

		appliquer(nouvelEtat) {
			etat = nouvelEtat;
			if (!points) return;
			// Grande mémoire : au-delà du seuil de nœuds visibles, une image à l'échelle 1 reste fluide.
			const visibles = noeuds.reduce((total, noeud) => total + (noeud.visible ? 1 : 0), 0);
			const pixels = visibles > SEUIL_PIXELS_UN ? 1 : pixelsEcran;
			if (rendu.getPixelRatio() !== pixels) {
				rendu.setPixelRatio(pixels);
				rendu.setSize(largeur, hauteur);
				echelleDesHalos();
			}
			const attributs = points.geometry.attributes;
			const aColor = attributs['aColor']!.array as Float32Array;
			const aSize = attributs['aSize']!.array as Float32Array;
			const aAlpha = attributs['aAlpha']!.array as Float32Array;
			for (const noeud of noeuds) {
				const estompe = etat.focus !== null && !etat.focus.has(noeud);
				const enAvant = noeud === etat.selection || noeud === etat.survol;
				couleur.set(noeud.couleur || couleurs.texteSecondaire);
				aColor.set([couleur.r, couleur.g, couleur.b], noeud.id * 3);
				aSize[noeud.id] = tailleDuHalo(noeud);
				aAlpha[noeud.id] = noeud.visible ? (estompe ? 0.07 : enAvant ? 2.4 : 0.92) : 0;
				const instance = formeDe.get(noeud);
				if (instance) instance.forme.setColorAt(instance.rang, estompe ? couleur.lerp(fond, ESTOMPE) : couleur);
			}
			for (const forme of formes) if (forme.instanceColor) forme.instanceColor.needsUpdate = true;
			attributs['aColor']!.needsUpdate = true;
			attributs['aSize']!.needsUpdate = true;
			attributs['aAlpha']!.needsUpdate = true;
			liensVisibles = nouvelEtat.liensVisibles;
			parentesVisibles = nouvelEtat.parentesVisibles;
			notionsVisibles = nouvelEtat.notionsVisibles ?? [];
			materielParentes.opacity = etat.focus ? 0.04 : 0.16;
			materielNotions.opacity = etat.focus ? 0.05 : 0.14;
			const focus = etat.focus;
			const dansLeFocus = (lien: LienNoeud) => focus !== null && focus.has(lien.source) && focus.has(lien.cible);
			liensEclaires = liensVisibles.filter(dansLeFocus);
			listeParentesEclairees = parentesVisibles.filter(dansLeFocus);
			if (lienSurvole && !liensVisibles.includes(lienSurvole)) lienSurvole = null;
			materielLiens.opacity = etat.focus ? 0.05 : liensVisibles.length > 6000 ? 0.14 : 0.22;
			ecrirePositions();
			demander();
		},

		disposer(nouvelleSimulation, axeDuTemps, recadrerEnsuite) {
			simulation = nouvelleSimulation;
			derniereSimulation = nouvelleSimulation;
			recadrerApresDisposition = recadrerEnsuite;
			if (axe) {
				scene.remove(axe);
				axe.geometry.dispose();
				axe = null;
			}
			donneesAxe = axeDuTemps;
			if (axeDuTemps) {
				const sommets = [0, 0, -axeDuTemps.longueur, 0, 0, axeDuTemps.planSansDate];
				for (const graduation of [...axeDuTemps.graduations, { z: axeDuTemps.planSansDate }]) sommets.push(-10, 0, graduation.z, 10, 0, graduation.z);
				const geometrie = new THREE.BufferGeometry();
				geometrie.setAttribute('position', new THREE.BufferAttribute(new Float32Array(sommets), 3));
				axe = new THREE.LineSegments(geometrie, materielAxe);
				axe.frustumCulled = false;
				scene.add(axe);
			}
			if (mouvementReduit() && simulation) simulation.terminer();
			demander();
		},

		recadrer,

		centrerSur(noeud) {
			voler(new THREE.Vector3(noeud.x, noeud.y, noeud.z), Math.min(camera.position.distanceTo(controles.target), 150 + noeud.taille * 9));
		},

		densiteEtiquettes(nouvelleDensite) {
			densite = nouvelleDensite;
			demander();
		},

		libererEpingles(relancer = true) {
			for (const noeud of noeuds) noeud.epingle = false;
			marquerEpingles();
			if (relancer) relancerDisposition();
		},

		rotation(active) {
			controles.autoRotate = active && !mouvementReduit();
			demander();
		},

		majCouleurs(nouvelles) {
			couleurs = nouvelles;
			materielLiens.color.set(nouvelles.lien);
			materielParentes.color.set(nouvelles.parente);
			for (const materiel of [materielParentesEclairees, materielNotions, materielEclaires]) materiel.color.set(nouvelles.eclaire);
			materielSurvole.color.set(nouvelles.survol);
			materielAxe.color.set(nouvelles.axe);
			demander();
		},

		demander,

		detruire() {
			cancelAnimationFrame(demande);
			demande = 0;
			observateur.disconnect();
			conteneur.removeEventListener('pointerdown', surAppuiNoeud, true);
			controles.dispose();
			for (const objet of [points, segments, parentes, parentesEclairees, notions, eclaires, survole, axe]) objet?.geometry.dispose();
			for (const forme of formes) forme.dispose();
			for (const geometrie of Object.values(geometries)) geometrie.dispose();
			for (const materiel of [materielFormes, materielIcosaedres, materielPoints, materielLiens, materielParentes, materielParentesEclairees, materielNotions, materielEclaires, materielSurvole, materielAxe]) {
				materiel.dispose();
			}
			rendu.dispose();
			rendu.domElement.remove();
			for (const etiquette of etiquettes) etiquette.remove();
		},
	};
}
