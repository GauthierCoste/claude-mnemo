import { describe, expect, it } from 'vitest';
import { commandeDeclarer } from '../../src/adaptateurs/cli/declaration.ts';
import type { Executer } from '../../src/application/ports.ts';
import { commandeManuelle, declarerServeurMcp, redeclarerServeurMcp, retirerServeurMcp } from '../../src/infra/moteurs/claude-code/declaration-mcp.ts';
import { executeurReel } from '../../src/adaptateurs/cli/executeur.ts';

const MAIN = '/chemin/absolu/main.ts';
/** `claude` tel que `trouverClaude` le rend sur un poste POSIX. */
const CLAUDE = { commande: 'claude', avant: [] };

type Reponse = number | Error | { code: number; sortie: string };

function simule(reponses: Reponse[]) {
	const appels: string[][] = [];
	const executer: Executer = async (commande, args) => {
		appels.push([commande, ...args]);
		const r = reponses.shift() ?? 0;
		if (r instanceof Error) throw r;
		return typeof r === 'number' ? { code: r, sortie: '', erreur: '' } : { ...r, erreur: '' };
	};
	return { appels, executer };
}

/** Sortie de `claude mcp get mnemo` (format de Claude Code). */
const sortieGet = (commande: string, main: string) =>
	`mnemo:\n  Scope: User config (available in all your projects)\n  Status: ✓ Connected\n  Type: stdio\n  Command: ${commande}\n  Args: ${main} mcp\n  Environment:\n\nTo remove this server, run: claude mcp remove "mnemo" -s user\n`;

