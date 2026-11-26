import { describe, expect, it } from 'vitest';
import type { MoteurVue, PointMoteurVue } from '@mnemo/contrat';
import { actionDuMoteur, etapesDuCircuit, statutDuMoteur } from '../../src/moteurs/circuit.ts';

const moteur = (poste: PointMoteurVue[]): MoteurVue => ({ id: 'codex', nom: 'Codex', indisponible: null, manuel: false, version: '1.0.0', modeles: [], poste });
const commande: PointMoteurVue = { cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée', detail: '/bin/codex' };
const lier = { texte: 'mnemo init --codex', dans: 'terminal' } as const;

describe('circuit de liaison d’un moteur', () => {
	it('serveur MCP désactivé (laissé) mais hooks à installer : « Lier à Mnemo » quand même, le motif du point bloquant', () => {
		const m = moteur([
			commande,
			{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: false, etat: 'désactivé', detail: 'Désactivé dans Codex.' },
			{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: false, etat: 'non installés', remede: lier },
		]);
		expect(statutDuMoteur(m)).toEqual({ cle: 'a-lier', libelle: 'À lier' });
		expect(actionDuMoteur(m)).toEqual({ etape: 'mcp', titre: 'Serveur MCP mnemo : désactivé.', motif: 'Désactivé dans Codex.', geste: 'lier', commande: lier });
	});

	it('périmé : liaison périmée, le motif du service ; version illisible (inconnue, sans remède) : ne bloque pas', () => {
		const m = moteur([
			commande,
			{ cle: 'version', libelle: 'Version', ok: null, etat: 'illisible' },
			{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: false, etat: 'périmé', detail: 'Déclaré pour un autre Node.', remede: { texte: 'mnemo declarer --moteur codex --remplacer', dans: 'terminal' } },
		]);
		expect(etapesDuCircuit(m).map((e) => e.etat)).toEqual(['ok', 'inconnu', 'casse']);
		expect(actionDuMoteur(m)?.titre).toBe('La liaison de Codex à Mnemo est périmée.');
		expect(actionDuMoteur(m)?.motif).toBe('Déclaré pour un autre Node.');
	});

	it('pas installé : statut « Pas installé », motif sans geste ; tout satisfait : « Prêt », aucune action', () => {
		const absent = moteur([{ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable', detail: 'codex absent du PATH' }]);
		expect(statutDuMoteur(absent).libelle).toBe('Pas installé');
		expect(actionDuMoteur(absent)).toMatchObject({ titre: 'Pas installé sur ce poste.', motif: 'codex absent du PATH', geste: null });
		const pret = moteur([commande, { cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: true, etat: 'déclaré' }]);
		expect(statutDuMoteur(pret).libelle).toBe('Prêt');
		expect(actionDuMoteur(pret)).toBeNull();
	});
});
