/**
 * Mode démo : l'écran d'un faux `claude`, `codex`, `vibe` ou `copilot` en séquences ANSI (couleurs des 16 teintes du thème,
 * cadre d'accueil, invite encadrée à la largeur du terminal, indicateur de réflexion), chacun avec ses marques : celles de
 * Claude Code (✻, ⎿, « ? for shortcuts ») jamais sur la session d'un autre moteur. Chargé seulement avec `demo.ts`, jamais
 * dans la construction.
 */
import type { IdMoteur } from '@mnemo/commun';
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

/** Marques du terminal de chaque moteur : puce des réponses et outils, renvoi des résultats, réflexion, aide sous l'invite. */
type Marques = { puce: string; resultat: string; reflexion: string; aide: string; invite: string };
const MARQUES: Record<IdMoteur, Marques> = {
	'claude-code': { puce: '●', resultat: '⎿', reflexion: `${SGR.jaune}✻${SGR.fin} `, aide: `  ${SGR.gris}? for shortcuts${SGR.fin}`, invite: '>' },
	codex: { puce: '•', resultat: '└', reflexion: `${SGR.gris}•${SGR.fin} `, aide: '', invite: '›' },
	'mistral-vibe': { puce: '•', resultat: '└', reflexion: `${SGR.jaune}⠋${SGR.fin} `, aide: `  ${SGR.gris}accept edits${SGR.fin}`, invite: '>' },
	'copilot-cli': { puce: '●', resultat: '└', reflexion: `${SGR.cyan}◉${SGR.fin} `, aide: `  ${SGR.gris}/ commands · ? help${SGR.fin}`, invite: '❯' },
};
/** Moteur d'une session de la démo (absent : Claude Code). */
export type MoteurDemo = IdMoteur;
const marques = (moteur: MoteurDemo = 'claude-code'): Marques => MARQUES[moteur];

