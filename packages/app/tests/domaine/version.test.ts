import { describe, expect, it } from 'vitest';
import { comparerVersions, estPageDeVersion, INTERVALLE_VERIFICATION_MS, lireDerniereVersion, versionAAnnoncer, verificationDue } from '../../src/domaine/version.ts';

const PAGE = 'https://github.com/GauthierCoste/claude-mnemo/releases/tag/v1.6.0';

describe('versions', () => {
	it('comparaison : SemVer, « v » toléré, nombres comparés comme des nombres', () => {
		expect(comparerVersions('1.5.0', '1.5.0')).toBe(0);
		expect(comparerVersions('v1.5.0', '1.5.0')).toBe(0);
		expect(comparerVersions('1.10.0', '1.9.9')).toBeGreaterThan(0);
		expect(comparerVersions('1.5.0', '2.0.0')).toBeLessThan(0);
		expect(comparerVersions('1.5.1', '1.5.0')).toBeGreaterThan(0);
		expect(comparerVersions('1.5.0+build.7', '1.5.0')).toBe(0);
	});

	it('préversions : avant la version publiée ; identifiants numériques avant les autres', () => {
		expect(comparerVersions('1.6.0-beta.1', '1.6.0')).toBeLessThan(0);
		expect(comparerVersions('1.6.0', '1.6.0-rc.1')).toBeGreaterThan(0);
		expect(comparerVersions('1.6.0-beta.2', '1.6.0-beta.10')).toBeLessThan(0);
		expect(comparerVersions('1.6.0-alpha', '1.6.0-beta')).toBeLessThan(0);
		expect(comparerVersions('1.6.0-1', '1.6.0-alpha')).toBeLessThan(0);
		expect(comparerVersions('1.6.0-beta', '1.6.0-beta.1')).toBeLessThan(0);
		expect(comparerVersions('1.6.0-rc.1', '1.5.9')).toBeGreaterThan(0);
	});

	it('version illisible : la plus petite', () => {
		expect(comparerVersions('n’importe quoi', '0.0.1')).toBeLessThan(0);
		expect(comparerVersions('1.5', '0.0.1')).toBeLessThan(0);
		expect(comparerVersions('x', 'y')).toBe(0);
	});

	it('réponse de l’API : tag et page du dépôt ; brouillon, préversion, autre lien ou forme : rien', () => {
		expect(lireDerniereVersion({ tag_name: 'v1.6.0', html_url: PAGE, draft: false, prerelease: false })).toEqual({ version: '1.6.0', url: PAGE });
		expect(lireDerniereVersion({ tag_name: 'v1.6.0', html_url: PAGE, prerelease: true })).toBeNull();
		expect(lireDerniereVersion({ tag_name: 'v1.6.0', html_url: PAGE, draft: true })).toBeNull();
		expect(lireDerniereVersion({ tag_name: 'v1.6.0-rc.1', html_url: PAGE })).toBeNull();
		expect(lireDerniereVersion({ tag_name: 'v1.6.0', html_url: 'https://exemple.test/releases/tag/v1.6.0' })).toBeNull();
		expect(lireDerniereVersion({ tag_name: 'derniere', html_url: PAGE })).toBeNull();
		expect(lireDerniereVersion({ message: 'Not Found' })).toBeNull();
		expect(lireDerniereVersion(null)).toBeNull();
		expect(lireDerniereVersion([])).toBeNull();
		expect(estPageDeVersion(`${PAGE} x`)).toBe(false);
		expect(estPageDeVersion('https://github.com/GauthierCoste/claude-mnemo/releases/../../../autre/depot')).toBe(false);
		expect(estPageDeVersion('https://github.com/GauthierCoste/claude-mnemo/releases/%2E%2E/%2E%2E/autre')).toBe(false);
	});

	it('annoncée seulement si plus récente', () => {
		const publiee = { version: '1.6.0', url: PAGE };
		expect(versionAAnnoncer('1.5.0', publiee)).toBe(publiee);
		expect(versionAAnnoncer('1.6.0', publiee)).toBeNull();
		expect(versionAAnnoncer('1.7.0', publiee)).toBeNull();
		expect(versionAAnnoncer('1.5.0', null)).toBeNull();
	});

	it('une recherche par jour au plus, jamais si le réglage est coupé', () => {
		const t = 1_000_000_000_000;
		expect(verificationDue(true, null, t)).toBe(true);
		expect(verificationDue(false, null, t)).toBe(false);
		expect(verificationDue(true, t - INTERVALLE_VERIFICATION_MS + 1, t)).toBe(false);
		expect(verificationDue(true, t - INTERVALLE_VERIFICATION_MS, t)).toBe(true);
		// horloge reculée : on ne reste pas muet des jours
		expect(verificationDue(true, t + 1000, t)).toBe(true);
	});
});
