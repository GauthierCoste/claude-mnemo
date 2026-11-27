/**
 * Page de l'assistant d'installation : affiche l'état du domaine (`evoluer`, `domaine/assistant.ts`) et parle au processus
 * principal par `window.assistant` (le preload), rien d'autre. Aucun HTML assemblé en texte : les éléments sont créés un à
 * un, le texte venu d'ailleurs posé en `textContent`. Premier écran : la langue (présélectionnée sur celle du processus
 * principal) ; la page bascule aussitôt, sans rechargement, et le processus principal la retient.
 */
import './assistant.css';
import { LANGUES, type Langue } from '@mnemo/commun';
import type { PosteVerifie } from '@mnemo/contrat';
import { ETAPES_ASSISTANT, etatInitial, evoluer, peutContinuer, peutReessayer, type EtapeAssistant, type EtatAssistant, type EvenementAssistant } from '../domaine/assistant.ts';
import { fractionPiece, type EtapeSuivie, type EtatInstallation, type PieceSuivie } from '../domaine/assistant-lignes.ts';
import { LIENS_EXTERNES, type ApiAssistant } from '../domaine/assistant-pont.ts';
import { textesAssistant } from '../domaine/assistant-textes.ts';
import { NOMS_LANGUES, textesApp, type TextesApp } from '../domaine/langue/textes.ts';

declare global {
	interface Window {
		assistant?: ApiAssistant;
	}
}

type Enfant = Node | string | null | false;
type Attributs = Record<string, string | boolean | undefined>;

/** Élément `balise` : attributs (booléen vrai : présent, faux ou absent : omis) et enfants (texte posé tel quel). */
function el(balise: string, attributs: Attributs = {}, ...enfants: Enfant[]): HTMLElement {
	const e = document.createElement(balise);
	for (const [nom, valeur] of Object.entries(attributs)) {
		if (valeur === undefined || valeur === false) continue;
		e.setAttribute(nom, valeur === true ? '' : valeur);
	}
	for (const enfant of enfants) if (enfant !== null && enfant !== false) e.append(enfant);
	return e;
}

function bouton(libelle: string, action: () => void, o: { primaire?: boolean; desactive?: boolean; cle: string }): HTMLElement {
	const b = el('button', { type: 'button', class: o.primaire === true ? 'bouton primaire' : 'bouton', disabled: o.desactive === true, 'data-cle': o.cle }, libelle);
	b.addEventListener('click', action);
	return b;
}

const lien = (libelle: string, url: string): HTMLElement => el('a', { href: url, target: '_blank', rel: 'noreferrer' }, libelle);

const api = window.assistant;
/** La plateforme vient du preload (macOS si la page est ouverte hors de l'app : elle ne fait alors rien). */
const plateforme = api?.plateforme === 'win32' ? 'win32' : 'darwin';
// barre de titre : les boutons de Windows sont à droite (`assistant.css`)
if (plateforme === 'win32') document.documentElement.dataset['plateforme'] = 'windows';
let etat: EtatAssistant = etatInitial(plateforme, api?.langue ?? 'fr');
/** `terminer` est en cours (configuration, ouverture de l'interface) ; `erreurFin` : ce qui l'a empêché. */
let ouverture = false;
let erreurFin: string | null = null;

/** Les textes de la langue choisie. */
const t = (): TextesApp => textesApp(etat.langue ?? 'fr');

function envoyer(e: EvenementAssistant): void {
	etat = evoluer(etat, e);
	afficher();
}

function choisirLangue(langue: Langue): void {
	if (etat.langue === langue) return;
	envoyer({ type: 'langue', langue });
	// le processus principal la retient (menus, préférences, `mnemo init --langue`) ; un échec n'empêche rien ici
	void api?.choisirLangue(langue).catch(() => {});
}

async function verifier(): Promise<void> {
	if (api === undefined) return;
	envoyer({ type: 'verification' });
	try {
		const r = await api.verifierPoste();
		envoyer(r.ok ? { type: 'poste', poste: r.poste } : r.cause === 'provisoire' ? { type: 'provisoire' } : { type: 'erreur-poste', message: r.erreur });
	} catch (erreur) {
		envoyer({ type: 'erreur-poste', message: texteErreur(erreur) });
	}
}

