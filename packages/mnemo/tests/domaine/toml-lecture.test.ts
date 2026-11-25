import { describe, expect, it } from 'vitest';
import { avecBlocALaFin, avecPlagesRemplacees, sansPlages } from '../../src/domaine/moteurs/toml-edition.ts';
import { elementsDuTableau, entreesToml, LitteralToml } from '../../src/domaine/moteurs/toml-lecture.ts';

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

	it('BOM en tête (éditeur sous Windows) : sauté, les places restent celles du texte, et un retrait le garde', () => {
		const texte = '\uFEFF[[b]]\nc = 1\n[[b]]\nc = 2\n';
		const entrees = entreesToml(texte)!;
		expect(entrees[0]).toMatchObject({ genre: 'tableau', cle: ['b'], debut: 1 });
		expect(entrees[1]).toMatchObject({ genre: 'valeur', cle: ['c'], valeur: new LitteralToml('1') });
		expect(sansPlages(texte, elementsDuTableau(entrees, 'b')!.elements[0]!.plages)).toBe('\uFEFF[[b]]\nc = 2\n');
		expect(entreesToml('\uFEFFmodel = "x"\n')![0]).toMatchObject({ cle: ['model'], valeur: 'x', debut: 1 });
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
		expect(mnemo.plages).toHaveLength(1);
		const reste = sansPlages(CONFIG, mnemo.plages);
		expect(reste).toContain('# le serveur de Mnemo\n\n[tools.mnemo_lire]');
		expect(reste).not.toContain('mnemo"');
		expect(elementsDuTableau(entreesToml('mcp_servers = [{ name = "x" }]\n')!, 'mcp_servers')).toEqual({ elements: [], enLigne: true });
	});

	it('un bloc ajouté à la fin, après une ligne vide, puis retiré : le texte d’avant', () => {
		expect(avecBlocALaFin('a = 1\n\n\n', '[[b]]\nc = 2\n')).toBe('a = 1\n\n[[b]]\nc = 2\n');
		expect(avecBlocALaFin('', '[[b]]\n')).toBe('[[b]]\n');
		const avec = avecBlocALaFin('a = 1\n', '[[b]]\nc = 2\n');
		expect(sansPlages(avec, elementsDuTableau(entreesToml(avec)!, 'b')!.elements[0]!.plages)).toBe('a = 1\n');
	});

	it('sous-table écrite après une autre table : une plage à part, la table du milieu jamais touchée', () => {
		const texte = '[[mcp_servers]]\nname = "mnemo"\ncommand = "n"\n\n[tools.bash]\npermission = "never"\n\n[mcp_servers.env]\nA = "1"\n';
		const element = elementsDuTableau(entreesToml(texte)!, 'mcp_servers')!.elements[0]!;
		expect(element.valeurs).toEqual({ name: 'mnemo', command: 'n', env: { A: '1' } });
		expect(element.plages).toHaveLength(2);
		expect(sansPlages(texte, element.plages)).toBe('[tools.bash]\npermission = "never"\n');
		expect(avecPlagesRemplacees(texte, element.plages, '[[mcp_servers]]\nname = "mnemo"\n')).toBe('[[mcp_servers]]\nname = "mnemo"\n\n[tools.bash]\npermission = "never"\n');
		// sous-table qui suit son élément : une seule plage
		const contigu = '[[m]]\na = 1\n[m.env]\nB = "2"\n';
		expect(elementsDuTableau(entreesToml(contigu)!, 'm')!.elements[0]!.plages).toEqual([{ debut: 0, fin: contigu.length }]);
	});

	it('fichier en CRLF : blocs ajoutés en CRLF, retirés sans laisser de LF', () => {
		const texte = '[[hooks]]\r\nname = "moi"\r\n';
		const avec = avecBlocALaFin(texte, '[[hooks]]\nname = "mnemo"\n');
		expect(avec).toBe('[[hooks]]\r\nname = "moi"\r\n\r\n[[hooks]]\r\nname = "mnemo"\r\n');
		const mnemo = elementsDuTableau(entreesToml(avec)!, 'hooks')!.elements[1]!;
		expect(sansPlages(avec, mnemo.plages)).toBe(texte);
		expect(avecPlagesRemplacees(avec, mnemo.plages, '[[hooks]]\nname = "autre"\n')).toBe('[[hooks]]\r\nname = "moi"\r\n\r\n[[hooks]]\r\nname = "autre"\r\n');
	});
});
