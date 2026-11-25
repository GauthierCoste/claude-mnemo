import { fileURLToPath } from 'node:url';
import type { EtatHooksVerifie, EtatMcpVerifie, MoteurVerifie, PosteVerifie } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, MoteurDuPoste } from '../../application/ports.ts';
import { versionMinimaleLisible } from '../../domaine/moteurs/version.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';
import { MOTEURS_FACULTATIFS, REMEDES } from '../moteurs-du-poste.ts';
import type { MoteurFacultatif } from '../moteurs-du-poste.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from '../../infra/executeur.ts';

const USAGE = 'Usage : mnemo verifier-poste [--json]';
const DELAI_GIT_MS = 10_000;
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/**
 * Ce que lit la vérification ; remplaçable (tests : ni vrai `git`, ni vrai `claude`, ni vrai `codex`, ni vrai `vibe`). `main` :
 * le `main.ts` que la déclaration MCP doit lancer ; `plateforme` : celle du poste (Node durable de la déclaration) ; `env` :
 * celui de l'utilisateur (`CODEX_HOME`, `VIBE_HOME`).
 */
export type DependancesPoste = {
	executer: Executer;
	claude: () => CommandeMoteur | null;
	codex: () => CommandeMoteur | null;
	vibe: () => CommandeMoteur | null;
	versionNode: string;
	main: string;
	plateforme: string;
	env: Record<string, string | undefined>;
};

/** Délai de la lecture de la déclaration MCP (`codex mcp get` : lecture seule de la configuration), comme celui de `git --version`. */
const DELAI_DECLARATION_MS = 10_000;

const motifDesactive = (moteur: MoteurDuPoste): string =>
	`désactivée dans ${moteur.nom} (${REMEDES[moteur.id].desactivation}) : Mnemo ne la réactive pas ; réactivez-la dans ${moteur.nom} pour que ses sessions lisent la mémoire.`;

function etatMcp(moteur: MoteurDuPoste, etat: Exclude<EtatMcpVerifie['etat'], 'echec' | 'desactive'>): string {
	const r = REMEDES[moteur.id];
	if (etat === 'deja') return 'serveur MCP déclaré';
	if (etat === 'absent') return `serveur MCP non déclaré (${r.declarer})`;
	if (etat === 'perime') return `serveur MCP déclaré pour un autre Node ou un autre Mnemo (${r.remplacer})`;
	return 'une déclaration MCP « mnemo » qui ne lance pas Mnemo';
}

/**
 * Un moteur facultatif : trouvé, sa version (`--version`, sans cache), sa déclaration MCP et ses hooks de Mnemo pour tout le
 * poste sont lus, sans rien changer.
 */
async function verifierMoteur(moteur: MoteurDuPoste, commande: CommandeMoteur | null, d: DependancesPoste): Promise<MoteurVerifie> {
	if (commande === null) return { ok: false, motif: `${moteur.nom} introuvable (${REMEDES[moteur.id].recherche}).` };
	const lu = await moteur.declarationMcp.lire({ executer: d.executer, main: d.main, commande, plateforme: d.plateforme, env: d.env, delaiMs: DELAI_DECLARATION_MS });
	const mcp: EtatMcpVerifie = typeof lu !== 'string' ? { etat: 'echec', motif: lu.echec } : lu === 'desactive' ? { etat: lu, motif: motifDesactive(moteur) } : { etat: lu };
	const hooks = await moteur.hooksDuPoste?.lire({ node: nodeDurable(d.plateforme as NodeJS.Platform), main: d.main, env: d.env });
	const etatHooks: EtatHooksVerifie | undefined =
		hooks === undefined ? undefined : 'echec' in hooks ? { etat: 'echec', motif: hooks.echec } : { etat: hooks.etat, ...(hooks.approbation === undefined ? {} : { approbation: hooks.approbation }) };
	const version = moteur.version === undefined ? null : await moteur.version(commande, d.env, d.executer, { relire: true }).catch(() => null);
	return { ok: true, chemin: commande.avant[0] ?? commande.commande, ...(version === null ? {} : { version }), mcp, ...(etatHooks === undefined ? {} : { hooks: etatHooks }) };
}

/** Ligne des hooks d'un moteur : leur état, puis leur approbation et son motif. */
function ligneHooks(moteur: MoteurDuPoste, hooks: EtatHooksVerifie): string {
	if (hooks.etat === 'echec') return `hooks illisibles : ${hooks.motif ?? ''}`;
	const r = REMEDES[moteur.id];
	const etats = { a_jour: 'hooks installés', perime: `hooks installés pour un autre Node ou un autre Mnemo (${r.remplacer})`, absent: `hooks non installés (${r.declarer})` };
	const approbations = { approuves: 'approuvés', a_approuver: `à approuver dans ${moteur.nom} (/hooks)`, inconnu: 'approbation inconnue' };
	const approbation = hooks.approbation === undefined ? '' : `, ${approbations[hooks.approbation.etat]} (${hooks.approbation.motif})`;
	return `${etats[hooks.etat]}${approbation}`;
}

