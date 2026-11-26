import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { ReglagesVue } from '@mnemo/contrat';
import { appeler, serviceFaux } from '../aides/service-faux.ts';

const fichier = (racine: string) => join(racine, '.mnemo', 'reglages.json');
const valeur = (v: ReglagesVue, cle: string) => v.champs.find((c) => c.cle === cle)?.valeur;

describe('routes : réglages', () => {
	it('GET : tous les champs, groupés, avec défaut, valeur, explication et effet', async () => {
		const c = await serviceFaux();
		const r = await appeler(c.service.port, 'GET', ROUTES.reglages, { jeton: c.service.jeton });
		expect(r.statut).toBe(200);
		const vue = r.corps as ReglagesVue;
		expect(vue.avertissements).toEqual([]);
		expect(vue.enAttente).toEqual([]);
		// dans l'ordre de CHAMPS_REGLAGES, puis les règles de la mémoire (SCHEMA.md) : seuil, répétitions, 3 poids, 9 fiabilités
		expect(vue.champs.map((x) => x.groupe)).toEqual([
			...Array<string>(8).fill('contexte'),
			'entrainement',
			'archiviste',
			...Array<string>(8).fill('recherche'),
			'projets',
			'modeles',
			'service',
			'service',
			'interface',
			...Array<string>(14).fill('memoire'),
		]);
		expect(vue.champs.find((x) => x.cle === 'service.port')).toMatchObject({ defaut: 4747, valeur: 4747, effet: 'service', min: 1024, max: 65535 });
		expect(vue.champs.find((x) => x.cle === 'modeles.inactiviteMinutes')).toMatchObject({ defaut: 15, valeur: 15, unite: 'minutes', effet: 'modeles' });
	});

	it('GET : un fichier invalide donne les défauts et ses avertissements', async () => {
		const c = await serviceFaux();
		await mkdir(join(c.racine, '.mnemo'), { recursive: true });
		await writeFile(fichier(c.racine), JSON.stringify({ modeles: { inactiviteMinutes: 999 } }));
		const vue = (await appeler(c.service.port, 'GET', ROUTES.reglages, { jeton: c.service.jeton })).corps as ReglagesVue;
		expect(valeur(vue, 'modeles.inactiviteMinutes')).toBe(15);
		expect(vue.avertissements).toEqual([expect.stringContaining('modeles.inactiviteMinutes')]);
	});

	it('PUT : valide, enregistre (écarts au défaut seulement), null rétablit ; le port changé attend un redémarrage', async () => {
		const c = await serviceFaux();
		const put = (valeurs: Record<string, unknown>) => appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps: { valeurs } });
		const r = await put({ 'modeles.inactiviteMinutes': 30, 'service.port': 4800, 'service.navigateur': 'brave' });
		expect(r.statut).toBe(200);
		const vue = r.corps as ReglagesVue;
		expect(valeur(vue, 'modeles.inactiviteMinutes')).toBe(30);
		expect(vue.enAttente).toEqual(['service.port']);
		expect(JSON.parse(readFileSync(fichier(c.racine), 'utf8'))).toEqual({ modeles: { inactiviteMinutes: 30 }, service: { port: 4800, navigateur: 'brave' } });
		const retour = await put({ 'service.port': null, 'modeles.inactiviteMinutes': null });
		expect((retour.corps as ReglagesVue).enAttente).toEqual([]);
		expect(JSON.parse(readFileSync(fichier(c.racine), 'utf8'))).toEqual({ service: { navigateur: 'brave' } });
	});

	it('PUT : ne réécrit que les champs envoyés ; entrées inconnues et invalides non touchées gardées', async () => {
		const c = await serviceFaux();
		await mkdir(join(c.racine, '.mnemo'), { recursive: true });
		await writeFile(fichier(c.racine), JSON.stringify({ modeles: { inactiviteMinutes: 999 }, futur: { option: 'x' }, contexte: { cartesNommees: 9, nouveau: 1 } }));
		const r = await appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps: { valeurs: { 'service.navigateur': 'brave', 'contexte.cartesNommees': null } } });
		expect(r.statut).toBe(200);
		expect(JSON.parse(readFileSync(fichier(c.racine), 'utf8'))).toEqual({ modeles: { inactiviteMinutes: 999 }, futur: { option: 'x' }, contexte: { nouveau: 1 }, service: { navigateur: 'brave' } });
		// ses avertissements restent visibles après l'enregistrement
		expect((r.corps as ReglagesVue).avertissements).toEqual(expect.arrayContaining([expect.stringContaining('modeles.inactiviteMinutes'), expect.stringContaining('futur')]));
	});

	it('port fixé par MNEMO_PORT : signalé, jamais « redémarrage requis »', async () => {
		const c = await serviceFaux({}, { portFixePar: 'MNEMO_PORT' });
		const r = await appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps: { valeurs: { 'service.port': 4800 } } });
		const vue = r.corps as ReglagesVue;
		expect(vue.enAttente).toEqual([]);
		expect(vue.champs.find((x) => x.cle === 'service.port')?.fixePar).toBe('MNEMO_PORT');
		expect(vue.champs.find((x) => x.cle === 'modeles.inactiviteMinutes')?.fixePar).toBeUndefined();
	});

	it('PUT : une valeur invalide refuse tout le lot (400 avec les motifs), rien n’est écrit', async () => {
		const c = await serviceFaux();
		const put = (corps: unknown) => appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps });
		const r = await put({ valeurs: { 'modeles.inactiviteMinutes': 30, 'contexte.cartesNommees': 99 } });
		expect(r.statut).toBe(400);
		expect((r.corps as { erreur: string }).erreur).toContain('contexte.cartesNommees');
		for (const corps of [{}, { valeurs: [] }, { valeurs: { 'x.y': 1 } }, { valeurs: {}, autre: 1 }]) expect((await put(corps)).statut, JSON.stringify(corps)).toBe(400);
		expect(existsSync(fichier(c.racine))).toBe(false);
	});

	it('protections : jeton exigé, origine étrangère refusée, comme toute route d’écriture', async () => {
		const c = await serviceFaux();
		const corps = { valeurs: { 'modeles.inactiviteMinutes': 30 } };
		expect((await appeler(c.service.port, 'GET', ROUTES.reglages)).statut).toBe(401);
		expect((await appeler(c.service.port, 'PUT', ROUTES.reglages, { corps })).statut).toBe(401);
		expect((await appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: 'faux', corps })).statut).toBe(401);
		const etranger = await appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps, entetes: { origin: 'http://evil.example' } });
		expect(etranger.statut).toBe(403);
		const hote = await appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps, host: 'evil.example' });
		expect(hote.statut).toBe(403);
		expect(existsSync(fichier(c.racine))).toBe(false);
		const memeOrigine = await appeler(c.service.port, 'PUT', ROUTES.reglages, { jeton: c.service.jeton, corps, entetes: { origin: `http://127.0.0.1:${c.service.port}` } });
		expect(memeOrigine.statut).toBe(200);
	});
});
