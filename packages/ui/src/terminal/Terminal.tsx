/**
 * Terminal d'une session : xterm.js (rendu DOM, sans WebGL) branché au service par `useTerminal`. Seuls ⌘K (et Ctrl+K
 * hors macOS) ne sont pas envoyés à `claude` ; Échap, les touches ⌥ et tout le reste lui vont.
 */
import { FitAddon } from '@xterm/addon-fit';
import { Terminal as XTerm } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';
import { useEffect, useRef, useState, type JSX } from 'react';
import { cx } from '../composants/commun/classes.ts';
import { surChangementAccent } from '../reglages/accent.ts';
import { actionDuRaccourci } from '../raccourcis.ts';
import s from './Terminal.module.css';
import { themeDepuisJetons } from './theme.ts';
import { useTerminal, type Ecran } from './useTerminal.ts';

const POLICE_PX = 12.5;
const POLICE_COMPACTE_PX = 11.5;
const DEFILEMENT_LIGNES = 5000;

type EcranXterm = Ecran & { changerPolice(px: number): void; changerTheme(): void };

function ouvrirLien(e: MouseEvent, uri: string): void {
	if (/^https?:/i.test(uri) && (e.metaKey || e.ctrlKey)) window.open(uri, '_blank', 'noopener,noreferrer');
}

/**
 * Un terminal caché (session repliée dans le rail, ou derrière une session agrandie) voit le navigateur remettre son
 * défilement à zéro : réaffiché, xterm repartirait du haut du tampon. La position est donc retenue tant qu'il est visible
 * (en bas, ou telle ligne) et rendue quand il réapparaît ; ce qui s'est écrit pendant qu'il était caché suit le bas.
 */
function garderLeDefilement(terminal: XTerm, element: HTMLElement): () => void {
	const estVisible = () => element.offsetParent !== null && element.clientHeight > 0;
	let visible = estVisible();
	let enBas = true;
	let ligne = 0;
	const noter = () => {
		// lu à l'instant : un défilement remis à zéro par le masquage arrive parfois avant l'observateur
		if (!visible || !estVisible()) return;
		const tampon = terminal.buffer.active;
		enBas = tampon.viewportY >= tampon.baseY;
		ligne = tampon.viewportY;
	};
	const defile = terminal.onScroll(noter);
	const ecrit = terminal.onWriteParsed(noter);
	const observateur =
		typeof ResizeObserver === 'undefined'
			? null
			: new ResizeObserver(() => {
					const maintenant = estVisible();
					if (maintenant && !visible) {
						visible = true;
						if (enBas) terminal.scrollToBottom();
						else terminal.scrollToLine(ligne);
					} else if (!maintenant) visible = false;
				});
	observateur?.observe(element);
	return () => {
		observateur?.disconnect();
		defile.dispose();
		ecrit.dispose();
	};
}

function creerEcranXterm(element: HTMLElement, taillePolice: number): EcranXterm {
	// Jetons posés sur :root (jetons.css).
	const style = getComputedStyle(element.ownerDocument.documentElement);
	const lire = (nom: string) => style.getPropertyValue(nom).trim();
	const terminal = new XTerm({
		fontFamily: lire('--mono') || 'monospace',
		fontSize: taillePolice,
		scrollback: DEFILEMENT_LIGNES,
		theme: themeDepuisJetons(lire),
		cursorBlink: true,
		// Liens OSC 8 écrits par le programme : http(s) seulement, et seulement sur un clic avec ⌘ ou Ctrl.
		linkHandler: { activate: ouvrirLien, allowNonHttpProtocols: false },
	});
	const ajusteur = new FitAddon();
	terminal.loadAddon(ajusteur);
	terminal.open(element);
	// Faux : xterm ignore la touche, qui remonte jusqu'au gestionnaire de l'application.
	terminal.attachCustomKeyEventHandler((e) => actionDuRaccourci(e, { origine: 'terminal' }) === null);
	const defilement = garderLeDefilement(terminal, element);
	let detruit = false;
	return {
		ecrire: (d, fini) => terminal.write(d, fini),
		reinitialiser: () => terminal.reset(),
		surSaisie(f) {
			const donnees = terminal.onData(f);
			const binaire = terminal.onBinary(f);
			return () => {
				donnees.dispose();
				binaire.dispose();
			};
		},
		dimensions: () => ({ colonnes: terminal.cols, lignes: terminal.rows }),
		ajuster() {
			if (detruit) return null;
			const p = ajusteur.proposeDimensions();
			if (!p || !Number.isFinite(p.cols) || !Number.isFinite(p.rows) || p.cols <= 0 || p.rows <= 0) return null;
			return { colonnes: p.cols, lignes: p.rows };
		},
		redimensionner: (c, l) => terminal.resize(c, l),
		focus: () => terminal.focus(),
		changerPolice(px) {
			if (terminal.options.fontSize !== px) terminal.options.fontSize = px;
		},
		changerTheme() {
			if (!detruit) terminal.options.theme = themeDepuisJetons(lire);
		},
		detruire() {
			if (detruit) return;
			detruit = true;
			defilement();
			terminal.dispose();
		},
	};
}

export function Terminal(p: { session: string; actif: boolean; compact: boolean; surFocus(): void }): JSX.Element {
	const [element, setElement] = useState<HTMLDivElement | null>(null);
	const [ecran, setEcran] = useState<EcranXterm | null>(null);
	const police = p.compact ? POLICE_COMPACTE_PX : POLICE_PX;
	const policeCourante = useRef(police);
	policeCourante.current = police;
	const surFocus = useRef(p.surFocus);
	surFocus.current = p.surFocus;

	// Un xterm par élément monté ; détruit au démontage (StrictMode : créé, détruit, recréé).
	useEffect(() => {
		if (!element) return;
		const e = creerEcranXterm(element, policeCourante.current);
		setEcran(e);
		return () => {
			e.detruire();
			setEcran(null);
		};
	}, [element]);

	useEffect(() => ecran?.changerPolice(police), [ecran, police]);

	// La couleur principale change (Réglages) : le curseur, entre autres, relit ses jetons.
	useEffect(() => {
		if (!ecran) return;
		return surChangementAccent(document.documentElement, () => ecran.changerTheme());
	}, [ecran]);

	useEffect(() => {
		if (!element) return;
		const f = () => surFocus.current();
		element.addEventListener('focusin', f);
		return () => element.removeEventListener('focusin', f);
	}, [element]);

	const { horsLigne } = useTerminal(p.session, ecran, { actif: p.actif, conteneur: element, reajuster: police });

	return (
		<div className={cx(s.terminal, p.compact && s.compact)}>
			<div ref={setElement} className={s.ecran} data-ecran />
			{horsLigne && <span className={s.horsLigne}>Hors ligne</span>}
		</div>
	);
}
