import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emplacementProvisoire, lancementDuPaquet, paquetDeLApp, pathParDefaut } from '../../src/infra/emplacement.ts';

describe('emplacement du Node et du main.ts', () => {
	it('app empaquetée : ceux du dossier de ressources', () => {
		const ressources = join('/Applications', 'Mnemo.app', 'Contents', 'Resources');
		expect(lancementDuPaquet(true, ressources, 'darwin')).toEqual({
			node: join(ressources, 'node', 'bin', 'node'),
			main: join(ressources, 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts'),
		});
	});

	it('app empaquetée sous Windows : node.exe à la racine de node/', () => {
		const ressources = join('C:', 'Programmes', 'Mnemo', 'resources');
		expect(lancementDuPaquet(true, ressources, 'win32')).toEqual({
			node: join(ressources, 'node', 'node.exe'),
			main: join(ressources, 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts'),
		});
	});

	it('développement : aucun (la configuration les donne)', () => {
		expect(lancementDuPaquet(false, '/ailleurs')).toBeUndefined();
	});

	it('dossier .app de l’app empaquetée', () => {
		expect(paquetDeLApp(join('/Applications', 'Mnemo.app', 'Contents', 'Resources'), 'darwin')).toBe(join('/Applications', 'Mnemo.app'));
	});

	it('hors de macOS, pas de dossier .app : aucun', () => {
		expect(paquetDeLApp(join('/Applications', 'Mnemo.app', 'Contents', 'Resources'), 'win32')).toBeNull();
	});

	it('jamais un chemin calculé faux : autre disposition, image disque ou translocation : aucun', () => {
		expect(paquetDeLApp(join('/opt', 'Mnemo', 'resources'), 'darwin')).toBeNull();
		expect(paquetDeLApp(join('/Applications', 'Contents', 'Resources'), 'darwin')).toBeNull();
		expect(paquetDeLApp('/Applications/Mnemo/Contents/Resources', 'darwin')).toBeNull();
		expect(paquetDeLApp('/Volumes/Mnemo 1.5.0/Mnemo.app/Contents/Resources', 'darwin')).toBeNull();
		expect(paquetDeLApp('/private/var/folders/ab/T/AppTranslocation/1234/d/Mnemo.app/Contents/Resources', 'darwin')).toBeNull();
		expect(emplacementProvisoire('/Volumes/Mnemo 1.5.0/Mnemo.app/Contents/Resources', 'darwin')).toBe(true);
		expect(emplacementProvisoire('/Applications/Mnemo.app/Contents/Resources', 'darwin')).toBe(false);
		// propre à macOS : jamais détecté sous Windows
		expect(emplacementProvisoire('/Volumes/Mnemo 1.5.0/Mnemo.app/Contents/Resources', 'win32')).toBe(false);
	});

	it('PATH par défaut : dossiers habituels devant, sans doublon', () => {
		expect(pathParDefaut('/maison/exemple', '/usr/bin:/bin:/opt/homebrew/bin')).toBe('/maison/exemple/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
		expect(pathParDefaut('/maison/exemple', undefined)).toBe('/maison/exemple/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
	});

	it('PATH par défaut sous Windows : le Path du processus tel quel, sans doublon ni dossier POSIX', () => {
		expect(pathParDefaut('D:\\Profils\\exemple', 'C:\\Windows;C:\\Git\\cmd;;C:\\Windows', 'win32')).toBe('C:\\Windows;C:\\Git\\cmd');
		expect(pathParDefaut('D:\\Profils\\exemple', undefined, 'win32')).toBe('');
	});
});
