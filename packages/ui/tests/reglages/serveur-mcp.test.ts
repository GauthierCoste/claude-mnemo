import { describe, expect, it } from 'vitest';
import { demandeDe, ligneDeCommande, SAISIE_VIDE, saisieDe } from '../../src/reglages/serveur-mcp.ts';

describe('saisie d’un serveur MCP de l’app Claude', () => {
	it('arguments un par ligne, lignes vides et espaces autour retirés ; variables NOM=valeur (la valeur peut contenir « = »)', () => {
		const lue = demandeDe({ nom: ' notes ', commande: ' npx ', args: '-y\n\n  serveur-notes \r\n', env: 'CLE_API=abc=def\nVIDE=\n' }, []);
		expect(lue).toEqual({ ok: true, demande: { nom: 'notes', commande: 'npx', args: ['-y', 'serveur-notes'], env: { CLE_API: 'abc=def', VIDE: '' } } });
	});

	it('modification : NOM seul garde la valeur actuelle (null) ; une variable effacée n’est plus envoyée', () => {
		const depart = saisieDe({ nom: 'notes', commande: 'npx', args: ['-y'], env: ['CLE_API', 'AUTRE'], modifiable: true });
		expect(depart).toEqual({ nom: 'notes', commande: 'npx', args: '-y', env: 'CLE_API\nAUTRE' });
		expect(demandeDe({ ...depart, env: 'CLE_API\nNOUVELLE=1' }, ['CLE_API', 'AUTRE'])).toEqual({
			ok: true,
			demande: { nom: 'notes', commande: 'npx', args: ['-y'], env: { CLE_API: null, NOUVELLE: '1' } },
		});
	});

	it('refus : variable sans valeur hors des existantes, nom vide, nom écrit deux fois ; le motif ne cite jamais une valeur', () => {
		expect(demandeDe({ ...SAISIE_VIDE, env: 'CLE' }, [])).toMatchObject({ ok: false, motif: expect.stringContaining('CLE=valeur') });
		const sansNom = demandeDe({ ...SAISIE_VIDE, env: '=secret-123' }, []);
		expect(sansNom.ok).toBe(false);
		expect(JSON.stringify(sansNom)).not.toContain('secret');
		const double = demandeDe({ ...SAISIE_VIDE, env: 'A=secret-1\nA=secret-2' }, []);
		expect(double).toMatchObject({ ok: false, motif: expect.stringContaining('« A »') });
		expect(JSON.stringify(double)).not.toContain('secret');
		// une valeur collée seule (sans « NOM= ») ou un nom invalide : le rang de la ligne, jamais son texte
		for (const env of ['A=1\nsk-secret-123', 'Authorization: Bearer secret=1']) {
			const invalide = demandeDe({ ...SAISIE_VIDE, env }, ['sk-secret-123']);
			expect(invalide).toMatchObject({ ok: false, motif: expect.stringMatching(/ligne \d : nom invalide/u) });
			expect(JSON.stringify(invalide)).not.toMatch(/secret|Bearer/u);
		}
	});

	it('ligne de commande : arguments à espaces entre guillemets', () => {
		expect(ligneDeCommande({ nom: 'x', commande: 'uvx', args: ['outil', '--dossier', 'Mes documents'], env: [], modifiable: true })).toBe('uvx outil --dossier "Mes documents"');
	});
});
