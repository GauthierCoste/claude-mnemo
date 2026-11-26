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

	it('version trop ancienne : « À mettre à jour », le motif du service, sans geste', () => {
		const m = moteur([commande, { cle: 'version', libelle: 'Version', ok: false, etat: '0.1.0', detail: 'Version 0.2 au moins : mets Codex à jour.' }]);
		expect(statutDuMoteur(m).libelle).toBe('À mettre à jour');
		expect(actionDuMoteur(m)).toEqual({ etape: 'version', titre: 'Version : 0.1.0.', motif: 'Version 0.2 au moins : mets Codex à jour.', geste: null, commande: null });
	});

	it('approbation inconnue : avec remède, « À vérifier » et la commande à copier ; sans remède, ne bloque pas', () => {
		const approbation = (remede?: PointMoteurVue['remede']): PointMoteurVue => ({ cle: 'approbation', libelle: 'Approbation des hooks', ok: null, etat: 'inconnue', ...(remede ? { remede } : {}) });
		const avec = moteur([commande, approbation({ texte: '/hooks', dans: 'moteur' })]);
		expect(statutDuMoteur(avec)).toEqual({ cle: 'a-verifier', libelle: 'À vérifier' });
		expect(etapesDuCircuit(avec).map((e) => e.etat)).toEqual(['ok', 'casse']);
		expect(actionDuMoteur(avec)).toMatchObject({ titre: 'Approbation des hooks inconnue dans Codex.', geste: 'copier', commande: { texte: '/hooks', dans: 'moteur' } });
		const sans = moteur([commande, approbation()]);
		expect(statutDuMoteur(sans).libelle).toBe('Prêt');
		expect(etapesDuCircuit(sans).map((e) => e.etat)).toEqual(['ok', 'inconnu']);
		expect(actionDuMoteur(sans)).toBeNull();
	});

	it('sans points du poste : « Prêt » s’il est disponible, sinon « Pas installé » (manuel compris) ; aucun circuit ni action', () => {
		const sans = (indisponible: string | null, manuel: boolean): MoteurVue => ({ id: 'claude-code', nom: 'Claude Code', indisponible, manuel, version: null, modeles: [] });
		expect(statutDuMoteur(sans(null, false)).libelle).toBe('Prêt');
		expect(statutDuMoteur(sans('Claude Code introuvable.', true)).libelle).toBe('Pas installé');
		expect(statutDuMoteur(sans('Codex trop ancien.', false)).libelle).toBe('Pas installé');
		expect(etapesDuCircuit(sans(null, false))).toEqual([]);
		expect(actionDuMoteur(sans('Claude Code introuvable.', true))).toBeNull();
	});

	it('commande introuvable maintenant : « Introuvable », pas « Pas installé »', () => {
		const m = moteur([{ cle: 'commande', libelle: 'Commande', ok: false, etat: 'introuvable maintenant', detail: 'Le service lance encore /bin/codex.' }]);
		expect(statutDuMoteur(m)).toEqual({ cle: 'introuvable', libelle: 'Introuvable' });
		expect(actionDuMoteur(m)?.titre).toBe('Codex introuvable maintenant.');
	});

	it('mémoire périmée et hooks absents : « Lier à Mnemo », liaison périmée, la commande de la mémoire en repli', () => {
		const remplacer = { texte: 'mnemo declarer --moteur codex --remplacer', dans: 'terminal' } as const;
		const m = moteur([
			commande,
			{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: false, etat: 'périmé', detail: 'Déclaré pour un autre Node.', remede: remplacer },
			{ cle: 'hooks', libelle: 'Hooks de Mnemo', ok: false, etat: 'non installés', remede: lier },
		]);
		expect(statutDuMoteur(m).libelle).toBe('À lier');
		expect(etapesDuCircuit(m).map((e) => e.etat)).toEqual(['ok', 'casse', 'attente']);
		expect(actionDuMoteur(m)).toEqual({ etape: 'mcp', titre: 'La liaison de Codex à Mnemo est périmée.', motif: 'Déclaré pour un autre Node.', geste: 'lier', commande: remplacer });
	});
});
