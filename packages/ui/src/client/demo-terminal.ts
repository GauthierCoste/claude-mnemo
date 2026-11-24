/**
 * Mode démo : l'écran d'un faux `claude` en séquences ANSI (couleurs des 16 teintes du thème, cadre d'accueil, invite
 * encadrée à la largeur du terminal, indicateur de réflexion). Chargé seulement avec `demo.ts`, jamais dans la construction.
 */
import { RACINE_DEMO, type SessionDemo } from './demo-donnees.ts';

const CSI = '\x1b[';
const SGR = {
	gras: `${CSI}1m`,
	gris: `${CSI}90m`,
	rouge: `${CSI}31m`,
	vert: `${CSI}32m`,
	jaune: `${CSI}33m`,
	magenta: `${CSI}35m`,
	cyan: `${CSI}36m`,
	fin: `${CSI}0m`,
};
export const NL = '\r\n';
/** Efface la ligne courante, curseur en colonne 1. */
export const EFFACER_LIGNE = `\r${CSI}2K`;
const LARGEUR_ACCUEIL = 58;
const LARGEUR_MIN = 24;
const LARGEUR_MAX = 240;

const visible = (texte: string) => [...texte.replace(/\x1b\[[0-9;]*m/g, '')].length;

function cadre(lignes: string[], largeur: number, couleur: string): string {
	const interieur = largeur - 2;
	const haut = `${couleur}╭${'─'.repeat(interieur)}╮${SGR.fin}`;
	const bas = `${couleur}╰${'─'.repeat(interieur)}╯${SGR.fin}`;
	const milieu = lignes.map((l) => `${couleur}│${SGR.fin}${l}${' '.repeat(Math.max(0, interieur - visible(l)))}${couleur}│${SGR.fin}`);
	return [haut, ...milieu, bas].join(NL);
}

function accueil(dossier: string): string {
	const cwd = dossier ? `${RACINE_DEMO}/projets/${dossier}` : RACINE_DEMO;
	return cadre(
		[
			` ${SGR.jaune}✻${SGR.fin} ${SGR.gras}Welcome to Claude Code!${SGR.fin}`,
			'',
			`   ${SGR.gris}/help for help, /status for your current setup${SGR.fin}`,
			'',
			`   ${SGR.gris}cwd: ${cwd}${SGR.fin}`,
		],
		LARGEUR_ACCUEIL,
		SGR.jaune,
	);
}

/** Invite encadrée sur toute la largeur, aide dessous ; le curseur revient dans le cadre, après « > ». */
export function invite(colonnes: number): string {
	const largeur = Math.max(LARGEUR_MIN, Math.min(colonnes, LARGEUR_MAX));
	return `${cadre([` ${SGR.gras}>${SGR.fin} `], largeur, SGR.gris)}${NL}  ${SGR.gris}? for shortcuts${SGR.fin}${CSI}2A\r${CSI}4C`;
}

/**
 * Efface l'invite (le curseur est sur sa ligne du milieu), et l'indicateur de réflexion posé au-dessus s'il y en a un.
 */
export function effacerInvite(avecIndicateur: boolean): string {
	return `${CSI}${avecIndicateur ? 3 : 1}A\r${CSI}J`;
}

/** Indicateur de réflexion de `claude`. */
export function indicateur(texte: string): string {
	return `${SGR.jaune}✻${SGR.fin} ${SGR.jaune}${texte}…${SGR.fin} ${SGR.gris}(esc to interrupt)${SGR.fin}`;
}

/** Remplace l'indicateur posé au-dessus de l'invite (trois lignes plus haut) sans déplacer le curseur de saisie. */
export function majIndicateur(texte: string): string {
	return `\x1b7${CSI}3A${EFFACER_LIGNE}${indicateur(texte)}\x1b8`;
}

export function messageUtilisateur(texte: string): string {
	return `${SGR.gris}> ${texte}${SGR.fin}`;
}

export function reponse(texte: string): string {
	return `● ${texte}`;
}

export function outil(nom: string, argument: string, resultat: string): string {
	return `${SGR.vert}●${SGR.fin} ${SGR.gras}${nom}${SGR.fin}(${argument})${NL}${SGR.gris}  ⎿  ${resultat}${SGR.fin}`;
}

function ligne(genre: SessionDemo['ecran'][number][0], texte: string): string {
	switch (genre) {
		case 'u':
			return messageUtilisateur(texte);
		case 'm':
			return `${SGR.magenta}◆ ${texte}${SGR.fin}`;
		case 't': {
			const m = /^● ([\w]+)\((.*)\)$/.exec(texte);
			return m ? `${SGR.vert}●${SGR.fin} ${SGR.gras}${m[1]}${SGR.fin}(${m[2]})` : `${SGR.vert}${texte}${SGR.fin}`;
		}
		case 'r':
			return `${SGR.gris}  ⎿  ${texte}${SGR.fin}`;
		case 'q':
			return `${SGR.jaune}●${SGR.fin} ${SGR.gras}${texte}${SGR.fin}`;
		default:
			return reponse(texte);
	}
}

/**
 * Écran d'une session au premier abonnement : accueil, échanges (un résultat d'outil colle à son outil), indicateur si la
 * session travaille, invite.
 */
export function ecranInitial(s: SessionDemo | undefined, colonnes: number, travaille: boolean): string {
	let corps = `${accueil(s?.dossier ?? '')}${NL}${NL}`;
	if (s) {
		s.ecran.forEach(([genre, texte], i) => {
			corps += (i === 0 ? '' : genre === 'r' ? NL : `${NL}${NL}`) + ligne(genre, texte);
		});
		corps += `${NL}${NL}`;
	} else corps += `${SGR.gris}  Session lancée depuis l'interface.${SGR.fin}${NL}${NL}`;
	if (travaille) corps += `${indicateur('Travaille')}${NL}${NL}`;
	return corps + invite(colonnes);
}

/** Retire de la saisie les séquences d'échappement (flèches, Échap seul…) : la démo ne recopie que le texte. */
export function sansSequences(donnees: string): string {
	return donnees.replace(/\x1b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/gs, '');
}
