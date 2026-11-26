import { describe, expect, it } from 'vitest';
import { argumentsHdiutil, nomDmg } from '../../outils/dmg.ts';
import { ErreurConstruction } from '../../outils/erreur.ts';
import { decrireSignature, estNodeEmporte, signatureDepuisEnv } from '../../outils/signature.ts';

const ID = 'Developer ID Application: Exemple (ABCDE12345)';

describe('signature de la construction', () => {
	it('sans MNEMO_SIGNATURE (ou « - ») : ad hoc', () => {
		expect(signatureDepuisEnv({})).toEqual({ mode: 'adhoc' });
		expect(signatureDepuisEnv({ MNEMO_SIGNATURE: '-' })).toEqual({ mode: 'adhoc' });
		expect(signatureDepuisEnv({ MNEMO_SIGNATURE: '', APPLE_ID: 'x' })).toEqual({ mode: 'adhoc' });
		expect(decrireSignature({ mode: 'adhoc' })).toContain('ad hoc');
	});

	it('Developer ID : notarisation par profil, mot de passe d’app ou clé d’API ; sans variable, non notarisée', () => {
		expect(signatureDepuisEnv({ MNEMO_SIGNATURE: ID, MNEMO_NOTARISATION_PROFIL: 'mnemo' })).toEqual({ mode: 'developerId', identite: ID, notarisation: { keychainProfile: 'mnemo' } });
		expect(signatureDepuisEnv({ MNEMO_SIGNATURE: ID, APPLE_ID: 'a@exemple.test', APPLE_APP_SPECIFIC_PASSWORD: 'p', APPLE_TEAM_ID: 'T' })).toEqual({
			mode: 'developerId',
			identite: ID,
			notarisation: { appleId: 'a@exemple.test', appleIdPassword: 'p', teamId: 'T' },
		});
		expect(signatureDepuisEnv({ MNEMO_SIGNATURE: ID, APPLE_API_KEY: '/k.p8', APPLE_API_KEY_ID: 'K', APPLE_API_ISSUER: 'I' })).toMatchObject({ notarisation: { appleApiKey: '/k.p8', appleApiKeyId: 'K', appleApiIssuer: 'I' } });
		const sans = signatureDepuisEnv({ MNEMO_SIGNATURE: ID });
		expect(sans).toEqual({ mode: 'developerId', identite: ID, notarisation: null });
		expect(decrireSignature(sans)).toContain('non notarisée');
	});

	it('jeu de variables incomplet : la construction s’arrête', () => {
		expect(() => signatureDepuisEnv({ MNEMO_SIGNATURE: ID, APPLE_ID: 'a@exemple.test' })).toThrow(ErreurConstruction);
		expect(() => signatureDepuisEnv({ MNEMO_SIGNATURE: ID, APPLE_API_KEY: '/k.p8', APPLE_API_ISSUER: 'I' })).toThrow(/APPLE_API_KEY_ID/u);
	});

	it('le Node emporté, reconnu à sa place dans le paquet', () => {
		expect(estNodeEmporte('/x/Mnemo.app/Contents/Resources/node/bin/node')).toBe(true);
		expect(estNodeEmporte('/x/Mnemo.app/Contents/MacOS/Mnemo')).toBe(false);
		expect(estNodeEmporte('/x/Mnemo.app/Contents/Resources/mnemo/node_modules/.bin/node')).toBe(false);
	});
});

describe('image disque', () => {
	it('nom et arguments de hdiutil', () => {
		expect(nomDmg('Mnemo', '1.5.0', 'arm64')).toBe('Mnemo-1.5.0-arm64.dmg');
		expect(argumentsHdiutil('Mnemo 1.5.0', '/tmp/prep', '/d/Mnemo-1.5.0-arm64.dmg')).toEqual(['create', '-volname', 'Mnemo 1.5.0', '-srcfolder', '/tmp/prep', '-fs', 'HFS+', '-format', 'UDZO', '-ov', '-quiet', '/d/Mnemo-1.5.0-arm64.dmg']);
	});
});
