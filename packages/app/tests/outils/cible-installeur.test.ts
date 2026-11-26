import { describe, expect, it } from 'vitest';
import { cibleDeLaMachine, nomProduit } from '../../outils/cible.ts';
import { ErreurConstruction } from '../../outils/erreur.ts';
import { configurationInstalleur, nomInstalleur } from '../../outils/installeur.ts';
import { optionsPlateforme } from '../../outils/options-packager.ts';
import { IDENTIFIANT_APP } from '../../src/domaine/identite-app.ts';

describe('cible de la construction', () => {
	it('macOS : l’architecture de la machine ; Windows : x64 toujours ; ailleurs : refusé', () => {
		expect(cibleDeLaMachine('darwin', 'arm64')).toEqual({ plateforme: 'darwin', arch: 'arm64' });
		expect(cibleDeLaMachine('darwin', 'x64')).toEqual({ plateforme: 'darwin', arch: 'x64' });
		expect(cibleDeLaMachine('win32', 'x64')).toEqual({ plateforme: 'win32', arch: 'x64' });
		expect(cibleDeLaMachine('win32', 'arm64')).toEqual({ plateforme: 'win32', arch: 'x64' });
		expect(() => cibleDeLaMachine('linux', 'x64')).toThrow(ErreurConstruction);
	});

	it('produit du packager : Mnemo.app, ou le dossier Mnemo-win32-x64', () => {
		expect(nomProduit({ plateforme: 'darwin', arch: 'arm64' })).toBe('Mnemo.app');
		expect(nomProduit({ plateforme: 'win32', arch: 'x64' })).toBe('Mnemo-win32-x64');
	});
});

describe('options du packager selon la plateforme', () => {
	it('macOS : identifiant du paquet, catégorie, signature ad hoc ; rien de Windows', () => {
		const options = optionsPlateforme({ plateforme: 'darwin', arch: 'arm64' }, { mode: 'adhoc' });
		expect(options).toMatchObject({ platform: 'darwin', arch: 'arm64', appBundleId: IDENTIFIANT_APP, appCategoryType: 'public.app-category.productivity', osxSign: { identity: '-' } });
		expect(options).not.toHaveProperty('win32metadata');
	});

	it('Windows : x64, métadonnées de Mnemo.exe ; ni signature ni identifiant de paquet macOS', () => {
		const options = optionsPlateforme({ plateforme: 'win32', arch: 'x64' }, { mode: 'adhoc' });
		expect(options).toMatchObject({ platform: 'win32', arch: 'x64', win32metadata: { ProductName: 'Mnemo', FileDescription: 'Mnemo', OriginalFilename: 'Mnemo.exe' } });
		for (const cle of ['osxSign', 'osxNotarize', 'appBundleId', 'appCategoryType']) expect(options).not.toHaveProperty(cle);
	});
});

describe('installeur Windows', () => {
	it('nom : Mnemo-Setup-<version>-x64.exe', () => {
		expect(nomInstalleur('1.8.0')).toBe('Mnemo-Setup-1.8.0-x64.exe');
	});

	it('NSIS à étapes, par utilisateur, dossier modifiable, raccourcis ; même identifiant que l’app ; ni publication ni recompilation', () => {
		const config = configurationInstalleur('1.8.0', '45.4.1', 'C:/icone.ico', 'C:/sortie', 2026);
		expect(config).toMatchObject({
			appId: IDENTIFIANT_APP,
			productName: 'Mnemo',
			copyright: 'Copyright © 2026 Mnemo',
			electronVersion: '45.4.1',
			publish: null,
			npmRebuild: false,
			directories: { output: 'C:/sortie' },
			win: { target: [{ target: 'nsis', arch: ['x64'] }], icon: 'C:/icone.ico' },
			nsis: {
				oneClick: false,
				perMachine: false,
				allowToChangeInstallationDirectory: true,
				createDesktopShortcut: true,
				createStartMenuShortcut: true,
				artifactName: 'Mnemo-Setup-1.8.0-x64.exe',
				installerIcon: 'C:/icone.ico',
				uninstallerIcon: 'C:/icone.ico',
			},
		});
	});
});
