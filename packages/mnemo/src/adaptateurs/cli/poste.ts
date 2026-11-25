import { fileURLToPath } from 'node:url';
import type { EtatHooksVerifie, EtatMcpVerifie, PosteVerifie } from '@mnemo/contrat';
import type { CommandeMoteur, Executer } from '../../application/ports.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { MOTEUR_CODEX } from '../../infra/moteurs/codex.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from './executeur.ts';

const USAGE = 'Usage : mnemo verifier-poste [--json]';
const DELAI_GIT_MS = 10_000;
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/**
 * Ce que lit la vérification ; remplaçable (tests : ni vrai `git`, ni vrai `claude`, ni vrai `codex`). `main` : le `main.ts`
 * que la déclaration MCP doit lancer ; `plateforme` : celle du poste (Node durable de la déclaration) ; `env` : celui de
 * l'utilisateur (`CODEX_HOME`).
 */
export type DependancesPoste = { executer: Executer; claude: () => CommandeMoteur | null; codex: () => CommandeMoteur | null; versionNode: string; main: string; plateforme: string; env: Record<string, string | undefined> };

/** Délai de `codex mcp get` (lecture seule de la configuration), comme celui de `git --version`. */
const DELAI_CODEX_MS = 10_000;
const MOTIF_DESACTIVE = 'désactivée dans Codex (enabled = false) : Mnemo ne la réactive pas ; réactivez-la dans Codex pour que ses sessions lisent la mémoire.';

const ETATS_MCP: Record<Exclude<EtatMcpVerifie['etat'], 'echec' | 'desactive'>, string> = {
	deja: 'serveur MCP déclaré',
	absent: 'serveur MCP non déclaré (mnemo init --codex)',
	perime: 'serveur MCP déclaré pour un autre Node ou un autre Mnemo (mnemo declarer --moteur codex --remplacer)',
	autre: 'une déclaration MCP « mnemo » qui ne lance pas Mnemo',
};

/** Codex : facultatif ; trouvé, sa déclaration MCP (`codex mcp get`) et ses hooks de Mnemo (`hooks.json`, `config.toml`) sont lus, sans rien changer. */
async function verifierCodex(d: DependancesPoste): Promise<PosteVerifie['codex']> {
	const commande = d.codex();
	if (commande === null) return { ok: false, motif: 'Codex introuvable (commande codex absente du PATH et de ChatGPT.app, ou MNEMO_CODEX invalide).' };
	const lu = await MOTEUR_CODEX.declarationMcp.lire({ executer: d.executer, main: d.main, commande, plateforme: d.plateforme, env: d.env, delaiMs: DELAI_CODEX_MS });
	const mcp: EtatMcpVerifie = typeof lu !== 'string' ? { etat: 'echec', motif: lu.echec } : lu === 'desactive' ? { etat: lu, motif: MOTIF_DESACTIVE } : { etat: lu };
	const hooks = await MOTEUR_CODEX.hooksDuPoste!.lire({ node: nodeDurable(d.plateforme as NodeJS.Platform), main: d.main, env: d.env });
	const etatHooks: EtatHooksVerifie = 'echec' in hooks ? { etat: 'echec', motif: hooks.echec } : { etat: hooks.etat, ...(hooks.approbation === undefined ? {} : { approbation: hooks.approbation }) };
	return { ok: true, chemin: commande.avant[0] ?? commande.commande, mcp, hooks: etatHooks };
}

const ETATS_HOOKS: Record<Exclude<EtatHooksVerifie['etat'], 'echec'>, string> = {
	a_jour: 'hooks installés',
	perime: 'hooks installés pour un autre Node ou un autre Mnemo (mnemo declarer --moteur codex --remplacer)',
	absent: 'hooks non installés (mnemo init --codex)',
};
const APPROBATIONS: Record<NonNullable<EtatHooksVerifie['approbation']>['etat'], string> = { approuves: 'approuvés', a_approuver: 'à approuver dans Codex (/hooks)', inconnu: 'approbation inconnue' };

/** Ligne des hooks de Codex : leur état, puis leur approbation et son motif. */
function ligneHooks(hooks: EtatHooksVerifie): string {
	if (hooks.etat === 'echec') return `hooks illisibles : ${hooks.motif ?? ''}`;
	const approbation = hooks.approbation === undefined ? '' : `, ${APPROBATIONS[hooks.approbation.etat]} (${hooks.approbation.motif})`;
	return `${ETATS_HOOKS[hooks.etat]}${approbation}`;
}

