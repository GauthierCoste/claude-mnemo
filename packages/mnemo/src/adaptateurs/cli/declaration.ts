import { NOMS_MOTEURS } from '@mnemo/commun';
import { fileURLToPath } from 'node:url';
import type { SortieDeclarer, SortieDeclarerLier } from '@mnemo/contrat';
import { basename } from 'node:path';
import type { CommandeMoteur, Executer, HooksDuPoste, MoteurDuPoste } from '../../application/ports.ts';
import { lierMoteur, moteurLie } from '../../application/moteurs/lier.ts';
import { messageHooksMoteur } from '../../application/moteurs/messages-liaison.ts';
import { estIdMoteur, IDS_MOTEURS, MOTEUR_PAR_DEFAUT } from '../../domaine/moteurs/moteur.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from '../../infra/executeur.ts';

export const USAGE_DECLARER = `Usage : mnemo declarer (--lier | --remplacer | --retirer) [--moteur <${IDS_MOTEURS.join(' | ')}>] [--json]
  --lier      : lie le moteur à Mnemo, sans question et où qu'on la lance : serveur MCP déclaré (portée utilisateur) s'il
                manque, refait s'il a été déclaré pour un autre Node ou un autre Mnemo ; hooks de Mnemo du poste (Codex,
                Mistral Vibe) installés ou refaits ; une déclaration de l'utilisateur est laissée telle quelle
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

/**
 * Messages des hooks de Mnemo installés pour tout le poste chez ce moteur (`fichier` : leur fichier) ; `deja` et `remplace`
 * : ceux de la liaison (`messageHooksMoteur`), qui nomment le moteur et disent où les approuver.
 */
function messagesHooks(moteur: MoteurDuPoste, fichier: string, prefixe: string): Record<'absent' | 'deja' | 'remplace' | 'autre' | 'retire', string> {
	return {
		absent: `${prefixe}Aucun hook de Mnemo dans ${fichier} : rien à faire.`,
		deja: messageHooksMoteur(moteur, 'deja', fichier),
		remplace: messageHooksMoteur(moteur, 'remplace', fichier),
		autre: `${prefixe}Aucun hook de ce Mnemo dans ${fichier} ; ceux d’une autre installation de Mnemo (autre Node ou autre Mnemo) sont laissés.`,
		retire: `${prefixe}Hooks de Mnemo retirés de ${fichier}.`,
	};
}

/** Les hooks de Mnemo installés pour tout le poste (Codex, Mistral Vibe) : remis à jour ou retirés, comme la déclaration MCP. */
async function entretenirHooks(moteur: MoteurDuPoste, hooks: HooksDuPoste, remplacer: boolean, appel: { node: string; main: string; env: Record<string, string | undefined> }, prefixe: string): Promise<NonNullable<SortieDeclarer['hooks']>> {
	const r = remplacer ? await hooks.remplacer(appel) : await hooks.retirer(appel);
	if (typeof r !== 'string') return { resultat: 'echec', message: `${prefixe}Échec des hooks : ${r.echec}` };
	const resultat = r === 'mis_a_jour' ? 'remplace' : r;
	return { resultat, message: messagesHooks(moteur, basename(hooks.chemin(appel.env)), prefixe)[resultat] };
}

/** `--moteur <id>` (une fois au plus), le reste des arguments ; erreur d'usage sinon. */
function lireMoteur(args: string[]): { moteur: IdMoteur; reste: string[] } {
	const i = args.indexOf('--moteur');
	if (i === -1) return { moteur: MOTEUR_PAR_DEFAUT, reste: args };
	const id = args[i + 1];
	const reste = [...args.slice(0, i), ...args.slice(i + 2)];
	if (id === undefined || reste.includes('--moteur')) throw new ErreurCli(USAGE_DECLARER, 2);
	if (!estIdMoteur(id)) throw new ErreurCli(`Moteur inconnu : « ${id} » (${IDS_MOTEURS.join(', ')}).\n${USAGE_DECLARER}`, 2);
	return { moteur: id, reste };
}

/**
 * `--lier` : la liaison de `lierMoteur` (celle du bouton « Lier à Mnemo »), sans question ; refusée, sans rien toucher, quand
 * la commande du moteur est introuvable ou que `MNEMO_SANS_MCP=1` (comme `mnemo init` et la route qui lie un moteur).
 */
async function lier(moteur: MoteurDuPoste, appel: AppelCommande): Promise<SortieDeclarerLier> {
	const nom = NOMS_MOTEURS[moteur.id];
	const refus = (message: string): SortieDeclarerLier => ({ lie: false, resultat: 'echec', message });
	if (appel.env.MNEMO_SANS_MCP === '1') return refus(`MNEMO_SANS_MCP=1 : ${nom} n'est pas lié (ni serveur MCP, ni hooks).`);
	if (appel.commande === null) return refus(`${nom} introuvable sur ce poste (${moteur.installation.recherche}) : rien n'est lié.`);
	const r = await lierMoteur(moteur, { ...appel, node: nodeDurable(process.platform) });
	return { lie: moteurLie(r), resultat: r.mcp.resultat, message: r.mcp.message, ...(r.hooks === undefined ? {} : { hooks: r.hooks }) };
}

