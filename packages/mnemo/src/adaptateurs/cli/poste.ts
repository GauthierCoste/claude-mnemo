import type { PosteVerifie } from '@mnemo/contrat';
import type { CommandeMoteur } from '../../application/ports.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import type { Executer } from '../../application/ports.ts';
import { ErreurCli } from './erreurs.ts';
import { executeurReel } from './executeur.ts';

const USAGE = 'Usage : mnemo verifier-poste [--json]';
const DELAI_GIT_MS = 10_000;

/** Ce que lit la vérification ; remplaçable (tests : ni vrai `git` ni vrai `claude`). */
export type DependancesPoste = { executer: Executer; claude: () => CommandeMoteur | null; versionNode: string };

/** Version lue dans « git version 2.50.1 (Apple Git-155) » ; toute la ligne si elle n'a pas cette forme. */
function versionGit(sortie: string): string {
	const ligne = sortie.trim().split('\n')[0] ?? '';
	return /^git version (\S+)/u.exec(ligne)?.[1] ?? ligne;
}

/**
 * Ce dont Mnemo a besoin sur le poste : `git` (lancé, `git --version` ; sous macOS sans les outils de développement, le
 * `git` du système répond en erreur), le `claude` que lanceront les sessions (`trouverClaude`), la version de Node.
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
	return { git, claude, node: { version: d.versionNode } };
}

/**
 * `mnemo verifier-poste [--json]` : git, Claude Code et Node. `--json` : un objet `PosteVerifie` (`@mnemo/contrat`) sur une
 * ligne, code de sortie 0 ; sans `--json` : une ligne par élément, code 1 s'il manque git ou Claude Code.
 */
export async function commandeVerifierPoste(args: string[], partiel: Partial<DependancesPoste> = {}, ecrire: (ligne: string) => void = (ligne) => console.log(ligne)): Promise<void> {
	const inconnue = args.find((a) => a !== '--json');
	if (inconnue !== undefined) throw new ErreurCli(`${inconnue.startsWith('-') ? `Option inconnue : « ${inconnue} ».\n` : ''}${USAGE}`, 2);
	const poste = await verifierPoste({
		executer: partiel.executer ?? executeurReel(),
		claude: partiel.claude ?? (() => trouverClaude(process.env, process.platform)),
		versionNode: partiel.versionNode ?? process.versions.node,
	});
	if (args.includes('--json')) {
		ecrire(JSON.stringify(poste));
		return;
	}
	ecrire(poste.git.ok ? `git : ${poste.git.version}` : `git : absent — ${poste.git.motif}`);
	ecrire(poste.claude.ok ? `Claude Code : ${poste.claude.chemin}` : `Claude Code : absent — ${poste.claude.motif}`);
	ecrire(`Node : ${poste.node.version}`);
	if (!poste.git.ok || !poste.claude.ok) throw new ErreurCli('Poste incomplet : installez ce qui manque, puis relancez « mnemo verifier-poste ».', 1);
}
