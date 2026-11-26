import { describe, expect, it } from 'vitest';
import type { ProfilEditableVue } from '@mnemo/contrat';
import { basculer, basculerSkill, compterEquipement, suivreSkill } from '../../src/reglages/equipement.ts';

const editable = (m: Partial<ProfilEditableVue>): ProfilEditableVue => ({
	avatar: { forme: 'robot', couleur: 'vert' },
	consigne: null,
	lancement: 'projet',
	hooks: ['debut'],
	skillsMemoire: 'tous',
	plugins: [],
	moteur: 'claude-code',
	modele: '',
	...m,
});

describe('équipement d’un agent', () => {
	it('basculer garde l’ordre de référence, les valeurs inconnues à la fin', () => {
		expect(basculer(['c', 'x'], 'a', true, ['a', 'b', 'c'])).toEqual(['a', 'c', 'x']);
		expect(basculer(['a', 'c'], 'a', false, ['a', 'b', 'c'])).toEqual(['c']);
	});

	it('décocher depuis « toutes » garde les autres ; cocher quand toutes sont retenues ne change rien', () => {
		expect(basculerSkill('tous', 'b', false, ['a', 'b', 'c'])).toEqual(['a', 'c']);
		expect(basculerSkill('tous', 'b', true, ['a', 'b', 'c'])).toBe('tous');
		expect(basculerSkill(['c'], 'a', true, ['a', 'b', 'c'])).toEqual(['a', 'c']);
	});

	it('la liste suit une skill renommée ou supprimée ; « toutes » ne change pas', () => {
		expect(suivreSkill(['a', 'b'], 'a', 'z')).toEqual(['z', 'b']);
		expect(suivreSkill(['a', 'b'], 'a', null)).toEqual(['b']);
		expect(suivreSkill(['a', 'b'], 'a', 'b')).toEqual(['b']);
		expect(suivreSkill('tous', 'a', null)).toBe('tous');
	});

	it('compte comme le service : skills propres, puis de la mémoire sans doublon de nom ; plugins installés avec Claude Code seulement', () => {
		const detail = {
			skillsDuProfil: [{ nom: 'a', description: '' }],
			skillsMemoireDisponibles: [
				{ nom: 'a', description: '' },
				{ nom: 'b', description: '' },
			],
			pluginsInstalles: [{ id: 'p@m', nom: 'p', version: '1', portee: 'utilisateur', skills: [], hooks: false }],
		};
		expect(compterEquipement(editable({ plugins: ['p@m', 'absent@m'] }), detail)).toEqual({ skills: 2, plugins: 1 });
		expect(compterEquipement(editable({ skillsMemoire: [], plugins: ['p@m'], moteur: 'codex' }), detail)).toEqual({ skills: 1, plugins: 0 });
	});
});