type AppelCommande = { executer: Executer; main: string; commande: CommandeMoteur | null; plateforme: string; env: Record<string, string | undefined> };

/**
 * `mnemo declarer` : la déclaration MCP de Mnemo à un moteur (Claude Code par défaut, ou `--moteur <id>`) et, chez Codex et
 * Mistral Vibe, ses hooks pour tout le poste. `--lier` : lie le moteur (déclare ce qui manque, refait ce qui est périmé,
 * laisse une déclaration de l'utilisateur) ; `--remplacer` : remet une déclaration existante sur ce Node et ce Mnemo, sans
 * rien déclarer de neuf ; `--retirer` : la retire. En texte, une ligne par étape ; `--json` : une ligne `SortieDeclarer`
 * (`SortieDeclarerLier` avec `--lier`, `@mnemo/contrat`) ; code 1 sur un échec.
 */
export async function commandeDeclarer(args: string[], partiel: Partial<DependancesDeclarer> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const { moteur: id, reste } = lireMoteur(args);
	const actions = ['--lier', '--remplacer', '--retirer'];
	const inconnue = reste.find((a) => a !== '--json' && !actions.includes(a));
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE_DECLARER}`, 2);
	const action = actions.filter((a) => reste.includes(a));
	if (action.length !== 1) throw new ErreurCli(USAGE_DECLARER, 2);
	const json = reste.includes('--json');
	const moteur = MOTEURS_DU_POSTE[id];
	const trouver = partiel.trouver?.[id] ?? (() => moteur.trouver(process.env, process.platform));
	const appel: AppelCommande = {
		executer: partiel.executer ?? executeurReel(),
		main: partiel.main ?? MAIN,
		commande: trouver(),
		plateforme: process.platform,
		env: partiel.env ?? process.env,
	};
	if (action[0] === '--lier') {
		const sortie = await lier(moteur, appel);
		if (json) ecrire(JSON.stringify(sortie));
		else {
			ecrire(sortie.message);
			if (sortie.hooks !== undefined) ecrire(sortie.hooks.message);
			if (sortie.lie) ecrire(`${NOMS_MOTEURS[id]} lié à Mnemo.`);
		}
		if (sortie.resultat === 'echec' || sortie.hooks?.resultat === 'echec') process.exitCode = 1;
		return;
	}
	const remplacer = action[0] === '--remplacer';
	const r = remplacer ? await moteur.declarationMcp.remplacer(appel) : await moteur.declarationMcp.retirer(appel);
	const prefixe = id === MOTEUR_PAR_DEFAUT ? '' : `${NOMS_MOTEURS[moteur.id]} : `;
	const sortie: SortieDeclarer = typeof r === 'string' ? { resultat: r, message: `${prefixe}${MESSAGES[r]}` } : { resultat: 'echec', message: `${prefixe}Échec : ${r.echec}` };
	if (moteur.hooksDuPoste !== undefined) sortie.hooks = await entretenirHooks(moteur, moteur.hooksDuPoste, remplacer, { node: nodeDurable(process.platform), main: appel.main, env: appel.env }, prefixe);
	if (json) ecrire(JSON.stringify(sortie));
	else {
		ecrire(sortie.message);
		if (sortie.hooks !== undefined) ecrire(sortie.hooks.message);
	}
	if (sortie.resultat === 'echec' || sortie.hooks?.resultat === 'echec') process.exitCode = 1;
}
