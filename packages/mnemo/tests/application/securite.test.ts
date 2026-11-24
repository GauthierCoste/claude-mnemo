import { describe, expect, it } from 'vitest';
import { proposer } from '../../src/application/proposer.ts';
import type { Demande } from '../../src/application/proposer.ts';
import type { TypeSource } from '../../src/domaine/regles.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const consigne = (surcharge = {}): Demande => ({ genre: 'consigne', texte: 'Ne jamais pousser sur main', portee: { genre: 'globale' }, source: { ref: 'dit en séance', type: 'utilisateur' }, ...surcharge });

describe('une consigne ne vient que de l\'utilisateur ou d\'une session', () => {
	it('refuse une consigne tirée d\'un document', async () => {
		const dep = fauxPorts();
		for (const type of ['contrat', 'spec_validee', 'compte_rendu', 'email', 'note', 'deduction', 'inconnue'] as TypeSource[]) {
			const r = await proposer(dep, consigne({ source: { ref: '[[sources/mail]]', type } }));
			expect(r.statut, type).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
		expect(dep.commits).toHaveLength(0);
	});

	it('accepte utilisateur et session', async () => {
		const dep = fauxPorts();
		expect((await proposer(dep, consigne())).statut).toBe('ecrit');
		expect((await proposer(dep, consigne({ texte: 'Autre', source: { ref: 'session s1', type: 'session' } }))).statut).toBe('ecrit');
	});

	it('refuse un texte de consigne qui commence par « # »', async () => {
		const dep = fauxPorts();
		for (const texte of ['# Titre', '## Toujours tester', '  #x']) {
			expect((await proposer(dep, consigne({ texte }))).statut, texte).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
	});
});

describe('le genre fiche ne contourne pas le chemin des consignes', () => {
	it('refuse les types consigne et profil', async () => {
		const dep = fauxPorts();
		for (const type of ['consigne', 'profil'] as const) {
			expect((await proposer(dep, { genre: 'fiche', chemin: `x/${type}.md`, type, titre: 'T' })).statut, type).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
	});

	it('refuse les clés de consigne dans les données', async () => {
		const dep = fauxPorts();
		for (const cle of ['niveau', 'regle', 'portee', 'repetitions']) {
			const r = await proposer(dep, { genre: 'fiche', chemin: 'x/a.md', type: 'sujet', titre: 'T', donnees: { [cle]: 'toujours' } });
			expect(r.statut, cle).toBe('refuse');
		}
		expect(dep.fichiers.size).toBe(0);
	});
});
