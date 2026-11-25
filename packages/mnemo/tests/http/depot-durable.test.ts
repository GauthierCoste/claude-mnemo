import { describe, expect, it } from 'vitest';
import { ROUTES } from '@mnemo/contrat';
import type { ReponseDepotTraiter, ReponseDocuments, SessionVue } from '@mnemo/contrat';
import { empreinteOctets } from '../../src/domaine/empreinte.ts';
import { lireFiche } from '../../src/domaine/fiche.ts';
import { appeler, jusqua, serviceFaux } from '../aides/service-faux.ts';
import type { ContexteService } from '../aides/service-faux.ts';

const octets = (texte: string) => new TextEncoder().encode(texte);

function api(c: ContexteService) {
	const { port, jeton } = c.service;
	return {
		deposer: (vers: string, contenu = 'Compte rendu du 21/11.\n') => appeler(port, 'POST', `${ROUTES.depot}?vers=${encodeURIComponent(vers)}`, { jeton, corps: octets(contenu) }),
		get: (route: string) => appeler(port, 'GET', route, { jeton }),
		post: (route: string, corps: unknown) => appeler(port, 'POST', route, { jeton, corps }),
	};
}

async function lancerArchiviste(c: ContexteService): Promise<SessionVue> {
	const r = await api(c).post(ROUTES.sessions, { profil: 'archiviste', dossier: '' });
	expect(r.statut).toBe(201);
	return (r.corps as { session: SessionVue }).session;
}

const terminalDe = (c: ContexteService, id: string) => c.terminaux.lances.find((t) => t.options.env.MNEMO_SESSION === id)!;

describe('dépôt durable : chaque document déposé a sa fiche source « à traiter »', () => {
	it('sans archiviste : fiche écrite (un commit), visible dans « À traiter » ; la fin du lot dit `en_attente` ; rien n’est lancé ; son lancement reçoit la consigne', async () => {
		const c = await serviceFaux();
		const r = await api(c).deposer('docs/cr.txt');
		expect(r).toMatchObject({ statut: 201, corps: { chemin: 'docs/cr.txt' } });
		const fiche = lireFiche('sources/cr.md', c.dep.fichiers.get('sources/cr.md')!);
		expect(fiche).toMatchObject({ type: 'source', titre: 'cr' });
		expect(fiche.donnees).toMatchObject({ chemin: 'docs/cr.txt', empreinte: empreinteOctets(octets('Compte rendu du 21/11.\n')), type_source: 'inconnue', a_traiter: true });
		expect(c.dep.commits.map((x) => x.message)).toEqual(['mnemo: dépôt sources/cr.md']);
		const documents = (await api(c).get(ROUTES.documents)).corps as ReponseDocuments;
		expect(documents.aTraiter.map((d) => [d.chemin, d.document])).toEqual([['sources/cr.md', 'docs/cr.txt']]);

		const fin = await api(c).post(ROUTES.depotTraiter, { chemins: ['docs/cr.txt'] });
		expect(fin.statut).toBe(200);
		expect(fin.corps).toEqual({ fiches: ['sources/cr.md'], archiviste: 'en_attente' } satisfies ReponseDepotTraiter);
		expect(c.terminaux.lances).toHaveLength(0);

		const archiviste = await lancerArchiviste(c);
		expect(archiviste.objectif).toMatch(/^Traite la fiche source marquée « à traiter »/u);
	});

	it('archiviste qui tourne, 3 fichiers : rien de tapé pendant les dépôts, puis une seule consigne qui nomme les 3', async () => {
		const c = await serviceFaux();
		const archiviste = await lancerArchiviste(c);
		const terminal = terminalDe(c, archiviste.id);
		for (const nom of ['a.txt', 'b.md', 'c.eml']) expect((await api(c).deposer(`docs/${nom}`, `Contenu ${nom}\n`)).statut).toBe(201);
		await new Promise((r) => setTimeout(r, 100));
		expect(terminal.ecrits).toEqual([]);

		const fin = await api(c).post(ROUTES.depotTraiter, { chemins: ['docs/a.txt', 'docs/b.md', 'docs/c.eml'] });
		expect(fin.corps).toEqual({ fiches: ['sources/a.md', 'sources/b.md', 'sources/c.md'], archiviste: 'confie' } satisfies ReponseDepotTraiter);
		expect(await jusqua(() => terminal.ecrits.length > 0, 2000)).toBe(true);
		await new Promise((r) => setTimeout(r, 100));
		expect(terminal.ecrits).toHaveLength(1);
		for (const f of ['sources/a.md', 'sources/b.md', 'sources/c.md']) expect(terminal.ecrits[0]).toContain(`« ${f} »`);
		expect(terminal.ecrits[0]).toMatch(/^Traite les 3 fiches sources/u);
		expect(lireFiche('sources/c.md', c.dep.fichiers.get('sources/c.md')!).donnees['type_source']).toBe('email');
	});

	it('la réponse n’attend jamais la frappe : un dialogue ouvert chez l’archiviste (Échap, puis attente) ne la retarde pas', async () => {
		const c = await serviceFaux();
		const archiviste = await lancerArchiviste(c);
		const terminal = terminalDe(c, archiviste.id);
		// après le lancement (`lanceMs`), comme un vrai hook : un dialogue d'avant le lancement est fermé
		await c.etat.appliquer(archiviste.id, 'arret', Date.now() + 1, { arret: 'notification' });
		expect((await api(c).deposer('docs/lent.txt')).statut).toBe(201);
		const debut = Date.now();
		const fin = await api(c).post(ROUTES.depotTraiter, { chemins: ['docs/lent.txt'] });
		expect(Date.now() - debut).toBeLessThan(500);
		expect(fin.corps).toMatchObject({ archiviste: 'confie' });
		expect(await jusqua(() => terminal.ecrits.some((e) => e.startsWith('Traite la fiche source')), 3000)).toBe(true);
		expect(terminal.ecrits[0]).toBe('\x1b');
	});

	it('fin de lot : documents déjà traités ou inconnus ignorés (`rien`) ; chemins refusés → 400', async () => {
		const c = await serviceFaux();
		await api(c).deposer('docs/x.txt');
		await api(c).post(ROUTES.sourcesMarquerTraite, { chemins: ['sources/x.md'] });
		expect((await api(c).post(ROUTES.depotTraiter, { chemins: ['docs/x.txt', 'docs/inconnu.txt'] })).corps).toEqual({ fiches: [], archiviste: 'rien' });
		for (const corps of [{}, { chemins: [] }, { chemins: 'docs/x.txt' }, { chemins: [3] }, { chemins: ['_mnemo/a.txt'] }, { chemins: ['../a.txt'] }, { chemins: ['docs/x.txt'], autre: 1 }]) {
			expect((await api(c).post(ROUTES.depotTraiter, corps)).statut, JSON.stringify(corps)).toBe(400);
		}
	});

	it('deux fichiers de même nom dans deux dossiers : deux fiches, jamais une écrasée', async () => {
		const c = await serviceFaux();
		await api(c).deposer('alpha/devis.pdf', 'un');
		await api(c).deposer('beta/devis.pdf', 'deux');
		expect(lireFiche('sources/devis.md', c.dep.fichiers.get('sources/devis.md')!).donnees['chemin']).toBe('alpha/devis.pdf');
		expect(lireFiche('sources/devis (2).md', c.dep.fichiers.get('sources/devis (2).md')!).donnees['chemin']).toBe('beta/devis.pdf');
	});
});