function accueil(dossier: string, s?: SessionDemo): string {
	const cwd = dossier ? `${RACINE_DEMO}/projets/${dossier}` : RACINE_DEMO;
	if (s?.moteur === 'codex') {
		// le modèle n'est écrit que s'il est choisi : sinon, celui par défaut de Codex, que la démo ne prétend pas connaître
		const modele = s.modele === undefined || s.modele === '' ? [] : [`   ${SGR.gris}model:     ${s.modele}${SGR.fin}`];
		return cadre([` ${SGR.gras}>_ OpenAI Codex${SGR.fin} ${SGR.gris}(v0.171.0-alpha.13)${SGR.fin}`, '', ...modele, `   ${SGR.gris}directory: ${cwd}${SGR.fin}`], LARGEUR_ACCUEIL, SGR.gris);
	}
	if (s?.moteur === 'mistral-vibe') {
		const modele = s.modele === undefined || s.modele === '' ? [] : [`   ${SGR.gris}${s.modele}${SGR.fin}`];
		return cadre([` ${SGR.gras}Mistral Vibe${SGR.fin} ${SGR.gris}v3.1.5${SGR.fin}`, ...modele, `   ${SGR.gris}Type /help for more information${SGR.fin}`, `   ${SGR.gris}${cwd}${SGR.fin}`], LARGEUR_ACCUEIL, SGR.jaune);
	}
	if (s?.moteur === 'copilot-cli') {
		return cadre([` ${SGR.gras}GitHub Copilot CLI${SGR.fin} ${SGR.gris}1.0.116${SGR.fin}`, '', `   ${SGR.gris}${cwd}${SGR.fin}`], LARGEUR_ACCUEIL, SGR.magenta);
	}
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
export function invite(colonnes: number, moteur?: MoteurDemo): string {
	const largeur = Math.max(LARGEUR_MIN, Math.min(colonnes, LARGEUR_MAX));
	const m = marques(moteur);
	return `${cadre([` ${SGR.gras}${m.invite}${SGR.fin} `], largeur, SGR.gris)}${NL}${m.aide}${CSI}2A\r${CSI}4C`;
}

/**
 * Efface l'invite (le curseur est sur sa ligne du milieu), et l'indicateur de réflexion posé au-dessus s'il y en a un.
 */
export function effacerInvite(avecIndicateur: boolean): string {
	return `${CSI}${avecIndicateur ? 3 : 1}A\r${CSI}J`;
}

/** Indicateur de réflexion du moteur. */
export function indicateur(texte: string, moteur?: MoteurDemo): string {
	const m = marques(moteur);
	return `${m.reflexion}${moteur === undefined || moteur === 'claude-code' ? SGR.jaune : SGR.gras}${texte}…${SGR.fin} ${SGR.gris}(esc to interrupt)${SGR.fin}`;
}

/** Remplace l'indicateur posé au-dessus de l'invite (trois lignes plus haut) sans déplacer le curseur de saisie. */
export function majIndicateur(texte: string, moteur?: MoteurDemo): string {
	return `\x1b7${CSI}3A${EFFACER_LIGNE}${indicateur(texte, moteur)}\x1b8`;
}

export function messageUtilisateur(texte: string, moteur?: MoteurDemo): string {
	return `${SGR.gris}${marques(moteur).invite} ${texte}${SGR.fin}`;
}

export function reponse(texte: string, moteur?: MoteurDemo): string {
	return `${marques(moteur).puce} ${texte}`;
}

export function outil(nom: string, argument: string, resultat: string, moteur?: MoteurDemo): string {
	const m = marques(moteur);
	return `${SGR.vert}${m.puce}${SGR.fin} ${SGR.gras}${nom}${SGR.fin}(${argument})${NL}${SGR.gris}  ${m.resultat}  ${resultat}${SGR.fin}`;
}

function ligne(genre: SessionDemo['ecran'][number][0], texte: string, moteur?: MoteurDemo): string {
	const m = marques(moteur);
	switch (genre) {
		case 'u':
			return messageUtilisateur(texte, moteur);
		case 'm':
			return `${SGR.magenta}◆ ${texte}${SGR.fin}`;
		case 'w':
			// tel que le service l'écrit (`lignesDAvertissement`)
			return `[Mnemo] ${texte}`;
		case 'x':
			return texte;
		case 't': {
			const o = /^● ([\w]+)\((.*)\)$/.exec(texte);
			if (o) return `${SGR.vert}${m.puce}${SGR.fin} ${SGR.gras}${o[1]}${SGR.fin}(${o[2]})`;
			// autres moteurs : « Ran … », « Edited … », « Called … », après leur puce
			return moteur !== undefined && moteur !== 'claude-code' ? `${SGR.vert}${m.puce}${SGR.fin} ${SGR.gras}${texte}${SGR.fin}` : `${SGR.vert}${texte}${SGR.fin}`;
		}
		case 'r':
			return `${SGR.gris}  ${m.resultat}  ${texte}${SGR.fin}`;
		case 'q':
			return `${SGR.jaune}${m.puce}${SGR.fin} ${SGR.gras}${texte}${SGR.fin}`;
		default:
			return reponse(texte, moteur);
	}
}

/**
 * Écran d'une session au premier abonnement : accueil, échanges (un résultat d'outil colle à son outil), indicateur si la
 * session travaille, invite.
 */
export function ecranInitial(s: SessionDemo | undefined, colonnes: number, travaille: boolean): string {
	let corps = `${accueil(s?.dossier ?? '', s)}${NL}${NL}`;
	if (s) {
		s.ecran.forEach(([genre, texte], i) => {
			corps += (i === 0 ? '' : genre === 'r' || genre === 'x' ? NL : `${NL}${NL}`) + ligne(genre, texte, s.moteur);
		});
		corps += `${NL}${NL}`;
	} else corps += `${SGR.gris}  Session lancée depuis l'interface.${SGR.fin}${NL}${NL}`;
	if (travaille) corps += `${indicateur('Travaille', s?.moteur)}${NL}${NL}`;
	// question de l'écran ouverte (confiance du dossier) : pas encore d'invite
	if (s?.attentePremierMessage === true) return corps;
	return corps + invite(colonnes, s?.moteur);
}

/** Retire de la saisie les séquences d'échappement (flèches, Échap seul…) : la démo ne recopie que le texte. */
export function sansSequences(donnees: string): string {
	return donnees.replace(/\x1b(\[[0-9;?]*[ -/]*[@-~]|O.|.)?/gs, '');
}
