import { ErreurCli } from './erreurs.ts';

export const USAGE_INIT = `Usage : mnemo init [dossier] [--oui] [--json] [--mcp | --sans-mcp] [--modeles | --sans-modeles]
                  [--commande | --sans-commande] [--lanceur | --sans-lanceur]`;

/** Une étape hors mémoire : `true` ou `false` si l'option est donnée (elle l'emporte sur le défaut et sur la question), sinon null. */
export type ChoixExplicite = boolean | null;

export type OptionsLuesInit = {
	dossier: string | undefined;
	oui: boolean;
	json: boolean;
	mcp: ChoixExplicite;
	modeles: ChoixExplicite;
	commande: ChoixExplicite;
	lanceur: ChoixExplicite;
};

const PAIRES = [
	['mcp', '--mcp', '--sans-mcp'],
	['modeles', '--modeles', '--sans-modeles'],
	['commande', '--commande', '--sans-commande'],
	['lanceur', '--lanceur', '--sans-lanceur'],
] as const;

/** Arguments de `mnemo init` ; option inconnue, deux dossiers ou options contradictoires : erreur d'usage (code 2). */
export function lireOptionsInit(args: string[]): OptionsLuesInit {
	const connues = new Set<string>(['--oui', '--json', ...PAIRES.flatMap(([, avec, sans]) => [avec, sans])]);
	const inconnue = args.find((a) => a.startsWith('-') && !connues.has(a));
	if (inconnue !== undefined) throw new ErreurCli(`Option inconnue : « ${inconnue} ».\n${USAGE_INIT}`, 2);
	const positionnels = args.filter((a) => !a.startsWith('-'));
	if (positionnels.length > 1) throw new ErreurCli(USAGE_INIT, 2);
	const lues: OptionsLuesInit = {
		dossier: positionnels[0],
		oui: args.includes('--oui'),
		json: args.includes('--json'),
		mcp: null,
		modeles: null,
		commande: null,
		lanceur: null,
	};
	for (const [cle, avec, sans] of PAIRES) {
		const oui = args.includes(avec);
		const non = args.includes(sans);
		if (oui && non) throw new ErreurCli(`Options contradictoires : « ${avec} » et « ${sans} ».\n${USAGE_INIT}`, 2);
		lues[cle] = oui ? true : non ? false : null;
	}
	return lues;
}
