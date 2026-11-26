import { join } from 'node:path';
import { request } from 'node:http';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import { calculsEnCours } from '../../src/adaptateurs/http/calculs-en-cours.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import type { Session } from '../../src/domaine/session.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const UUID = '11111111-2222-4333-8444-555555555555';
const sessionFixe = (id: string): Session => ({
	id,
	profil: 'travail',
	dossier: 'alpha',
	position: 'projets/alpha',
	projet: 'alpha',
	objectif: null,
	etat: 'attend',
	creeeMs: 1000,
	majMs: 1000,
	arretAttendu: null,
	bilanDemandeMs: null,
	commitDebut: null,
	branche: null,
	pid: null,
});

/** Un service dont le compteur des calculs est observé ; `retenir` : la lecture de la session par le hook attend la porte. */
async function service(o: { retenir?: boolean } = {}) {
	const calculs = calculsEnCours();
	const c = await serviceFaux({ calculs });
	await c.etat.creer(sessionFixe(UUID));
	const porte = { ouvrir: (): void => {}, lectureCommencee: false };
	if (o.retenir === true) {
		const ouverte = new Promise<void>((r) => (porte.ouvrir = r));
		const lire = c.etat.lire.bind(c.etat);
		c.etat.lire = async (id) => {
			porte.lectureCommencee = true;
			await ouverte;
			return lire(id);
		};
	}
	return { c, calculs, porte };
}

const poster = (c: ContexteService, corps: unknown) => appeler(c.service.port, 'POST', ROUTES.hook, { jeton: c.service.jeton, corps });
const message = (c: ContexteService) => ({ evenement: 'message', session: UUID, horodatageMs: Date.now(), cwd: join(c.racine, 'alpha'), prompt: 'Où en est le catalogue Alpha ?' });

describe('calculs en cours : une vraie requête au hook', () => {
	it('le hook compté pendant qu’il tourne, plus compté une fois sa réponse rendue ; l’instant du dernier calcul avancé', async () => {
		const { c, calculs, porte } = await service({ retenir: true });
		const avant = calculs.dernierMs();
		const reponse = poster(c, message(c));
		expect(await jusqua(() => porte.lectureCommencee && calculs.enCours() === 1, 3000)).toBe(true);
		porte.ouvrir();
		expect((await reponse).statut).toBe(200);
		expect(await jusqua(() => calculs.enCours() === 0, 2000)).toBe(true);
		expect(calculs.dernierMs()).toBeGreaterThan(avant);
	});

	it('requête refusée (corps invalide) : décompté aussi', async () => {
		const { c, calculs } = await service();
		const r = await poster(c, { evenement: 'inconnu' });
		expect(r.statut).toBe(400);
		expect(calculs.enCours()).toBe(0);
		expect(calculs.dernierMs()).toBeGreaterThan(-Infinity);
	});

	it('connexion abandonnée avant la réponse : décompté quand le hook finit', async () => {
		const { c, calculs, porte } = await service({ retenir: true });
		const { port, jeton } = c.service;
		const texte = JSON.stringify(message(c));
		const req = request({ host: '127.0.0.1', port, path: ROUTES.hook, method: 'POST', agent: false, headers: { host: `127.0.0.1:${port}`, authorization: `Bearer ${jeton}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(texte) } });
		req.on('error', () => {});
		req.end(texte);
		expect(await jusqua(() => porte.lectureCommencee && calculs.enCours() === 1, 3000)).toBe(true);
		req.destroy();
		await new Promise((r) => setTimeout(r, 50));
		porte.ouvrir();
		expect(await jusqua(() => calculs.enCours() === 0, 2000)).toBe(true);
	});

	it('affinage lancé en fond après la réponse : compté tant que le reranker travaille, puis décompté', async () => {
		const { c, calculs } = await service();
		for (const nom of ['tarifs', 'remises', 'devis']) {
			await c.dep.coffre.ecrire(`projets/alpha/${nom}.md`, `---\nid: 01${nom.toUpperCase()}\ntype: note\nupdated: 2026-11-01\n---\n# Catalogue ${nom}\n\nLes ${nom} du catalogue Alpha.\n`);
		}
		await synchroniser(c.dep, SANS_EXTRACTION);
		let liberer = (): void => {};
		const bloque = new Promise<void>((r) => (liberer = r));
		let appele = false;
		c.dep.reranker = {
			noter: async (_requete, textes) => {
				appele = true;
				await bloque;
				return textes.map(() => 0);
			},
		};
		c.modeles.vue = { ...c.modeles.vue, reranker: 'pret' };
		expect((await poster(c, message(c))).statut).toBe(200);
		// la réponse est rendue ; l'affinage attend le reranker : un calcul en cours
		expect(await jusqua(() => appele, 2000)).toBe(true);
		expect(calculs.enCours()).toBe(1);
		liberer();
		expect(await jusqua(async () => (await c.etat.servis(UUID, 1))[0]?.affinage === 'fait', 2000)).toBe(true);
		expect(await jusqua(() => calculs.enCours() === 0, 2000)).toBe(true);
	});
});