describe('declarerServeurMcp', () => {
	it('déclare au niveau utilisateur avec Node et le chemin absolu', async () => {
		const { appels, executer } = simule([1, 0]);
		expect(await declarerServeurMcp(executer, MAIN, CLAUDE)).toBe('declare');
		expect(appels[0]).toEqual(['claude', 'mcp', 'get', 'mnemo']);
		expect(appels[1]?.slice(0, 6)).toEqual(['claude', 'mcp', 'add-json', '--scope', 'user', 'mnemo']);
		expect(JSON.parse(appels[1]?.[6] ?? '')).toEqual({ type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] });
	});

	it('déjà déclaré avec la même commande : aucun add', async () => {
		const { appels, executer } = simule([{ code: 0, sortie: sortieGet(process.execPath, MAIN) }]);
		expect(await declarerServeurMcp(executer, MAIN, CLAUDE)).toBe('deja');
		expect(appels).toHaveLength(1);
	});

	it('déjà déclaré avec un autre Node ou un autre main.ts : périmé, jamais retiré automatiquement', async () => {
		for (const sortie of [sortieGet('/vieux/node', MAIN), sortieGet(process.execPath, '/ancien/depot/main.ts'), '']) {
			const { appels, executer } = simule([{ code: 0, sortie }]);
			expect(await declarerServeurMcp(executer, MAIN, CLAUDE), sortie).toMatchObject({ perime: true, manuel: expect.stringContaining('claude mcp add --scope user mnemo -- ') });
			expect(appels).toEqual([['claude', 'mcp', 'get', 'mnemo']]);
		}
	});

	it('sorties get plus fines : sous-chaîne, arguments espacés, format inconnu', async () => {
		const cas: [string, string][] = [
			[sortieGet(process.execPath, MAIN), 'deja'],
			[sortieGet(process.execPath.replace(/node$/u, 'node-old'), MAIN), 'perime'],
			[sortieGet(process.execPath, `${MAIN}-ancien`), 'perime'],
			[sortieGet(process.execPath, `/x${MAIN}`), 'perime'],
			[`  Command: ${process.execPath}\n  Args: mcp ${MAIN}\n`, 'perime'],
			[`Le serveur ${process.execPath} ${MAIN} tourne\n`, 'perime'],
			[`  command:   ${process.execPath}  \n  ARGS: ${MAIN} mcp\n`, 'deja'],
		];
		for (const [sortie, attendu] of cas) {
			const { executer } = simule([{ code: 0, sortie }]);
			const r = await declarerServeurMcp(executer, MAIN, CLAUDE);
			expect(r === 'deja' ? 'deja' : 'perime', sortie).toBe(attendu);
		}
		const { executer } = simule([{ code: 0, sortie: sortieGet(process.execPath, '/chemin avec espace/main.ts') }]);
		expect(await declarerServeurMcp(executer, '/chemin avec espace/main.ts', CLAUDE)).toBe('deja');
	});

	it('périmé : la portée lue est reprise, sinon utilisateur', async () => {
		const local = simule([{ code: 0, sortie: sortieGet('/vieux/node', MAIN).replace('User config (available in all your projects)', 'Local config (private to you in this project)') }]);
		expect(await declarerServeurMcp(local.executer, MAIN, CLAUDE)).toMatchObject({ perime: true, portee: 'Local config (private to you in this project)', scope: 'local' });
		const inconnu = simule([{ code: 0, sortie: 'format inconnu' }]);
		const r = await declarerServeurMcp(inconnu.executer, MAIN, CLAUDE);
		expect(r).toMatchObject({ perime: true, scope: 'user' });
		expect(r).not.toHaveProperty('portee');
	});

	it('périmé : remplaçable par `mnemo declarer --remplacer` seulement pour une déclaration de Mnemo de portée utilisateur', async () => {
		const autreMnemo = '/autre/depot/packages/mnemo/src/adaptateurs/cli/main.ts';
		const utilisateur = simule([{ code: 0, sortie: sortieGet('/vieux/node', autreMnemo) }]);
		expect(await declarerServeurMcp(utilisateur.executer, MAIN, CLAUDE)).toMatchObject({ perime: true, remplacable: true });
		const local = simule([{ code: 0, sortie: sortieGet('/vieux/node', autreMnemo).replace('User config (available in all your projects)', 'Local config (private to you in this project)') }]);
		expect(await declarerServeurMcp(local.executer, MAIN, CLAUDE)).toMatchObject({ perime: true, remplacable: false });
		const etranger = simule([{ code: 0, sortie: sortieGet('/usr/bin/python3', '/opt/serveur.py') }]);
		expect(await declarerServeurMcp(etranger.executer, MAIN, CLAUDE)).toMatchObject({ perime: true, remplacable: false });
	});

	it('claude trouvé comme pour les sessions (Windows : la cible du shim npm, MNEMO_CLAUDE) : get et add-json passent par lui', async () => {
		const { appels, executer } = simule([1, 0]);
		const shim = { commande: 'C:\\Program Files\\nodejs\\node.exe', avant: ['C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\cli.js'] };
		expect(await declarerServeurMcp(executer, MAIN, shim, 'win32')).toBe('declare');
		expect(appels[0]).toEqual([shim.commande, ...shim.avant, 'mcp', 'get', 'mnemo']);
		expect(appels[1]?.slice(0, 3)).toEqual([shim.commande, ...shim.avant, 'mcp']);
	});

	it('claude introuvable par la recherche : commande manuelle, rien n’est lancé', async () => {
		const { appels, executer } = simule([]);
		expect(await declarerServeurMcp(executer, MAIN, null)).toEqual({ manuel: expect.stringContaining('claude mcp add --scope user mnemo -- '), introuvable: true, raison: expect.any(String) });
		expect(appels).toEqual([]);
	});

	it('claude introuvable : commande manuelle', async () => {
		const { executer } = simule([Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' })]);
		const r = await declarerServeurMcp(executer, MAIN, CLAUDE);
		expect(r).toEqual({ manuel: expect.stringContaining('claude mcp add --scope user mnemo -- '), introuvable: true, raison: expect.any(String) });
	});

	it("échec de l'add : commande manuelle", async () => {
		const executer: Executer = async (_c, args) => ({ code: 1, sortie: '', erreur: args[1] === 'add-json' ? '\nboum\nautre' : '' });
		const r = await declarerServeurMcp(executer, MAIN, CLAUDE);
		expect(r).toEqual({ manuel: expect.stringContaining('claude mcp add --scope user mnemo -- '), introuvable: false, raison: 'boum' });
	});
});

describe('commandeManuelle', () => {
	it('POSIX : chaque chemin entre apostrophes', () => {
		expect(commandeManuelle('/a b/node', "/x/l'y & $z %p%/main.ts", 'darwin')).toBe(
			`claude mcp add --scope user mnemo -- '/a b/node' '/x/l'\\''y & $z %p%/main.ts' mcp`,
		);
	});
	it('PowerShell : apostrophes doublées', () => {
		expect(commandeManuelle("C:\\Program Files\\node.exe", "C:\\u's & $z %p%\\main.ts", 'win32')).toBe(
			`claude mcp add --scope user mnemo -- 'C:\\Program Files\\node.exe' 'C:\\u''s & $z %p%\\main.ts' mcp`,
		);
	});
});

describe('executeurReel', () => {
	it('rend le code de sortie non nul sans rejeter', async () => {
		const ex = executeurReel((_c, _a, fin) => fin(Object.assign(new Error('x'), { code: 3 }), '', 'e'));
		expect(await ex('claude', ['mcp'])).toEqual({ code: 3, sortie: '', erreur: 'e' });
	});
	it('rejette sur ENOENT ou délai dépassé, sans réessai ni shell', async () => {
		let n = 0;
		const enoent = Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
		const ex = executeurReel((_c, _a, fin) => (n++, fin(enoent, '', '')));
		await expect(ex('claude', [])).rejects.toBe(enoent);
		const tue = executeurReel((_c, _a, fin) => fin(Object.assign(new Error('timed out'), { code: null }), '', ''));
		await expect(tue('claude', [])).rejects.toThrow('timed out');
		expect(n).toBe(1);
	});
	it('transmet dossier courant, environnement et délai ; le lanceur réel ferme l\'entrée et applique le délai', async () => {
		const recus: unknown[] = [];
		const ex = executeurReel((_c, _a, fin, options) => (recus.push(options), fin(null, 'ok', '')));
		const options = { cwd: '/tmp', env: { A: '1' }, delaiMs: 60_000 };
		expect(await ex('claude', ['-p'], options)).toEqual({ code: 0, sortie: 'ok', erreur: '' });
		expect(recus).toEqual([options]);
		// vrai processus : l'entrée fermée tout de suite (sinon il attendrait), l'environnement transmis tel quel
		const reel = executeurReel();
		const lu = await reel(process.execPath, ['-e', 'let n = 0; process.stdin.on("data", (d) => (n += d.length)).on("end", () => console.log(n, process.env.MNEMO_ESSAI))'], { env: { MNEMO_ESSAI: 'x' }, delaiMs: 10_000 });
		expect(lu).toEqual({ code: 0, sortie: '0 x\n', erreur: '' });
		await expect(reel(process.execPath, ['-e', 'setTimeout(() => {}, 10_000)'], { delaiMs: 200 })).rejects.toThrow();
	});
	it('signal d\'abandon : le processus enfant est tué, la promesse rejette tout de suite', async () => {
		const controleur = new AbortController();
		const debut = Date.now();
		const attente = executeurReel()(process.execPath, ['-e', 'setTimeout(() => {}, 20_000)'], { delaiMs: 30_000, signal: controleur.signal });
		setTimeout(() => controleur.abort(), 100);
		await expect(attente).rejects.toThrow();
		expect(Date.now() - debut).toBeLessThan(10_000);
	});
});

describe('redeclarerServeurMcp et retirerServeurMcp (mnemo declarer)', () => {
	const ANCIEN = '/ancien/depot/packages/mnemo/src/adaptateurs/cli/main.ts';
	const portee = (sortie: string, mot: string) => sortie.replace('User config (available in all your projects)', mot);

	it('remplace une déclaration de Mnemo périmée de portée utilisateur : retrait puis ajout', async () => {
		const { appels, executer } = simule([{ code: 0, sortie: sortieGet('/vieux/node', ANCIEN) }, 0, 0]);
		expect(await redeclarerServeurMcp(executer, MAIN, CLAUDE)).toBe('remplace');
		expect(appels[1]).toEqual(['claude', 'mcp', 'remove', '--scope', 'user', 'mnemo']);
		expect(appels[2]?.slice(0, 6)).toEqual(['claude', 'mcp', 'add-json', '--scope', 'user', 'mnemo']);
		expect(JSON.parse(appels[2]?.[6] ?? '')).toEqual({ type: 'stdio', command: process.execPath, args: [MAIN, 'mcp'] });
	});

	it('ne déclare jamais rien de neuf, ne touche ni une autre commande « mnemo » ni une autre portée', async () => {
		for (const [reponse, attendu] of [
			[1, 'absent'],
			[{ code: 0, sortie: sortieGet(process.execPath, MAIN) }, 'deja'],
			[{ code: 0, sortie: sortieGet('/usr/bin/autre', '/autre/serveur.js') }, 'autre'],
			[{ code: 0, sortie: portee(sortieGet('/vieux/node', ANCIEN), 'Local config (private to you in this project)') }, 'autre'],
		] as const) {
			const { appels, executer } = simule([reponse]);
			expect(await redeclarerServeurMcp(executer, MAIN, CLAUDE)).toBe(attendu);
			expect(appels).toHaveLength(1);
		}
	});

	it('échecs : claude introuvable, retrait refusé', async () => {
		expect(await redeclarerServeurMcp(simule([]).executer, MAIN, null)).toMatchObject({ echec: expect.any(String) });
		const { executer } = simule([{ code: 0, sortie: sortieGet('/vieux/node', ANCIEN) }, 1]);
		expect(await redeclarerServeurMcp(executer, MAIN, CLAUDE)).toMatchObject({ echec: expect.stringContaining('remove') });
	});

	it('retire seulement une déclaration qui lance ce Node et ce main.ts', async () => {
		const ok = simule([{ code: 0, sortie: sortieGet(process.execPath, MAIN) }, 0]);
		expect(await retirerServeurMcp(ok.executer, MAIN, CLAUDE)).toBe('retire');
		expect(ok.appels[1]).toEqual(['claude', 'mcp', 'remove', '--scope', 'user', 'mnemo']);
		for (const [reponse, attendu] of [
			[1, 'absent'],
			[{ code: 0, sortie: sortieGet('/vieux/node', ANCIEN) }, 'autre'],
		] as const) {
			const { appels, executer } = simule([reponse]);
			expect(await retirerServeurMcp(executer, MAIN, CLAUDE)).toBe(attendu);
			expect(appels).toHaveLength(1);
		}
	});

	it('mnemo declarer : une ligne JSON ; usage refusé sans action ou avec les deux', async () => {
		const lignes: string[] = [];
		const { executer } = simule([1]);
		await commandeDeclarer(['--remplacer', '--json'], { executer, claude: () => CLAUDE, main: MAIN }, (l) => lignes.push(l));
		expect(JSON.parse(lignes[0]!)).toMatchObject({ resultat: 'absent' });
		await expect(commandeDeclarer(['--json'], { executer, claude: () => CLAUDE })).rejects.toMatchObject({ code: 2 });
		await expect(commandeDeclarer(['--remplacer', '--retirer'], { executer, claude: () => CLAUDE })).rejects.toMatchObject({ code: 2 });
	});
});