async function choisirDossier(): Promise<void> {
	if (api === undefined) return;
	try {
		const r = await api.choisirDossier();
		if (r.ok) envoyer({ type: 'dossier', dossier: r.dossier });
		else if (!r.annule) envoyer({ type: 'erreur-dossier', message: r.erreur });
	} catch (erreur) {
		envoyer({ type: 'erreur-dossier', message: texteErreur(erreur) });
	}
}

async function installer(): Promise<void> {
	// un second clic (ou Entrée répétée) avant le nouvel affichage ne relance rien
	if (api === undefined || etat.etape !== 'choix') return;
	const choix = { ...etat.choix };
	envoyer({ type: 'installer' });
	let resultat;
	try {
		resultat = await api.installer(choix, (ligne) => envoyer({ type: 'ligne', ligne }));
	} catch (erreur) {
		resultat = { fin: null, erreur: texteErreur(erreur) };
	}
	envoyer({ type: 'fin-installation', resultat });
}

async function terminer(): Promise<void> {
	if (api === undefined || ouverture) return;
	ouverture = true;
	erreurFin = null;
	afficher();
	try {
		const r = await api.terminer();
		if (!r.ok) erreurFin = r.erreur;
	} catch (erreur) {
		erreurFin = texteErreur(erreur);
	}
	ouverture = false;
	afficher();
}

const texteErreur = (erreur: unknown): string => (erreur instanceof Error ? erreur.message : String(erreur));

// --- Vues ---

/** Les étapes du fil : sans celle de la langue si la page n'a pas commencé par elle. */
function fil(): HTMLElement[] {
	const etapes = ETAPES_ASSISTANT.filter((e) => e !== 'termine' && (e !== 'langue' || etat.langue !== null));
	const courante = etapes.indexOf(etat.etape as (typeof etapes)[number]);
	return etapes.map((e, i) =>
		el('li', { class: i < courante ? 'passee' : i === courante ? 'courante' : undefined, 'aria-current': i === courante ? 'step' : undefined }, t().assistant.etapes[e]),
	);
}

const erreur = (texte: string | null): HTMLElement | null => (texte === null ? null : el('p', { class: 'erreur', role: 'alert' }, texte));

/** Chaque langue écrite dans sa propre langue (et marquée comme telle pour les lecteurs d'écran). */
function vueLangue(): Enfant[] {
	const a = t().assistant;
	return [
		el('h1', {}, a.langue.titre),
		el('p', { class: 'intro' }, a.langue.intro),
		el(
			'div',
			{ class: 'choix', role: 'radiogroup', 'aria-label': a.etapes.langue },
			...LANGUES.map((langue) => {
				const id = `langue-${langue}`;
				const r = el('input', { type: 'radio', name: 'langue', id, value: langue, checked: etat.langue === langue, 'data-cle': id }) as HTMLInputElement;
				r.addEventListener('change', () => {
					if (r.checked) choisirLangue(langue);
				});
				return el('label', { class: 'case', for: id }, r, el('span', { class: 'texte' }, el('span', { class: 'titre-case', lang: langue }, NOMS_LANGUES[langue])));
			}),
		),
		el('div', { class: 'actions' }, bouton(a.actions.continuer, () => envoyer({ type: 'continuer' }), { primaire: true, desactive: !peutContinuer(etat), cle: 'continuer' })),
	];
}

function lignePoste(nom: string, ok: boolean, detail: string, aide: Enfant): HTMLElement {
	return el('li', { class: ok ? 'verif ok' : 'verif manque' }, el('span', { class: 'puce', 'aria-hidden': 'true' }), el('span', { class: 'nom' }, nom), el('span', { class: 'detail' }, detail), aide !== null && aide !== false ? el('span', { class: 'aide' }, aide) : null);
}

/** macOS : la commande d'Apple, ou le lien ; Windows : le lien vers Git pour Windows seul. */
function aideGit(): HTMLElement {
	const { commande, libelleLien, lien: url } = textesAssistant(plateforme, t()).aideGit;
	const a = t().assistant.verifications.aideGit;
	return commande === null ? lien(libelleLien, url) : el('span', {}, a.avant, el('code', {}, commande), a.entre, lien(libelleLien, url), a.apres);
}

