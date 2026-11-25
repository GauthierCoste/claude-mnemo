import type { SessionVue } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { destinationDeSession, grouperSessions } from '../../src/sessions/groupes.ts';

function session(id: string, dossier: string, creeeMs: number, e: Partial<SessionVue> = {}): SessionVue {
	return { id, profil: 'travail', dossier, position: '', projet: dossier, objectif: id, etat: 'travaille', creeeMs, majMs: creeeMs, bilanDemandeMs: null, commitDebut: null, branche: 'main', terminal: true, dialogueOuvert: false, dossierNonRattache: null, niveauModeles: null, ...e };
}

describe('grouperSessions', () => {
	it('par dossier, dans l’ordre de création ; terminées et archiviste exclues ; racine nommée', () => {
		const groupes = grouperSessions(
			[
				session('c', 'erp-saas', 30),
				session('a', 'api', 10),
				session('b', 'erp-saas', 20),
				session('t', 'erp-saas', 5, { etat: 'terminee' }),
				session('arch', '', 1, { profil: 'archiviste' }),
				session('r', '', 40),
			],
			'Developer',
		);
		expect(groupes.map((g) => [g.cle, g.titre, g.sessions.map((s) => s.id)])).toEqual([
			['api', 'api', ['a']],
			['erp-saas', 'erp-saas', ['b', 'c']],
			['', 'Developer', ['r']],
		]);
	});

	it('aucune session → aucun groupe', () => {
		expect(grouperSessions([session('t', 'x', 1, { etat: 'terminee' })], 'R')).toEqual([]);
	});
});

describe('destinationDeSession', () => {
	it('terminée → tiroir des terminées (archiviste compris) ; archiviste vivant → son tiroir ; sinon la grille', () => {
		expect(destinationDeSession(session('t', 'x', 1, { etat: 'terminee' }))).toBe('terminees');
		expect(destinationDeSession(session('a', '', 1, { profil: PROFIL_ARCHIVISTE, etat: 'terminee' }))).toBe('terminees');
		expect(destinationDeSession(session('a', '', 1, { profil: PROFIL_ARCHIVISTE, etat: 'attend' }))).toBe('archiviste');
		expect(destinationDeSession(session('v', 'x', 1, { profil: 'redaction', etat: 'en_pause' }))).toBe('grille');
	});
});
