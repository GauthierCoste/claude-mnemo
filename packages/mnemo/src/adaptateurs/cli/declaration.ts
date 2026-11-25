import { fileURLToPath } from 'node:url';
import type { SortieDeclarer } from '@mnemo/contrat';
import type { CommandeMoteur, Executer } from '../../application/ports.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { redeclarerServeurMcp, retirerServeurMcp } from '../../infra/moteurs/claude-code/declaration-mcp.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from './executeur.ts';

const USAGE = `Usage : mnemo declarer (--remplacer | --retirer) [--json]
  --remplacer : remet la déclaration MCP de Mnemo à Claude Code (portée utilisateur) sur ce Node et ce Mnemo, si elle existe
  --retirer   : la retire, si elle lance ce Node et ce Mnemo`;

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/** Ce que lit la commande ; remplaçable (tests : aucun vrai `claude`). */
export type DependancesDeclarer = { executer: Executer; claude: () => CommandeMoteur | null; main: string };

const MESSAGES: Record<Exclude<SortieDeclarer['resultat'], 'echec'>, string> = {
	absent: 'Aucune déclaration MCP « mnemo » : rien à faire.',
	deja: 'Déclaration MCP déjà à jour.',
	remplace: 'Déclaration MCP refaite avec ce Node et ce Mnemo.',
	autre: 'La déclaration MCP « mnemo » ne lance pas ce Mnemo (ou n’est pas de portée utilisateur) : laissée.',
	retire: 'Déclaration MCP retirée.',
};

/**
 * `mnemo declarer` : entretien de la déclaration MCP de Mnemo à Claude Code (la remettre sur ce Node et ce Mnemo,
 * ou la retirer) ; jamais de nouvelle déclaration (c'est `mnemo init --mcp`). `--json` : une ligne `SortieDeclarer`
 * (`@mnemo/contrat`) ; code 1 sur un échec.
 */
export async function commandeDeclarer(args: string[], partiel: Partial<DependancesDeclarer> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const inconnue = args.find((a) => a !== '--json' && a !== '--remplacer' && a !== '--retirer');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const remplacer = args.includes('--remplacer');
	if (remplacer === args.includes('--retirer')) throw new ErreurCli(USAGE, 2);
	const executer = partiel.executer ?? executeurReel();
	const claude = (partiel.claude ?? (() => trouverClaude(process.env, process.platform)))();
	const main = partiel.main ?? MAIN;
	const r = remplacer ? await redeclarerServeurMcp(executer, main, claude) : await retirerServeurMcp(executer, main, claude);
	const sortie: SortieDeclarer = typeof r === 'string' ? { resultat: r, message: MESSAGES[r] } : { resultat: 'echec', message: `Échec : ${r.echec}` };
	ecrire(args.includes('--json') ? JSON.stringify(sortie) : sortie.message);
	if (typeof r !== 'string') process.exitCode = 1;
}
