import { describe, expect, it } from 'vitest';
import { estCheminAbsolu, validerConfiguration } from '../../src/domaine/configuration.ts';

const valide = { racine: '/srv/exemple/Mnemo', node: '/usr/local/bin/node', main: '/opt/mnemo/packages/mnemo/src/adaptateurs/cli/main.ts', path: '/usr/bin:/bin' };

describe('configuration de l’app', () => {
	it('valide : rendue telle quelle, port facultatif ; les autres clés ignorées', () => {
		expect(validerConfiguration(valide)).toEqual({ ok: true, configuration: valide });
		expect(validerConfiguration({ ...valide, port: 4747, autre: 1 })).toEqual({ ok: true, configuration: { ...valide, port: 4747 } });
	});

	it('pas un objet : refusée', () => {
		for (const brut of [null, 'texte', [], 3]) expect(validerConfiguration(brut)).toEqual({ ok: false, erreurs: ['La configuration doit être un objet JSON.'] });
	});

	it('chaque clé fautive a sa phrase : chemin manquant, relatif, PATH vide, port hors bornes', () => {
		const r = validerConfiguration({ racine: 'Mnemo', node: '', path: '', port: 70_000 });
		expect(r).toEqual({
			ok: false,
			erreurs: [
				'« racine » doit être un chemin absolu : Mnemo',
				'« node » manque (chemin absolu attendu).',
				'« main » manque (chemin absolu attendu).',
				'« path » manque (le PATH du terminal).',
				'« port » doit être un entier de 0 à 65535.',
			],
		});
		for (const port of [-1, 1.5, '4747']) expect(validerConfiguration({ ...valide, port }).ok).toBe(false);
	});

	it('app empaquetée : node et main viennent du paquet, ceux du fichier sont facultatifs et ignorés', () => {
		const paquet = { node: '/Applications/Mnemo.app/Contents/Resources/node/bin/node', main: '/Applications/Mnemo.app/Contents/Resources/mnemo/src/adaptateurs/cli/main.ts' };
		const sans = { racine: valide.racine, path: valide.path, port: 4747 };
		expect(validerConfiguration(sans, paquet)).toEqual({ ok: true, configuration: { ...sans, ...paquet } });
		expect(validerConfiguration(valide, paquet)).toEqual({ ok: true, configuration: { ...valide, ...paquet } });
		expect(validerConfiguration({ ...sans, node: 'relatif' }, paquet).ok).toBe(true);
		expect(validerConfiguration({ path: valide.path }, paquet)).toEqual({ ok: false, erreurs: ['« racine » manque (chemin absolu attendu).'] });
		expect(validerConfiguration(sans).ok).toBe(false);
	});

	it('chemins absolus : POSIX et Windows', () => {
		expect(estCheminAbsolu('/a')).toBe(true);
		expect(estCheminAbsolu('C:\\a')).toBe(true);
		expect(estCheminAbsolu('c:/a')).toBe(true);
		expect(estCheminAbsolu('a/b')).toBe(false);
		expect(estCheminAbsolu('~/a')).toBe(false);
	});
});
