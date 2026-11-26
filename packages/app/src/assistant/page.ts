/**
 * Page de l'assistant d'installation : affiche l'état du domaine (`evoluer`, `domaine/assistant.ts`) et parle au processus
 * principal par `window.assistant` (le preload), rien d'autre. Aucun HTML assemblé en texte : les éléments sont créés un à
 * un, le texte venu d'ailleurs posé en `textContent`.
 */
import './assistant.css';
import { tailleLisible } from '@mnemo/commun';
import type { PosteVerifie } from '@mnemo/contrat';
import { MESSAGE_PROVISOIRE } from '../domaine/assistant-demarrage.ts';
import { ETAPES_ASSISTANT, etatInitial, evoluer, peutContinuer, peutReessayer, type EtapeAssistant, type EtatAssistant, type EvenementAssistant } from '../domaine/assistant.ts';
import { fractionPiece, LIBELLES_ETAPES, type EtapeSuivie, type EtatInstallation, type PieceSuivie } from '../domaine/assistant-lignes.ts';
import { LIENS_EXTERNES, type ApiAssistant } from '../domaine/assistant-pont.ts';
import { textesAssistant } from '../domaine/assistant-textes.ts';

declare global {
	interface Window {
		assistant?: ApiAssistant;
	}
}

const NOMS_ETAPES: Record<EtapeAssistant, string> = { verifications: 'Vérifications', dossier: 'Dossier', choix: 'Choix', installation: 'Installation', termine: 'Prêt' };

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
const textes = textesAssistant(plateforme);
// barre de titre : les boutons de Windows sont à droite (`assistant.css`)
if (plateforme === 'win32') document.documentElement.dataset['plateforme'] = 'windows';
let etat: EtatAssistant = etatInitial(plateforme);
/** `terminer` est en cours (configuration, ouverture de l'interface) ; `erreurFin` : ce qui l'a empêché. */
let ouverture = false;
let erreurFin: string | null = null;