/** Version lue dans « git version 2.50.1 (Apple Git-155) » ; toute la ligne si elle n'a pas cette forme. */
function versionGit(sortie: string): string {
	const ligne = sortie.trim().split('\n')[0] ?? '';
	return /^git version (\S+)/u.exec(ligne)?.[1] ?? ligne;
}

/**
 * Ce dont Mnemo a besoin sur le poste : `git` (lancé, `git --version` ; sous macOS sans les outils de développement, le
 * `git` du système répond en erreur), le `claude` que lanceront les sessions (`trouverClaude`), la version de Node ; et
 * Codex, facultatif (trouvé ou non, et sa déclaration MCP).
 */
export async function verifierPoste(d: DependancesPoste): Promise<PosteVerifie> {
	let git: PosteVerifie['git'];
	try {
		const r = await d.executer('git', ['--version'], { delaiMs: DELAI_GIT_MS });
		if (r.code === 0) git = { ok: true, version: versionGit(r.sortie) };
		else git = { ok: false, motif: r.erreur.trim().split('\n')[0] || `git --version a échoué (code ${r.code}).` };
	} catch (erreur) {
		const code = (erreur as { code?: unknown } | null)?.code;
		git = { ok: false, motif: code === 'ENOENT' ? 'git introuvable dans le PATH.' : `git ne se lance pas : ${erreur instanceof Error ? erreur.message : String(erreur)}` };
	}
	const commande = d.claude();
	const claude: PosteVerifie['claude'] =
		commande === null ? { ok: false, motif: 'Claude Code introuvable (commande claude absente du PATH, ou MNEMO_CLAUDE invalide).' } : { ok: true, chemin: commande.avant[0] ?? commande.commande };
	return { git, claude, codex: await verifierCodex(d), node: { version: d.versionNode } };
}

/**
 * `mnemo verifier-poste [--json]` : git, Claude Code, Codex et Node. `--json` : un objet `PosteVerifie` (`@mnemo/contrat`)
 * sur une ligne, code de sortie 0 ; sans `--json` : une ligne par élément, code 1 s'il manque git ou Claude Code (Codex est
 * facultatif).
 */
export async function commandeVerifierPoste(args: string[], partiel: Partial<DependancesPoste> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const inconnue = args.find((a) => a !== '--json');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const poste = await verifierPoste({
		executer: partiel.executer ?? executeurReel(),
		claude: partiel.claude ?? (() => trouverClaude(process.env, process.platform)),
		codex: partiel.codex ?? (() => MOTEUR_CODEX.trouver(process.env, process.platform)),
		versionNode: partiel.versionNode ?? process.versions.node,
		main: partiel.main ?? MAIN,
		plateforme: partiel.plateforme ?? process.platform,
		env: partiel.env ?? process.env,
	});
	if (args.includes('--json')) {
		ecrire(JSON.stringify(poste));
		return;
	}
	ecrire(poste.git.ok ? `git : ${poste.git.version}` : `git : absent — ${poste.git.motif}`);
	ecrire(poste.claude.ok ? `Claude Code : ${poste.claude.chemin}` : `Claude Code : absent — ${poste.claude.motif}`);
	const { codex } = poste;
	const mcp = codex.mcp === undefined ? '' : ` — ${codex.mcp.etat === 'echec' ? `déclaration MCP illisible : ${codex.mcp.motif ?? ''}` : codex.mcp.etat === 'desactive' ? `serveur MCP ${MOTIF_DESACTIVE}` : ETATS_MCP[codex.mcp.etat]}`;
	const hooks = codex.hooks === undefined ? '' : ` — ${ligneHooks(codex.hooks)}`;
	ecrire(codex.ok ? `Codex : ${codex.chemin}${mcp}${hooks}` : `Codex : absent (facultatif) — ${codex.motif}`);
	ecrire(`Node : ${poste.node.version}`);
	if (!poste.git.ok || !poste.claude.ok) throw new ErreurCli('Poste incomplet : installez ce qui manque, puis relancez « mnemo verifier-poste ».', 1);
}