function vuePoste(poste: PosteVerifie): HTMLElement {
	const v = t().assistant.verifications;
	return el(
		'ul',
		{ class: 'verifs' },
		lignePoste('git', poste.git.ok, poste.git.ok ? (poste.git.version ?? '') : (poste.git.motif ?? v.absent), !poste.git.ok && aideGit()),
		lignePoste('Claude Code', poste.claude.ok, poste.claude.ok ? (poste.claude.chemin ?? '') : (poste.claude.motif ?? v.absent), !poste.claude.ok && lien(v.installerClaude, LIENS_EXTERNES.claude)),
		lignePoste('Node', true, poste.node.version, null),
	);
}

/** « Retour » vers la langue, si la page a commencé par elle. */
const retourLangue = (): Enfant => etat.langue !== null && bouton(t().assistant.actions.retour, () => envoyer({ type: 'retour' }), { cle: 'retour' });

function vueVerifications(): Enfant[] {
	const a = t().assistant;
	return [
		el('h1', {}, a.verifications.titre),
		el('p', { class: 'intro' }, textesAssistant(plateforme, t()).intro),
		etat.verification ? el('p', { class: 'attente' }, a.verifications.enCours) : etat.poste !== null ? vuePoste(etat.poste) : null,
		erreur(etat.erreurPoste),
		el(
			'div',
			{ class: 'actions' },
			retourLangue(),
			bouton(a.verifications.reverifier, () => void verifier(), { desactive: etat.verification, cle: 'reverifier' }),
			bouton(a.actions.continuer, () => envoyer({ type: 'continuer' }), { primaire: true, desactive: !peutContinuer(etat), cle: 'continuer' }),
		),
	];
}

function vueDossier(): Enfant[] {
	const a = t().assistant;
	const d = etat.dossier;
	return [
		el('h1', {}, a.dossier.titre),
		el('p', { class: 'intro' }, a.dossier.intro.avant, el('code', {}, '_mnemo/'), a.dossier.intro.apres),
		el(
			'div',
			{ class: 'dossier' },
			d === null ? el('span', { class: 'vide' }, a.dossier.aucun) : el('code', { class: 'chemin' }, d.racine),
			d !== null && el('span', { class: d.memoireExistante ? 'pastille existante' : 'pastille' }, d.memoireExistante ? a.dossier.existante : a.dossier.nouvelle),
			bouton(d === null ? a.dossier.choisir : a.dossier.changer, () => void choisirDossier(), { cle: 'choisir' }),
		),
		erreur(etat.erreurDossier),
		el(
			'div',
			{ class: 'actions' },
			bouton(a.actions.retour, () => envoyer({ type: 'retour' }), { cle: 'retour' }),
			bouton(a.actions.continuer, () => envoyer({ type: 'continuer' }), { primaire: true, desactive: !peutContinuer(etat), cle: 'continuer' }),
		),
	];
}

function vueChoix(): Enfant[] {
	const a = t().assistant;
	return [
		el('h1', {}, a.choix.titre),
		el('p', { class: 'intro' }, a.choix.dossier, el('code', {}, etat.dossier?.racine ?? '')),
		el(
			'div',
			{ class: 'choix' },
			...textesAssistant(plateforme, t()).cases.map(({ cle, titre, detail }) => {
				const id = `choix-${cle}`;
				const c = el('input', { type: 'checkbox', id, checked: etat.choix[cle], 'data-cle': id }) as HTMLInputElement;
				c.addEventListener('change', () => envoyer({ type: 'choix', cle, valeur: c.checked }));
				return el('label', { class: 'case', for: id }, c, el('span', { class: 'texte' }, el('span', { class: 'titre-case' }, titre), el('span', { class: 'detail' }, detail)));
			}),
		),
		el(
			'div',
			{ class: 'actions' },
			bouton(a.actions.retour, () => envoyer({ type: 'retour' }), { cle: 'retour' }),
			bouton(a.choix.installer, () => void installer(), { primaire: true, cle: 'installer' }),
		),
	];
}

const SYMBOLES: Record<EtapeSuivie['etat'], string> = { attente: '', debut: '', fait: '✓', saute: '–', laisse: '–', echec: '✕' };

