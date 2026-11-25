import { NOMS_MOTEURS } from '@mnemo/commun';
import { fileURLToPath } from 'node:url';
import type { SortieDeclarer } from '@mnemo/contrat';
import { basename } from 'node:path';
import type { CommandeMoteur, Executer, HooksDuPoste, MoteurDuPoste } from '../../application/ports.ts';
import { estIdMoteur, IDS_MOTEURS, MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from '../../infra/executeur.ts';

const USAGE = `Usage : mnemo declarer (--remplacer | --retirer) [--moteur <${IDS_MOTEURS.join(' | ')}>] [--json]
  --remplacer : remet la déclaration MCP de Mnemo au moteur (portée utilisateur) sur ce Node et ce Mnemo, si elle existe
                (Codex, Mistral Vibe : de même pour les hooks de Mnemo de ~/.codex/hooks.json, ~/.vibe/hooks.toml)
  --retirer   : la retire, si elle lance ce Node et ce Mnemo (Codex, Mistral Vibe : les hooks aussi)
  --moteur    : ${MOTEUR_PAR_DEFAUT} par défaut`;

const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/**
 * Ce que lit la commande ; remplaçable (tests : aucun vrai moteur). `trouver` : la commande d'un moteur (par défaut, celle que
 * son `trouver` cherche).
 */
export type DependancesDeclarer = {
	executer: Executer;
	trouver: Partial<Record<IdMoteur, () => CommandeMoteur | null>>;
	main: string;
	env: Record<string, string | undefined>;
};

const MESSAGES: Record<Exclude<SortieDeclarer['resultat'], 'echec'>, string> = {
	absent: 'Aucune déclaration MCP « mnemo » : rien à faire.',
	deja: 'Déclaration MCP déjà à jour.',
	remplace: 'Déclaration MCP refaite avec ce Node et ce Mnemo.',
	autre: 'La déclaration MCP « mnemo » ne lance pas ce Mnemo (ou n’est pas de portée utilisateur) : laissée.',
	retire: 'Déclaration MCP retirée.',
};

/** Messages des hooks de Mnemo installés pour tout le poste chez ce moteur (`fichier` : leur fichier). */
function messagesHooks(moteur: MoteurDuPoste, fichier: string): Record<'absent' | 'deja' | 'remplace' | 'autre' | 'retire', string> {
	const { approbation } = moteur.installation;
	const approuver = approbation === null ? '' : ` ; approuvez-les de nouveau dans ${NOMS_MOTEURS[moteur.id]} (${approbation.commande})`;
	return {
		absent: `Aucun hook de Mnemo dans ${fichier} : rien à faire.`,
		deja: 'Hooks de Mnemo déjà à jour.',
		remplace: `Hooks de Mnemo refaits avec ce Node et ce Mnemo${approuver}.`,
		autre: `Aucun hook de ce Mnemo dans ${fichier} ; ceux d’une autre installation de Mnemo (autre Node ou autre Mnemo) sont laissés.`,
		retire: `Hooks de Mnemo retirés de ${fichier}.`,
	};
}

/** Les hooks de Mnemo installés pour tout le poste (Codex, Mistral Vibe) : remis à jour ou retirés, comme la déclaration MCP. */
async function entretenirHooks(moteur: MoteurDuPoste, hooks: HooksDuPoste, remplacer: boolean, appel: { node: string; main: string; env: Record<string, string | undefined> }): Promise<NonNullable<SortieDeclarer['hooks']>> {
	const r = remplacer ? await hooks.remplacer(appel) : await hooks.retirer(appel);
	if (typeof r !== 'string') return { resultat: 'echec', message: `Échec des hooks : ${r.echec}` };
	const resultat = r === 'mis_a_jour' ? 'remplace' : r;
	return { resultat, message: messagesHooks(moteur, basename(hooks.chemin(appel.env)))[resultat] };
}

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
 * `mnemo declarer` : entretien de la déclaration MCP de Mnemo à un moteur (Claude Code par défaut, ou `--moteur <id>`) : la
 * remettre sur ce Node et ce Mnemo, ou la retirer ; jamais de nouvelle déclaration (c'est `mnemo init --mcp`, `--codex`
 * ou `--mistral`). Codex et Mistral Vibe : leurs hooks de Mnemo pour tout le poste suivent, une ligne de plus en texte, `hooks`
 * en JSON.
 * `--json` : une ligne `SortieDeclarer` (`@mnemo/contrat`) ; code 1 sur un échec.
 */
export async function commandeDeclarer(args: string[], partiel: Partial<DependancesDeclarer> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const { moteur: id, reste } = lireMoteur(args);
	const inconnue = reste.find((a) => a !== '--json' && a !== '--remplacer' && a !== '--retirer');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const remplacer = reste.includes('--remplacer');
	if (remplacer === reste.includes('--retirer')) throw new ErreurCli(USAGE, 2);
	const moteur = MOTEURS_DU_POSTE[id];
	const trouver = partiel.trouver?.[id] ?? (() => moteur.trouver(process.env, process.platform));
	const appel = {
		executer: partiel.executer ?? executeurReel(),
		main: partiel.main ?? MAIN,
		commande: trouver(),
		plateforme: process.platform,
		env: partiel.env ?? process.env,
	};
	const r = remplacer ? await moteur.declarationMcp.remplacer(appel) : await moteur.declarationMcp.retirer(appel);
	const prefixe = id === MOTEUR_PAR_DEFAUT ? '' : `${NOMS_MOTEURS[moteur.id]} : `;
	const sortie: SortieDeclarer = typeof r === 'string' ? { resultat: r, message: `${prefixe}${MESSAGES[r]}` } : { resultat: 'echec', message: `${prefixe}Échec : ${r.echec}` };
	if (moteur.hooksDuPoste !== undefined) {
		const hooks = await entretenirHooks(moteur, moteur.hooksDuPoste, remplacer, { node: nodeDurable(process.platform), main: appel.main, env: appel.env });
		sortie.hooks = { resultat: hooks.resultat, message: `${prefixe}${hooks.message}` };
	}
	if (reste.includes('--json')) ecrire(JSON.stringify(sortie));
	else {
		ecrire(sortie.message);
		if (sortie.hooks !== undefined) ecrire(sortie.hooks.message);
	}
	if (sortie.resultat === 'echec' || sortie.hooks?.resultat === 'echec') process.exitCode = 1;
}
