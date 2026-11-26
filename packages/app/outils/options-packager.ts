/**
 * Options de `@electron/packager` propres à la cible : sous macOS, identifiant du paquet, catégorie et signature
 * (`@electron/osx-sign`, `@electron/notarize`) ; sous Windows, les métadonnées de `Mnemo.exe` (ni signature, ni
 * identifiant : celui de l'installeur, `installeur.ts`, est le même `IDENTIFIANT_APP`).
 */
import type { packager } from '@electron/packager';
import { IDENTIFIANT_APP, NOM_APP } from '../src/domaine/identite-app.ts';
import type { Cible } from './cible.ts';
import { DROITS_NODE, estNodeEmporte, type Signature } from './signature.ts';

export type OptionsPackager = Parameters<typeof packager>[0];

/** Options de signature macOS (ad hoc ou Developer ID). */
function optionsSignature(signature: Signature): Pick<OptionsPackager, 'osxSign' | 'osxNotarize'> {
	if (signature.mode === 'adhoc') {
		// pas de compte Apple Developer : identité « - » ; un échec arrête la construction
		return { osxSign: { identity: '-', identityValidation: false, continueOnError: false, preAutoEntitlements: false, optionsForFile: () => ({ hardenedRuntime: false }) } };
	}
	return {
		osxSign: {
			identity: signature.identite,
			continueOnError: false,
			preAutoEntitlements: false,
			// les autres fichiers : droits par défaut d'Electron (runtime renforcé) ; le Node emporté : ceux de V8 hors d'Electron
			optionsForFile: (chemin) => (estNodeEmporte(chemin) ? { hardenedRuntime: true, entitlements: DROITS_NODE } : {}),
		},
		...(signature.notarisation === null ? {} : { osxNotarize: signature.notarisation }),
	};
}

/** Options de la plateforme : `signature` ne sert que sous macOS. */
export function optionsPlateforme(cible: Cible, signature: Signature): Partial<OptionsPackager> {
	if (cible.plateforme === 'darwin') {
		return { platform: 'darwin', arch: cible.arch, appBundleId: IDENTIFIANT_APP, appCategoryType: 'public.app-category.productivity', ...optionsSignature(signature) };
	}
	return {
		platform: 'win32',
		arch: cible.arch,
		win32metadata: { CompanyName: NOM_APP, FileDescription: NOM_APP, ProductName: NOM_APP, InternalName: NOM_APP, OriginalFilename: `${NOM_APP}.exe` },
	};
}
