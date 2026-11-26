import type { EvenementInit } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { lireLigneInit } from '../../src/domaine/assistant-lignes.ts';
import { declarationAReprendre, finApresReprise, ligneApresReprise, MESSAGE_REPRISE } from '../../src/domaine/assistant-reprise.ts';

const echec: EvenementInit = { etape: 'mcp', etat: 'echec', message: 'Serveur MCP déclaré avec un autre chemin : …', motif: 'perime' };
const fin = { fin: true as const, racine: '/srv/exemple', ok: false };

describe('déclaration faite pour une autre installation de Mnemo', () => {
	it('lecture : le motif « perime » gardé seulement sur l’échec de la déclaration ; inconnu ou ailleurs : retiré', () => {
		const json = (o: object) => JSON.stringify(o);
		expect(lireLigneInit(json(echec))).toEqual(echec);
		expect(lireLigneInit(json({ ...echec, motif: 'autre' }))).toEqual({ etape: 'mcp', etat: 'echec', message: echec.message });
		expect(lireLigneInit(json({ ...echec, etape: 'commande' }))).toEqual({ etape: 'commande', etat: 'echec', message: echec.message });
		expect(lireLigneInit(json({ ...echec, etat: 'fait' }))).toEqual({ etape: 'mcp', etat: 'fait', message: echec.message });
	});

	it('à reprendre : l’échec de motif « perime » seulement', () => {
		expect(declarationAReprendre(echec)).toBe(true);
		expect(declarationAReprendre({ etape: 'mcp', etat: 'echec', message: 'Claude Code introuvable : …' })).toBe(false);
		expect(declarationAReprendre({ ...echec, etape: 'commande' })).toBe(false);
		expect(declarationAReprendre(fin)).toBe(false);
	});

	it('après la reprise : faite si elle lance ce Mnemo ; sinon l’échec d’origine, sans motif', () => {
		expect(ligneApresReprise(echec, { ok: true, resultat: 'remplace', message: 'x' })).toEqual({ etape: 'mcp', etat: 'fait', message: MESSAGE_REPRISE });
		expect(ligneApresReprise(echec, { ok: true, resultat: 'deja', message: 'x' })).toEqual({ etape: 'mcp', etat: 'fait', message: 'Serveur MCP déjà déclaré.' });
		for (const resultat of ['autre', 'absent'] as const) expect(ligneApresReprise(echec, { ok: true, resultat, message: 'x' })).toEqual({ etape: 'mcp', etat: 'echec', message: echec.message });
		expect(ligneApresReprise(echec, { ok: false, raison: 'claude ne répond pas' })).toEqual({ etape: 'mcp', etat: 'echec', message: `${echec.message} (reprise impossible : claude ne répond pas)` });
	});

	it('fin : ok si plus aucune étape en échec', () => {
		expect(finApresReprise(fin, new Set())).toEqual({ ...fin, ok: true });
		expect(finApresReprise(fin, new Set(['commande']))).toEqual(fin);
		expect(finApresReprise({ ...fin, ok: true }, new Set())).toEqual({ ...fin, ok: true });
	});
});
