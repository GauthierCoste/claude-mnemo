import { NOMS_MOTEURS } from '@mnemo/commun';
import { fileURLToPath } from 'node:url';
import type { EtatHooksVerifie, EtatMcpVerifie, MoteurVerifie, PosteVerifie } from '@mnemo/contrat';
import type { CommandeMoteur, Executer, MoteurDuPoste } from '../../application/ports.ts';
import { remedesDuMoteur } from '../../application/moteurs/remedes.ts';
import type { IdMoteur } from '../../domaine/moteurs/moteur.ts';
import { MOTEURS_DU_POSTE } from '../../infra/moteurs/moteurs.ts';
import { MOTEURS_FACULTATIFS } from './moteurs-facultatifs.ts';
import type { MoteurFacultatif } from './moteurs-facultatifs.ts';
import { nodeDurable } from '../../infra/node-durable.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from '../../infra/executeur.ts';

const USAGE = 'Usage : mnemo verifier-poste [--json]';
const DELAI_GIT_MS = 10_000;
const MAIN = fileURLToPath(new URL('./main.ts', import.meta.url));

/**
 * Ce que lit la vérification ; remplaçable (tests : ni vrai `git`, ni vrai moteur). `trouver` : la commande d'un moteur (par
 * défaut, celle que son `trouver` cherche) ; `main` : le `main.ts` que la déclaration MCP doit lancer ; `plateforme` : celle du
 * poste (Node durable de la déclaration) ; `env` : celui de l'utilisateur (`CODEX_HOME`, `VIBE_HOME`).
 */
export type DependancesPoste = {
	executer: Executer;
	trouver: Partial<Record<IdMoteur, () => CommandeMoteur | null>>;
	versionNode: string;
	main: string;
	plateforme: string;
	env: Record<string, string | undefined>;
};

/** Délai de la lecture de la déclaration MCP (`codex mcp get` : lecture seule de la configuration), comme celui de `git --version`. */
const DELAI_DECLARATION_MS = 10_000;

const motifDesactive = (moteur: MoteurDuPoste): string =>
	`désactivée dans ${NOMS_MOTEURS[moteur.id]} (${moteur.installation.desactivation}) : Mnemo ne la réactive pas ; réactivez-la dans ${NOMS_MOTEURS[moteur.id]} pour que ses sessions lisent la mémoire.`;

function etatMcp(moteur: MoteurDuPoste, etat: Exclude<EtatMcpVerifie['etat'], 'echec' | 'desactive'>): string {
	const r = remedesDuMoteur(moteur);
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
	if (commande === null) return { ok: false, motif: `${NOMS_MOTEURS[moteur.id]} introuvable (${moteur.installation.recherche}).` };
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
	const r = remedesDuMoteur(moteur);
	const etats = { a_jour: 'hooks installés', perime: `hooks installés pour un autre Node ou un autre Mnemo (${r.remplacer})`, absent: `hooks non installés (${r.declarer})` };
	const approbations = { approuves: 'approuvés', a_approuver: `à approuver dans ${NOMS_MOTEURS[moteur.id]}${moteur.installation.approbation === null ? '' : ` (${moteur.installation.approbation.commande})`}`, inconnu: 'approbation inconnue' };
	const approbation = hooks.approbation === undefined ? '' : `, ${approbations[hooks.approbation.etat]} (${hooks.approbation.motif})`;
	return `${etats[hooks.etat]}${approbation}`;
}

/** Ligne d'un moteur facultatif : son chemin, sa version (trop ancienne : dit), sa déclaration MCP, ses hooks ; ou son absence. */
function ligneMoteur(moteur: MoteurDuPoste, v: MoteurVerifie): string {
	if (!v.ok) return `${NOMS_MOTEURS[moteur.id]} : absent (facultatif) — ${v.motif}`;
	const mcp = v.mcp === undefined ? '' : ` — ${v.mcp.etat === 'echec' ? `déclaration MCP illisible : ${v.mcp.motif ?? ''}` : v.mcp.etat === 'desactive' ? `serveur MCP ${motifDesactive(moteur)}` : etatMcp(moteur, v.mcp.etat)}`;
	const hooks = v.hooks === undefined ? '' : ` — ${ligneHooks(moteur, v.hooks)}`;
	// trop ancienne : le motif du refus, qui la dit
	const version = v.version === undefined ? '' : ` (${moteur.refusDeVersion?.(v.version) ?? v.version})`;
	return `${NOMS_MOTEURS[moteur.id]} : ${v.chemin}${version}${mcp}${hooks}`;
}

