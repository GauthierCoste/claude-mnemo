import { describe, expect, it } from 'vitest';
import { racineDuMot, racinesDe, racinesDeRequete } from '../../src/domaine/racines.ts';

describe('racines françaises (Snowball)', () => {
	it('ramène les formes fléchies d\'un mot à une même racine, sans accents', () => {
		expect(racineDuMot('déployer')).toBe('deploi');
		expect(racineDuMot('déploiement')).toBe('deploi');
		expect(racineDuMot('déploiements')).toBe('deploi');
		expect(racineDuMot('configurer')).toBe('configur');
		expect(racineDuMot('Configuration')).toBe('configur');
	});

	it('ne racinise ni les mots courts, ni les mots vides, ni les nombres, ni les identifiants de code, ni les sigles', () => {
		for (const mot of ['api', 'vps', 'pour', 'dans', '2026', 'v2', 'deploy_sh', 'deployScript', 'src/deploy.ts', 'HTTPS', 'a.b']) expect(racineDuMot(mot), mot).toBeNull();
	});

	it('racinesDe : les racines du texte, dans l\'ordre, répétitions comprises ; identifiants et mots courts laissés au texte exact', () => {
		expect(racinesDe('Le déploiement et le déploiement')).toBe('deploi deploi');
		expect(racinesDe('Lancer deploy_sh puis src/deploy.ts, ou deployScript (v2) pour l\'API.')).toBe('lanc puis');
		expect(racinesDe('mise-à-jour de l\'installation')).toBe('mis jour install');
		expect(racinesDe('')).toBe('');
	});

	it('racinesDeRequete : mot de la recherche (minuscules, sans accents) → racine du mot écrit', () => {
		const racines = racinesDeRequete('Quand déployer deploy_sh en production ?');
		expect(racines.get('deployer')).toBe('deploi');
		expect(racines.get('production')).toBe('product');
		// un identifiant n'a pas de racine, ni aucun de ses morceaux
		expect(racines.has('deploy')).toBe(false);
		expect(racines.has('sh')).toBe(false);
	});
});
