import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { emplacementProvisoire, lancementDuPaquet, paquetDeLApp, pathParDefaut } from '../../src/infra/emplacement.ts';

describe('emplacement du Node et du main.ts', () => {
	it('app empaquetée : ceux du dossier de ressources', () => {
		const ressources = join('/Applications', 'Mnemo.app', 'Contents', 'Resources');
		expect(lancementDuPaquet(true, ressources)).toEqual({
			node: join(ressources, 'node', 'bin', 'node'),
			main: join(ressources, 'mnemo', 'src', 'adaptateurs', 'cli', 'main.ts'),
		});
	});

	it('développement : aucun (la configuration les donne)', () => {
		expect(lancementDuPaquet(false, '/ailleurs')).toBeUndefined();
	});

	it('dossier .app de l’app empaquetée', () => {
		expect(paquetDeLApp(join('/Applications', 'Mnemo.app', 'Contents', 'Resources'))).toBe(join('/Applications', 'Mnemo.app'));
	});

	it('jamais un chemin calculé faux : autre disposition, image disque ou translocation : aucun', () => {
		expect(paquetDeLApp(join('/opt', 'Mnemo', 'resources'))).toBeNull();
		expect(paquetDeLApp(join('/Applications', 'Contents', 'Resources'))).toBeNull();
		expect(paquetDeLApp('/Applications/Mnemo/Contents/Resources')).toBeNull();
		expect(paquetDeLApp('/Volumes/Mnemo 1.5.0/Mnemo.app/Contents/Resources')).toBeNull();
		expect(paquetDeLApp('/private/var/folders/ab/T/AppTranslocation/1234/d/Mnemo.app/Contents/Resources')).toBeNull();
		expect(emplacementProvisoire('/Volumes/Mnemo 1.5.0/Mnemo.app/Contents/Resources')).toBe(true);
		expect(emplacementProvisoire('/Applications/Mnemo.app/Contents/Resources')).toBe(false);
	});

	it('PATH par défaut : dossiers habituels devant, sans doublon', () => {
		expect(pathParDefaut('/maison/exemple', '/usr/bin:/bin:/opt/homebrew/bin')).toBe('/maison/exemple/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
		expect(pathParDefaut('/maison/exemple', undefined)).toBe('/maison/exemple/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin');
	});
});