/** Version lue dans « git version 2.50.1 (Apple Git-155) » ; toute la ligne si elle n'a pas cette forme. */
function versionGit(sortie: string): string {
	const ligne = sortie.trim().split('\n')[0] ?? '';
	return /^git version (\S+)/u.exec(ligne)?.[1] ?? ligne;
}

/**
 * Le poste vu par ce Mnemo : un bloc par moteur facultatif, toujours écrit (facultatifs dans le contrat, pour un Mnemo plus
 * ancien), sous son nom dans le contrat (`CONTRAT_DES_FACULTATIFS`).
 */
export type PosteVerifieComplet = Required<PosteVerifie>;

/** Le bloc d'un moteur facultatif dans le poste vérifié. */
const blocDuPoste = (poste: PosteVerifieComplet, m: MoteurFacultatif): MoteurVerifie => poste[m.bloc];

/** La commande d'un moteur : celle des dépendances, sinon celle que son `trouver` cherche. */
const commandeDe = (moteur: MoteurDuPoste, d: DependancesPoste): CommandeMoteur | null => (d.trouver[moteur.id] ?? (() => moteur.trouver(d.env, d.plateforme)))();

/**
 * Ce dont Mnemo a besoin sur le poste : `git` (lancé, `git --version` ; sous macOS sans les outils de développement, le
 * `git` du système répond en erreur), le `claude` que lanceront les sessions, la version de Node ; et
 * les moteurs facultatifs (Codex, Mistral Vibe, GitHub Copilot CLI : trouvés ou non, leur déclaration MCP et leurs hooks).
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
	const claudeCode = MOTEURS_DU_POSTE['claude-code'];
	const commande = commandeDe(claudeCode, d);
	const claude: PosteVerifie['claude'] =
		commande === null ? { ok: false, motif: `${NOMS_MOTEURS[claudeCode.id]} introuvable (${claudeCode.installation.recherche}).` } : { ok: true, chemin: commande.avant[0] ?? commande.commande };
	const facultatifs = await Promise.all(MOTEURS_FACULTATIFS.map(async (m) => [m.bloc, await verifierMoteur(m.moteur, commandeDe(m.moteur, d), d)] as const));
	return { git, claude, ...(Object.fromEntries(facultatifs) as Omit<PosteVerifieComplet, 'git' | 'claude' | 'node'>), node: { version: d.versionNode } };
}

/**
 * `mnemo verifier-poste [--json]` : git, Claude Code, Codex, Mistral Vibe, GitHub Copilot CLI et Node. `--json` : un objet
 * `PosteVerifie` (`@mnemo/contrat`) sur une ligne, code de sortie 0 ; sans `--json` : une ligne par élément, code 1 s'il
 * manque git ou Claude Code (Codex, Mistral Vibe et GitHub Copilot CLI sont facultatifs).
 */
export async function commandeVerifierPoste(args: string[], partiel: Partial<DependancesPoste> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const inconnue = args.find((a) => a !== '--json');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const poste = await verifierPoste({
		executer: partiel.executer ?? executeurReel(),
		trouver: partiel.trouver ?? {},
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
	for (const m of MOTEURS_FACULTATIFS) ecrire(ligneMoteur(m.moteur, blocDuPoste(poste, m)));
	ecrire(`Node : ${poste.node.version}`);
	if (!poste.git.ok || !poste.claude.ok) throw new ErreurCli('Poste incomplet : installez ce qui manque, puis relancez « mnemo verifier-poste ».', 1);
}
