import { fileURLToPath } from 'node:url';
import type { SortieDeclarer } from '@mnemo/contrat';
import type { CommandeMoteur, Executer } from '../../application/ports.ts';
import { estIdMoteur, IDS_MOTEURS, MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from './executeur.ts';

const USAGE = `Usage : mnemo declarer (--remplacer | --retirer) [--moteur <${IDS_MOTEURS.join(' | ')}>] [--json]
  --remplacer : remet la déclaration MCP de Mnemo au moteur (portée utilisateur) sur ce Node et ce Mnemo, si elle existe
  --retirer   : la retire, si elle lance ce Node et ce Mnemo
  --moteur    : ${MOTEUR_PAR_DEFAUT} par défaut`;

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** Ce que lit la commande ; remplaçable (tests : aucun vrai `claude` ni vrai `codex`). */
export type DependancesDeclarer = { executer: Executer; claude: () => CommandeMoteur | null; codex: () => CommandeMoteur | null; main: string; env: Record<string, string | undefined> };

const MESSAGES: Record<Exclude<SortieDeclarer['resultat'], 'echec'>, string> = {
	absent: 'Aucune déclaration MCP « mnemo » : rien à faire.',
	deja: 'Déclaration MCP déjà à jour.',
	remplace: 'Déclaration MCP refaite avec ce Node et ce Mnemo.',
	autre: 'La déclaration MCP « mnemo » ne lance pas ce Mnemo (ou n’est pas de portée utilisateur) : laissée.',
	retire: 'Déclaration MCP retirée.',
};

/** `--moteur <id>` (une fois au plus), le reste des arguments ; erreur d'usage sinon. */
function lireMoteur(args: string[]): { moteur: IdMoteur; reste: string[] } {
	const i = args.indexOf('--moteur');
	if (i === -1) return { moteur: MOTEUR_PAR_DEFAUT, reste: args };
	const id = args[i + 1];
	const reste = [...args.slice(0, i), ...args.slice(i + 2)];
	if (id === undefined || reste.includes('--moteur')) throw new ErreurCli(USAGE, 2);
	if (!estIdMoteur(id)) throw new ErreurCli(`Moteur inconnu : « ${id} » (${IDS_MOTEURS.join(', ')}).\n${USAGE}`, 2);
	return { moteur: id, reste };
}

/**
 * `mnemo declarer` : entretien de la déclaration MCP de Mnemo à un moteur (Claude Code par défaut, ou `--moteur codex`) : la
 * remettre sur ce Node et ce Mnemo, ou la retirer ; jamais de nouvelle déclaration (c'est `mnemo init --mcp` ou `--codex`).
 * `--json` : une ligne `SortieDeclarer` (`@mnemo/contrat`) ; code 1 sur un échec.
 */
export async function commandeDeclarer(args: string[], partiel: Partial<DependancesDeclarer> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const { moteur: id, reste } = lireMoteur(args);
	const inconnue = reste.find((a) => a !== '--json' && a !== '--remplacer' && a !== '--retirer');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const remplacer = reste.includes('--remplacer');
	if (remplacer === reste.includes('--retirer')) throw new ErreurCli(USAGE, 2);
	const moteur = MOTEURS_DU_POSTE[id];
	const trouver = id === 'codex' ? partiel.codex : partiel.claude;
	const appel = {
		executer: partiel.executer ?? executeurReel(),
		main: partiel.main ?? MAIN,
		commande: (trouver ?? (() => moteur.trouver(process.env, process.platform)))(),
		plateforme: process.platform,
		env: partiel.env ?? process.env,
	};
	const r = remplacer ? await moteur.declarationMcp.remplacer(appel) : await moteur.declarationMcp.retirer(appel);
	const prefixe = id === MOTEUR_PAR_DEFAUT ? '' : `${moteur.nom} : `;
	const sortie: SortieDeclarer = typeof r === 'string' ? { resultat: r, message: `${prefixe}${MESSAGES[r]}` } : { resultat: 'echec', message: `${prefixe}Échec : ${r.echec}` };
	ecrire(reste.includes('--json') ? JSON.stringify(sortie) : sortie.message);
	if (typeof r !== 'string') process.exitCode = 1;
}
