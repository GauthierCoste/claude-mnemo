import { estLangue, LANGUES, type Langue } from '@mnemo/commun';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEURS_FACULTATIFS } from './moteurs-facultatifs.ts';
import { ErreurCli } from './erreurs.ts';

export const USAGE_INIT = `Usage : mnemo init [dossier] [--oui] [--json] [--mcp | --sans-mcp] ${MOTEURS_FACULTATIFS.map((m) => `[${m.optionInit}]`).join(' ')} [--modeles | --sans-modeles]
                  [--commande | --sans-commande] [--lanceur | --sans-lanceur] [--langue ${LANGUES.join('|')}]`;

/** Une étape hors mémoire : `true` ou `false` si l'option est donnée (elle l'emporte sur le défaut et sur la question), sinon null. */
export type ChoixExplicite = boolean | null;

export type OptionsLuesInit = {
	dossier: string | undefined;
	oui: boolean;
	json: boolean;
	mcp: ChoixExplicite;
	/** Moteurs facultatifs où déclarer aussi le serveur MCP et installer les hooks de Mnemo (`--codex`, `--mistral` ; jamais sans). */
	moteurs: IdMoteur[];
	modeles: ChoixExplicite;
	commande: ChoixExplicite;
	lanceur: ChoixExplicite;
	/** `--langue <fr|en>` : la langue de l'interface (`interface.langue`) à écrire dans les réglages du dossier ; absente sans l'option. */
	langue?: Langue;
};

const PAIRES = [
	['mcp', '--mcp', '--sans-mcp'],
	['modeles', '--modeles', '--sans-modeles'],
	['commande', '--commande', '--sans-commande'],
	['lanceur', '--lanceur', '--sans-lanceur'],
] as const;

/**
 * `--langue <valeur>` retiré des arguments (sa valeur ne compte pas comme dossier) ; valeur manquante ou inconnue, option
 * répétée : erreur d'usage (code 2).
 */
function extraireLangue(args: string[]): { reste: string[]; langue: Langue | undefined } {
	const i = args.indexOf('--langue');
	if (i === -1) return { reste: args, langue: undefined };
	const valeur = args[i + 1];
	if (valeur === undefined || valeur.startsWith('-')) throw new ErreurCli(`Option « --langue » : valeur attendue (${LANGUES.join(' ou ')}).\n${USAGE_INIT}`, 2);
	if (!estLangue(valeur)) throw new ErreurCli(`Option « --langue » : langue inconnue « ${valeur} » (${LANGUES.join(' ou ')}).\n${USAGE_INIT}`, 2);
	const reste = [...args.slice(0, i), ...args.slice(i + 2)];
	if (reste.includes('--langue')) throw new ErreurCli(`Option « --langue » donnée deux fois.\n${USAGE_INIT}`, 2);
	return { reste, langue: valeur };
}

/** Arguments de `mnemo init` ; option inconnue, deux dossiers ou options contradictoires : erreur d'usage (code 2). */
export function lireOptionsInit(tous: string[]): OptionsLuesInit {
	const { reste: args, langue } = extraireLangue(tous);
	const connues = new Set<string>(['--oui', '--json', ...MOTEURS_FACULTATIFS.map((m) => m.optionInit), ...PAIRES.flatMap(([, avec, sans]) => [avec, sans])]);
	const inconnue = args.find((a) => a.startsWith('-') && !connues.has(a));
	if (inconnue !== undefined) throw new ErreurCli(`Option inconnue : « ${inconnue} ».\n${USAGE_INIT}`, 2);
	const positionnels = args.filter((a) => !a.startsWith('-'));
	if (positionnels.length > 1) throw new ErreurCli(USAGE_INIT, 2);
	const lues: OptionsLuesInit = {
		dossier: positionnels[0],
		oui: args.includes('--oui'),
		json: args.includes('--json'),
		mcp: null,
		moteurs: MOTEURS_FACULTATIFS.filter((m) => args.includes(m.optionInit)).map((m) => m.id),
		modeles: null,
		commande: null,
		lanceur: null,
		...(langue === undefined ? {} : { langue }),
	};
	for (const [cle, avec, sans] of PAIRES) {
		const oui = args.includes(avec);
		const non = args.includes(sans);
		if (oui && non) throw new ErreurCli(`Options contradictoires : « ${avec} » et « ${sans} ».\n${USAGE_INIT}`, 2);
		lues[cle] = oui ? true : non ? false : null;
	}
	return lues;
}
