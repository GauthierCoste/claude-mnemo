import { describe, expect, it } from 'vitest';
import { avecBlocALaFin, elementsDuTableau, entreesToml, LitteralToml, sansPlages } from '../../src/domaine/moteurs/toml-lecture.ts';

const CONFIG = `# réglages de l'utilisateur
active_model = "local" # commentaire
[[providers]]
name = "sonde"
api_base = 'http://127.0.0.1:18080/v1'

[[mcp_servers]]
name = "autre"
command = ["npx", "serveur"]

# le serveur de Mnemo
[[mcp_servers]]
name = "mnemo"
transport = "stdio"
command = '/opt/node'
args = [
  '/d/adaptateurs/cli/main.ts', # chemin
  "mcp",
]
[mcp_servers.env]
CLE = "valeur"

[tools.mnemo_lire]
permission = "always"
note = """
deux
lignes"""
`;

describe('lecture TOML par entrées', () => {
	it('lit en-têtes, clés et valeurs (chaînes des quatre formes, tableaux sur plusieurs lignes, tables en ligne, littéraux)', () => {
		const entrees = entreesToml(CONFIG)!;
		expect(entrees.map((e) => (e.genre === 'valeur' ? e.cle.join('.') : `[${e.cle.join('.')}]`))).toEqual([
			'active_model',
			'[providers]',
			'name',
			'api_base',
			'[mcp_servers]',
			'name',
			'command',
			'[mcp_servers]',
			'name',
			'transport',
			'command',
			'args',
			'[mcp_servers.env]',
			'CLE',
			'[tools.mnemo_lire]',
			'permission',
			'note',
		]);
		const note = entrees.at(-1)!;
		expect(note.genre === 'valeur' && note.valeur).toBe('deux\nlignes');
		const enLigne = entreesToml('a = { b = 1, "c.d" = [true, 2024-01-02 10:00:00], e.f = \'g\' }\n')![0]!;
		expect(enLigne.genre === 'valeur' && enLigne.valeur).toEqual({ b: new LitteralToml('1'), 'c.d': [true, new LitteralToml('2024-01-02 10:00:00')], e: { f: 'g' } });
		expect(entreesToml('a = "\\u00e9\\t"\n')![0]).toMatchObject({ valeur: 'é\t' });
	});

	it('refuse ce qu’il ne lit pas sûrement', () => {
		for (const mauvais of ['a = "ouvert\n', 'a = [1, 2\n', '[table\n', 'a b = 1\n', 'a = 1 b = 2\n', 'a = """x\n']) expect(entreesToml(mauvais), mauvais).toBeNull();
	});

	it('éléments d’un tableau de tables, sous-tables comprises, et leur place exacte dans le texte', () => {
		const lu = elementsDuTableau(entreesToml(CONFIG)!, 'mcp_servers')!;
		expect(lu.enLigne).toBe(false);
		expect(lu.elements.map((e) => e.valeurs)).toEqual([
			{ name: 'autre', command: ['npx', 'serveur'] },
			{ name: 'mnemo', transport: 'stdio', command: '/opt/node', args: ['/d/adaptateurs/cli/main.ts', 'mcp'], env: { CLE: 'valeur' } },
		]);
		const mnemo = lu.elements[1]!;
		const reste = sansPlages(CONFIG, [mnemo]);
		expect(reste).toContain('# le serveur de Mnemo\n\n[tools.mnemo_lire]');
		expect(reste).not.toContain('mnemo"');
		expect(elementsDuTableau(entreesToml('mcp_servers = [{ name = "x" }]\n')!, 'mcp_servers')).toEqual({ elements: [], enLigne: true });
	});

	it('un bloc ajouté à la fin, après une ligne vide', () => {
		expect(avecBlocALaFin('a = 1\n\n\n', '[[b]]\nc = 2\n')).toBe('a = 1\n\n[[b]]\nc = 2\n');
		expect(avecBlocALaFin('', '[[b]]\n')).toBe('[[b]]\n');
	});
});