function envoyer(e: EvenementAssistant): void {
	etat = evoluer(etat, e);
	afficher();
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

function fil(): HTMLElement[] {
	const courante = ETAPES_ASSISTANT.indexOf(etat.etape);
	return ETAPES_ASSISTANT.filter((e) => e !== 'termine').map((e, i) =>
		el('li', { class: i < courante ? 'passee' : i === courante ? 'courante' : undefined, 'aria-current': i === courante ? 'step' : undefined }, NOMS_ETAPES[e]),
	);
}

const erreur = (texte: string | null): HTMLElement | null => (texte === null ? null : el('p', { class: 'erreur', role: 'alert' }, texte));

function lignePoste(nom: string, ok: boolean, detail: string, aide: Enfant): HTMLElement {
	return el('li', { class: ok ? 'verif ok' : 'verif manque' }, el('span', { class: 'puce', 'aria-hidden': 'true' }), el('span', { class: 'nom' }, nom), el('span', { class: 'detail' }, detail), aide !== null && aide !== false ? el('span', { class: 'aide' }, aide) : null);
}

/** macOS : la commande d'Apple, ou le lien ; Windows : le lien vers Git pour Windows seul. */
function aideGit(): HTMLElement {
	const { commande, libelleLien, lien: url } = textes.aideGit;
	return commande === null ? lien(libelleLien, url) : el('span', {}, 'Dans un terminal : ', el('code', {}, commande), ' ; ou ', lien(libelleLien, url), '.');
}

function vuePoste(poste: PosteVerifie): HTMLElement {
	return el(
		'ul',
		{ class: 'verifs' },
		lignePoste('git', poste.git.ok, poste.git.ok ? (poste.git.version ?? '') : (poste.git.motif ?? 'absent'), !poste.git.ok && aideGit()),
		lignePoste('Claude Code', poste.claude.ok, poste.claude.ok ? (poste.claude.chemin ?? '') : (poste.claude.motif ?? 'absent'), !poste.claude.ok && lien('Installer Claude Code', LIENS_EXTERNES.claude)),
		lignePoste('Node', true, poste.node.version, null),
	);
}

function vueVerifications(): Enfant[] {
	return [
		el('h1', {}, 'Bienvenue dans Mnemo'),
		el('p', { class: 'intro' }, textes.intro),
		etat.verification ? el('p', { class: 'attente' }, 'Vérification…') : etat.poste !== null ? vuePoste(etat.poste) : null,
		erreur(etat.erreurPoste),
		el(
			'div',
			{ class: 'actions' },
			bouton('Vérifier à nouveau', () => void verifier(), { desactive: etat.verification, cle: 'reverifier' }),
			bouton('Continuer', () => envoyer({ type: 'continuer' }), { primaire: true, desactive: !peutContinuer(etat), cle: 'continuer' }),
		),
	];
}

function vueDossier(): Enfant[] {
	const d = etat.dossier;
	return [
		el('h1', {}, 'Où ranger la mémoire ?'),
		el('p', { class: 'intro' }, 'Choisis le dossier qui contient tes projets : Mnemo y crée sa mémoire, dans ', el('code', {}, '_mnemo/'), '. Un dossier qui a déjà une mémoire Mnemo est repris tel quel.'),
		el(
			'div',
			{ class: 'dossier' },
			d === null ? el('span', { class: 'vide' }, 'Aucun dossier choisi.') : el('code', { class: 'chemin' }, d.racine),
			d !== null && el('span', { class: d.memoireExistante ? 'pastille existante' : 'pastille' }, d.memoireExistante ? 'Mémoire existante, reprise telle quelle' : 'Nouvelle mémoire'),
			bouton(d === null ? 'Choisir un dossier…' : 'Changer…', () => void choisirDossier(), { cle: 'choisir' }),
		),
		erreur(etat.erreurDossier),
		el(
			'div',
			{ class: 'actions' },
			bouton('Retour', () => envoyer({ type: 'retour' }), { cle: 'retour' }),
			bouton('Continuer', () => envoyer({ type: 'continuer' }), { primaire: true, desactive: !peutContinuer(etat), cle: 'continuer' }),
		),
	];
}

function vueChoix(): Enfant[] {
	return [
		el('h1', {}, 'Que faut-il installer ?'),
		el('p', { class: 'intro' }, 'Dossier : ', el('code', {}, etat.dossier?.racine ?? '')),
		el(
			'div',
			{ class: 'choix' },
			...textes.cases.map(({ cle, titre, detail }) => {
				const id = `choix-${cle}`;
				const c = el('input', { type: 'checkbox', id, checked: etat.choix[cle], 'data-cle': id }) as HTMLInputElement;
				c.addEventListener('change', () => envoyer({ type: 'choix', cle, valeur: c.checked }));
				return el('label', { class: 'case', for: id }, c, el('span', { class: 'texte' }, el('span', { class: 'titre-case' }, titre), el('span', { class: 'detail' }, detail)));
			}),
		),
		el(
			'div',
			{ class: 'actions' },
			bouton('Retour', () => envoyer({ type: 'retour' }), { cle: 'retour' }),
			bouton('Installer', () => void installer(), { primaire: true, cle: 'installer' }),
		),
	];
}

const SYMBOLES: Record<EtapeSuivie['etat'], string> = { attente: '', debut: '', fait: '✓', saute: '–', laisse: '–', echec: '✕' };

function vuePiece(p: PieceSuivie): HTMLElement {
	const part = fractionPiece(p);
	const barre = el('progress', { max: '1', 'aria-label': p.libelle });
	if (part !== null) (barre as HTMLProgressElement).value = part;
	const taille = p.finie ? (p.total === null ? tailleLisible(p.recu) : tailleLisible(p.total)) : `${tailleLisible(p.recu)}${p.total === null ? '' : ` sur ${tailleLisible(p.total)}`}`;
	return el('li', { class: 'piece' }, el('span', { class: 'libelle' }, p.libelle), barre, el('span', { class: 'taille' }, taille));
}

function vueEtapes(i: EtatInstallation): HTMLElement {
	return el(
		'ul',
		{ class: 'etapes' },
		...i.etapes.map((e) =>
			el(
				'li',
				{ class: `etape ${e.etat}` },
				el('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[e.etat]),
				el('span', { class: 'texte' }, el('span', { class: 'titre-case' }, LIBELLES_ETAPES[e.etape]), e.message !== '' && el('span', { class: 'detail' }, e.message)),
				e.etape === 'modeles' && i.pieces.length > 0 && e.etat !== 'saute' ? el('ul', { class: 'pieces' }, ...i.pieces.map(vuePiece)) : null,
			),
		),
	);
}

function vueInstallation(): Enfant[] {
	const i = etat.installation;
	if (i === null) return [];
	return [
		el('h1', {}, i.enCours ? 'Installation…' : 'Installation interrompue'),
		vueEtapes(i),
		erreur(i.erreur),
		peutReessayer(etat) && el('div', { class: 'actions' }, bouton('Revenir aux choix', () => envoyer({ type: 'retour' }), { cle: 'retour' })),
	];
}

function vueTermine(): Enfant[] {
	const i = etat.installation;
	const echecs = i?.etapes.filter((e) => e.etat === 'echec') ?? [];
	return [
		el('h1', {}, 'Mnemo est prêt'),
		el('p', { class: 'intro' }, 'La mémoire est dans ', el('code', {}, etat.dossier?.racine ?? ''), '.'),
		i !== null ? vueEtapes(i) : null,
		echecs.length > 0 ? el('p', { class: 'avertissement' }, `${echecs.map((e) => LIBELLES_ETAPES[e.etape]).join(', ')} : échec. Tu pourras le refaire plus tard (mnemo init, dans ce dossier).`) : null,
		erreur(erreurFin),
		el('div', { class: 'actions' }, bouton(ouverture ? 'Ouverture…' : 'Ouvrir Mnemo', () => void terminer(), { primaire: true, desactive: ouverture, cle: 'ouvrir' })),
	];
}

/** App ouverte depuis l'image disque ou une translocation : rien ne s'installe d'ici. */
function vueDeplacer(): Enfant[] {
	return [el('h1', {}, 'Glisse Mnemo dans Applications'), el('p', { class: 'intro' }, MESSAGE_PROVISOIRE)];
}

const VUES: Record<EtapeAssistant, () => Enfant[]> = { verifications: vueVerifications, dossier: vueDossier, choix: vueChoix, installation: vueInstallation, termine: vueTermine };

function afficher(): void {
	const contenu = document.getElementById('contenu');
	const filEtapes = document.getElementById('fil');
	if (contenu === null || filEtapes === null) return;
	// le focus survit au nouvel affichage (même élément, par sa clé)
	const cle = document.activeElement instanceof HTMLElement ? document.activeElement.dataset['cle'] : undefined;
	filEtapes.replaceChildren(...(etat.deplacer ? [] : fil()));
	contenu.replaceChildren(etat.deplacer ? el('section', { class: 'etape-deplacer' }, ...vueDeplacer()) : el('section', { class: `etape-${etat.etape}` }, ...VUES[etat.etape]()));
	if (cle !== undefined) contenu.querySelector<HTMLElement>(`[data-cle="${cle}"]`)?.focus();
}

if (api === undefined) {
	document.getElementById('contenu')?.replaceChildren(el('p', { class: 'erreur' }, 'Cette page ne s’ouvre que dans l’app Mnemo.'));
} else {
	afficher();
	void verifier();
}
