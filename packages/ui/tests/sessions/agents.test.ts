import { PROFIL_ARCHIVISTE, PROFIL_TRAVAIL } from '@mnemo/commun';
import type { MoteurVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { ecartCirculaire, etatDuMoteur, etiquetteDuProfil, placeDansScene, resumeDeLaSession, texteHooks } from '../../src/sessions/agents.ts';

const moteur = (m: Partial<MoteurVue>): MoteurVue => ({ id: 'mistral-vibe', nom: 'Mistral Vibe', indisponible: null, manuel: false, version: '3.1.5', modeles: [], ...m });

describe('agents de la Nouvelle session', () => {
	it('place dans la scène : écart circulaire au choisi, voisins de chaque côté, les autres loin', () => {
		expect([0, 1, 2, 3, 4].map((j) => ecartCirculaire(j, 0, 5))).toEqual([0, 1, 2, -2, -1]);
		expect([0, 1].map((j) => ecartCirculaire(j, 1, 2))).toEqual([-1, 0]);
		expect([0, 3, -3].map(placeDansScene)).toEqual(['0', 'loin', 'loin']);
	});

	it('étiquette : par défaut (travail), personnalisé, intégré', () => {
		expect(etiquetteDuProfil({ nom: PROFIL_TRAVAIL, personnalise: true })).toBe('par défaut');
		expect(etiquetteDuProfil({ nom: 'redaction', personnalise: true })).toBe('personnalisé');
		expect(etiquetteDuProfil({ nom: PROFIL_ARCHIVISTE, personnalise: false })).toBe('intégré');
	});

	it('hooks en clair : tous, ou les libellés dans l’ordre canonique', () => {
		expect(texteHooks(['fin', 'message', 'outil', 'apres_outil', 'arret', 'debut'])).toBe('tous');
		expect(texteHooks(['fin', 'debut', 'arret'])).toBe('Début, Arrêt, Fin');
		expect(texteHooks([])).toBe('aucun');
	});

	it('état du moteur : vérification, prêt, à lier (bloque, avec « Lier »), introuvable (bloque), ligne à coller, à approuver (n’empêche pas)', () => {
		expect(etatDuMoteur(undefined, true, null)).toEqual({ genre: 'verification' });
		expect(etatDuMoteur(undefined, false, 'refus')).toEqual({ genre: 'illisible', motif: 'refus' });
		expect(etatDuMoteur(moteur({}), true, null)).toEqual({ genre: 'verification' });
		// vérification du poste en échec : jamais « lié »
		expect(etatDuMoteur(moteur({}), false, 'délai dépassé')).toEqual({ genre: 'illisible', motif: 'délai dépassé' });
		expect(etatDuMoteur(moteur({ poste: [{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée' }] }), false, null)).toEqual({ genre: 'pret' });
		const aLier = moteur({
			poste: [
				{ cle: 'commande', libelle: 'Commande', ok: true, etat: 'trouvée' },
				{ cle: 'mcp', libelle: 'Serveur MCP mnemo', ok: false, etat: 'non déclaré', remede: { texte: 'mnemo declarer --moteur mistral-vibe --lier', dans: 'terminal' } },
			],
		});
		expect(etatDuMoteur(aLier, false, null)).toEqual({ genre: 'bloque', raison: 'Lancement impossible : Mistral Vibe n’est pas lié à Mnemo.', lignes: ['Serveur MCP mnemo : non déclaré'], lier: true });
		expect(etatDuMoteur(moteur({ indisponible: 'Mistral Vibe introuvable sur ce poste (vibe).' }), false, null)).toMatchObject({ genre: 'bloque', raison: 'Lancement impossible ici : Mistral Vibe introuvable sur ce poste (vibe).', lier: false });
		expect(etatDuMoteur(moteur({ id: 'claude-code', nom: 'Claude Code', indisponible: 'introuvable', manuel: true }), false, null)).toEqual({ genre: 'manuel' });
		const aApprouver = moteur({ id: 'codex', nom: 'Codex', poste: [{ cle: 'approbation', libelle: 'Approbation des hooks', ok: false, etat: 'à approuver', remede: { texte: '/hooks', dans: 'moteur' } }] });
		expect(etatDuMoteur(aApprouver, false, null)).toMatchObject({ genre: 'attention', titre: 'Hooks à approuver dans Codex.' });
	});

	it('résumé du pied : agent, fournisseur et modèle, lieu', () => {
		expect(resumeDeLaSession({ nom: 'revue', moteur: 'codex', modele: 'gpt-6.2-sol', lancement: 'projet' }, 'clients/alpha', 'Developer')).toBe('revue · OpenAI gpt-6.2-sol · dans alpha');
		expect(resumeDeLaSession({ nom: PROFIL_TRAVAIL, moteur: 'claude-code', modele: '', lancement: 'projet' }, '', 'Developer')).toBe(`${PROFIL_TRAVAIL} · Anthropic modèle par défaut · dans Developer`);
		expect(resumeDeLaSession({ nom: 'notes', moteur: 'claude-code', modele: '', lancement: 'memoire' }, 'api', 'Developer')).toBe('notes · Anthropic modèle par défaut · dans la mémoire');
	});
});
