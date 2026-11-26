import { describe, expect, it } from 'vitest';
import { avecVariable, dossierDonneesApp, fichierConfigClaudeDesktop, variable } from '../src/poste.ts';

describe('variables d’environnement', () => {
	const env = { Path: 'C:\\Windows', HOME: '/maison/a' };

	it('Windows : lues sans tenir compte de la casse ; ailleurs, nom exact', () => {
		expect(variable(env, 'PATH', 'win32')).toBe('C:\\Windows');
		expect(variable(env, 'PATH', 'darwin')).toBeUndefined();
	});

	it('Windows : remplacée sous une seule clé, celle déjà présente ; ailleurs, la clé donnée', () => {
		expect(avecVariable(env, 'PATH', 'C:\\Outils', 'win32')).toEqual({ Path: 'C:\\Outils', HOME: '/maison/a' });
		expect(avecVariable({ HOME: '/h' }, 'PATH', 'C:\\Outils', 'win32')).toEqual({ HOME: '/h', PATH: 'C:\\Outils' });
		expect(avecVariable({ Path: 'a', PATH: 'b' }, 'PATH', 'c', 'win32')).toEqual({ PATH: 'c' });
		expect(avecVariable({ PATH: '/usr/bin' }, 'PATH', '/bin', 'darwin')).toEqual({ PATH: '/bin' });
		expect(env).toEqual({ Path: 'C:\\Windows', HOME: '/maison/a' });
	});
});

describe('dossiers de données des apps', () => {
	it('macOS, Windows (%APPDATA%, sinon sous le dossier personnel), ailleurs (XDG)', () => {
		expect(dossierDonneesApp('darwin', '/maison/alice', {}, 'Mnemo')).toBe('/maison/alice/Library/Application Support/Mnemo');
		expect(dossierDonneesApp('win32', 'D:\\Profils\\alice', { AppData: 'D:\\Profils\\alice\\AppData\\Roaming\\' }, 'Mnemo')).toBe('D:\\Profils\\alice\\AppData\\Roaming\\Mnemo');
		expect(dossierDonneesApp('win32', 'D:/Profils/alice', {}, 'Mnemo')).toBe('D:\\Profils\\alice\\AppData\\Roaming\\Mnemo');
		expect(dossierDonneesApp('linux', '/maison/alice', { XDG_CONFIG_HOME: '/conf/' }, 'Mnemo')).toBe('/conf/Mnemo');
	});

	it('la configuration de l’app Claude', () => {
		expect(fichierConfigClaudeDesktop('darwin', '/maison/alice', {})).toBe('/maison/alice/Library/Application Support/Claude/claude_desktop_config.json');
		expect(fichierConfigClaudeDesktop('win32', 'D:\\Profils\\alice', { APPDATA: 'D:\\Roaming' })).toBe('D:\\Roaming\\Claude\\claude_desktop_config.json');
	});
});