/** Ligne d'un moteur facultatif : son chemin, sa version (trop ancienne : dit), sa déclaration MCP, ses hooks ; ou son absence. */
function ligneMoteur(moteur: MoteurDuPoste, v: MoteurVerifie): string {
	if (!v.ok) return `${moteur.nom} : absent (facultatif) — ${v.motif}`;
	const mcp = v.mcp === undefined ? '' : ` — ${v.mcp.etat === 'echec' ? `déclaration MCP illisible : ${v.mcp.motif ?? ''}` : v.mcp.etat === 'desactive' ? `serveur MCP ${motifDesactive(moteur)}` : etatMcp(moteur, v.mcp.etat)}`;
	const hooks = v.hooks === undefined ? '' : ` — ${ligneHooks(moteur, v.hooks)}`;
	const ancien = v.version !== undefined && moteur.versionMinimale !== undefined && moteur.refusDeVersion?.(v.version) != null;
	const version = v.version === undefined ? '' : ` (${v.version}${ancien ? `, trop ancien : ${versionMinimaleLisible(moteur.versionMinimale!)} ou plus requis` : ''})`;
	return `${moteur.nom} : ${v.chemin}${version}${mcp}${hooks}`;
}

/** Version lue dans « git version 2.50.1 (Apple Git-155) » ; toute la ligne si elle n'a pas cette forme. */
function versionGit(sortie: string): string {
	const ligne = sortie.trim().split('\n')[0] ?? '';
	return /^git version (\S+)/u.exec(ligne)?.[1] ?? ligne;
}

/** Le poste vu par ce Mnemo : un bloc par moteur facultatif, toujours écrit (facultatifs dans le contrat, pour un Mnemo plus ancien). */
export type PosteVerifieComplet = PosteVerifie & Record<MoteurFacultatif['bloc'], MoteurVerifie>;

/** La dépendance qui trouve la commande de chaque moteur facultatif. */
const TROUVEURS: Record<MoteurFacultatif['id'], 'codex' | 'vibe'> = { codex: 'codex', 'mistral-vibe': 'vibe' };

/**
 * Ce dont Mnemo a besoin sur le poste : `git` (lancé, `git --version` ; sous macOS sans les outils de développement, le
 * `git` du système répond en erreur), le `claude` que lanceront les sessions (`trouverClaude`), la version de Node ; et
 * les moteurs facultatifs (Codex, Mistral Vibe : trouvés ou non, leur déclaration MCP et leurs hooks).
 */
export async function verifierPoste(d: DependancesPoste): Promise<PosteVerifieComplet> {
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
	const facultatifs = await Promise.all(MOTEURS_FACULTATIFS.map(async (f) => [f.bloc, await verifierMoteur(MOTEURS_DU_POSTE[f.id], d[TROUVEURS[f.id]](), d)] as const));
	return { git, claude, ...(Object.fromEntries(facultatifs) as Record<MoteurFacultatif['bloc'], MoteurVerifie>), node: { version: d.versionNode } };
}

/**
 * `mnemo verifier-poste [--json]` : git, Claude Code, Codex, Mistral Vibe et Node. `--json` : un objet `PosteVerifie` (`@mnemo/contrat`)
 * sur une ligne, code de sortie 0 ; sans `--json` : une ligne par élément, code 1 s'il manque git ou Claude Code (Codex et
 * Mistral Vibe sont facultatifs).
 */
export async function commandeVerifierPoste(args: string[], partiel: Partial<DependancesPoste> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const inconnue = args.find((a) => a !== '--json');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const poste = await verifierPoste({
		executer: partiel.executer ?? executeurReel(),
		claude: partiel.claude ?? (() => trouverClaude(process.env, process.platform)),
		codex: partiel.codex ?? (() => MOTEURS_DU_POSTE.codex.trouver(process.env, process.platform)),
		vibe: partiel.vibe ?? (() => MOTEURS_DU_POSTE['mistral-vibe'].trouver(process.env, process.platform)),
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
	for (const f of MOTEURS_FACULTATIFS) ecrire(ligneMoteur(MOTEURS_DU_POSTE[f.id], poste[f.bloc]));
	ecrire(`Node : ${poste.node.version}`);
	if (!poste.git.ok || !poste.claude.ok) throw new ErreurCli('Poste incomplet : installez ce qui manque, puis relancez « mnemo verifier-poste ».', 1);
}