function vuePiece(p: PieceSuivie): HTMLElement {
	const { formats, assistant } = t();
	const part = fractionPiece(p);
	const barre = el('progress', { max: '1', 'aria-label': p.libelle });
	if (part !== null) (barre as HTMLProgressElement).value = part;
	const taille = p.finie ? formats.taille(p.total ?? p.recu) : p.total === null ? formats.taille(p.recu) : assistant.installation.recu(formats.taille(p.recu), formats.taille(p.total));
	return el('li', { class: 'piece' }, el('span', { class: 'libelle' }, p.libelle), barre, el('span', { class: 'taille' }, taille));
}

function vueEtapes(i: EtatInstallation): HTMLElement {
	const libelles = t().assistant.installation.etapes;
	return el(
		'ul',
		{ class: 'etapes' },
		...i.etapes.map((e) =>
			el(
				'li',
				{ class: `etape ${e.etat}` },
				el('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[e.etat]),
				el('span', { class: 'texte' }, el('span', { class: 'titre-case' }, libelles[e.etape]), e.message !== '' && el('span', { class: 'detail' }, e.message)),
				e.etape === 'modeles' && i.pieces.length > 0 && e.etat !== 'saute' ? el('ul', { class: 'pieces' }, ...i.pieces.map(vuePiece)) : null,
			),
		),
	);
}

function vueInstallation(): Enfant[] {
	const a = t().assistant.installation;
	const i = etat.installation;
	if (i === null) return [];
	return [
		el('h1', {}, i.enCours ? a.enCours : a.interrompue),
		vueEtapes(i),
		erreur(i.erreur),
		peutReessayer(etat) && el('div', { class: 'actions' }, bouton(a.revenir, () => envoyer({ type: 'retour' }), { cle: 'retour' })),
	];
}

function vueTermine(): Enfant[] {
	const a = t().assistant;
	const relance = textesAssistant(plateforme, t()).relance;
	const i = etat.installation;
	const echecs = i?.etapes.filter((e) => e.etat === 'echec') ?? [];
	return [
		el('h1', {}, a.termine.titre),
		el('p', { class: 'intro' }, a.termine.memoire.avant, el('code', {}, etat.dossier?.racine ?? ''), a.termine.memoire.apres),
		i !== null ? vueEtapes(i) : null,
		echecs.length > 0 ? el('p', { class: 'avertissement' }, `${a.termine.echecs(echecs.map((e) => a.installation.etapes[e.etape]).join(', '))}${relance === null ? '' : ` ${relance}`}`) : null,
		erreur(erreurFin),
		el('div', { class: 'actions' }, bouton(ouverture ? a.termine.ouverture : a.termine.ouvrir, () => void terminer(), { primaire: true, desactive: ouverture, cle: 'ouvrir' })),
	];
}

/** App ouverte depuis l'image disque ou une translocation : rien ne s'installe d'ici. */
function vueDeplacer(): Enfant[] {
	const d = t().assistant.deplacer;
	return [el('h1', {}, d.titre), el('p', { class: 'intro' }, d.message)];
}

const VUES: Record<EtapeAssistant, () => Enfant[]> = { langue: vueLangue, verifications: vueVerifications, dossier: vueDossier, choix: vueChoix, installation: vueInstallation, termine: vueTermine };

/** Langue du document, titre de la fenêtre et nom du fil : ceux de la langue choisie. */
function poserLangue(): void {
	const a = t().assistant;
	document.documentElement.lang = etat.langue ?? 'fr';
	document.title = a.titrePage;
	document.getElementById('fil')?.setAttribute('aria-label', a.fil);
}

function afficher(): void {
	const contenu = document.getElementById('contenu');
	const filEtapes = document.getElementById('fil');
	if (contenu === null || filEtapes === null) return;
	poserLangue();
	// le focus survit au nouvel affichage (même élément, par sa clé)
	const cle = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['cle'] : undefined;
	filEtapes.replaceChildren(...(etat.deplacer ? [] : fil()));
	contenu.replaceChildren(etat.deplacer ? el('section', { class: 'etape-deplacer' }, ...vueDeplacer()) : el('section', { class: `etape-${etat.etape}` }, ...VUES[etat.etape]()));
	if (cle !== undefined) contenu.querySelector<HTMLElement>(`[data-cle="${cle}"]`)?.focus();
}

if (api === undefined) {
	document.getElementById('contenu')?.replaceChildren(el('p', { class: 'erreur' }, t().assistant.horsApp));
} else {
	afficher();
	void verifier();
}
