import { describe, expect, it } from 'vitest';
import { extraireCas, rejouerCas } from '../../src/application/banc-contexte.ts';
import type { CasContexte } from '../../src/application/banc-contexte.ts';
import type { EntreeServie, EtatSessions } from '../../src/application/ports.ts';
import { SANS_EXTRACTION, synchroniser } from '../../src/application/synchroniser.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const fiche = (type: string, titre: string, synthese: string, extra = '', corps = '', updated = '2026-11-01') =>
	`---\nid: 01ABC\ntype: ${type}\n${extra}updated: ${updated}\n---\n# ${titre}\n\n${synthese}\n${corps}`;
const relations = (...cibles: string[]) => `\n## Relations\n${cibles.map((c) => `- concerne [[${c}]]`).join('\n')}\n`;

/** Mémoire fictive de `cartes.test.ts` : SVE en position (client:SVE), Corvel (type entité) et son ERP à part. */
async function memoire(options: { synchroniser?: boolean } = {}) {
	const dep = fauxPorts();
	const e = dep.coffre.ecrire;
	await e('organisations/clients/SVE.md', fiche('entite', 'SVE', 'Client photovoltaïque.', 'portee: client:SVE\n', relations('Outil Parcs', 'Sous', 'Ysaline', 'Git', 'Doc SVE', 'Clients')));
	await e('organisations/clients/SVE/Outil Parcs.md', fiche('entite', 'Outil Parcs', 'Outil de suivi des sites du client. Il sert aux chantiers.', '', '', '2026-11-05'));
	await e('organisations/clients/SVE/Sous.md', fiche('entite', 'Sous', 'Un sous-traitant du client.', '', '', '2026-11-03'));
	await e('personnes/Ysaline.md', fiche('personne', 'Ysaline', 'Contact du client.', '', relations('ERP Corvelis'), '2026-11-02'));
	await e('pratiques/Git.md', fiche('pratique', 'Git', 'Pratiques Git.', '', '', '2026-11-04'));
	await e('projets/clients/Corvel/Corvel.md', fiche('entite', 'Corvel', 'Autre client.', 'portee: client:Corvel\n'));
	await e('projets/clients/Corvel/ERP Corvelis.md', fiche('entite', 'ERP Corvelis', 'ERP du client Corvel.'));
	await e('sources/Doc SVE.md', `---\nid: 01SRC\ntype: source\nchemin: docs/doc.md\ntype_source: spec_validee\nupdated: 2026-11-01\n---\n# Doc SVE\n`);
	await e('organisations/clients/clients.md', fiche('dossier', 'Clients', 'Les clients.'));
	if (options.synchroniser !== false) await synchroniser(dep, SANS_EXTRACTION);
	return dep;
}

const POSITION = 'organisations/clients/SVE';
const cas = (c: Partial<CasContexte> & Pick<CasContexte, 'nom' | 'message'>): CasContexte => ({ position: POSITION, premier: false, attendues: [], interdites: [], silence: false, ...c });

const CAS: CasContexte[] = [
	cas({ nom: 'premier message', message: 'Maquette ERP', premier: true, attendues: ['SVE.md', 'Outil Parcs.md'], interdites: ['ERP Corvelis.md', 'Doc SVE.md', 'clients.md'] }),
	cas({ nom: 'acquiescement', message: 'oui vas y pousse', silence: true }),
	// chaque message porteur est classé : le lieu nommé ouvre ses fiches, jamais une source ni un dossier
	cas({ nom: 'fiche nommée', message: 'parle-moi de Corvel', attendues: ['Corvel.md'], interdites: ['Doc SVE.md', 'clients.md'] }),
	cas({ nom: 'notification', message: '<task-notification>fini</task-notification>', silence: true }),
];

describe('rejouerCas', () => {
	it('quatre cas étiquetés : quatre justes, aucune carte indésirable', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), CAS);
		expect(echecs).toEqual([]);
		expect(mesure).toMatchObject({ cas: 4, justes: 4, attenduesProposees: 3, attenduesTotal: 3, indesirables: 0 });
		expect(mesure.caracteres).toBeGreaterThan(0);
	});

	it('une carte interdite proposée compte comme indésirable et fait échouer le cas', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'interdit', message: 'Maquette ERP', premier: true, interdites: ['Outil Parcs.md'] })]);
		expect(mesure).toMatchObject({ cas: 1, justes: 0, indesirables: 1 });
		expect(echecs).toEqual([{ nom: 'interdit', manquees: [], indesirables: ['Outil Parcs.md'] }]);
	});

	it('une attendue non proposée est signalée', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'manquée', message: 'parle-moi de Corvel', attendues: ['Doc SVE.md'] })]);
		expect(mesure).toMatchObject({ justes: 0, attenduesProposees: 0, attenduesTotal: 1 });
		expect(echecs).toEqual([{ nom: 'manquée', manquees: ['Doc SVE.md'], indesirables: [] }]);
	});

	it('un cas silence qui reçoit des cartes compte ces cartes comme indésirables', async () => {
		const { mesure } = await rejouerCas(await memoire(), [cas({ nom: 'bavard', message: 'parle-moi de Corvel', silence: true })]);
		expect(mesure.justes).toBe(0);
		expect(mesure.indesirables).toBeGreaterThan(0);
	});
});

describe('rejouerCas : fiche injectée à la main', () => {
	const injectee = cas({ nom: 'fiche injectée', message: 'prépare la maquette du chantier', injectees: ['Ysaline.md'], attendues: ['ERP Corvelis.md'], interdites: ['Corvel.md'] });

	it('sa voisine d’ailleurs est proposée au message qui part avec elle ; elle-même, injectée entière, n’est ni attendue ni indésirable', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [injectee]);
		expect(echecs).toEqual([]);
		expect(mesure).toMatchObject({ cas: 1, justes: 1, attenduesProposees: 1, attenduesTotal: 1, indesirables: 0 });
	});

	it('sans le geste, la voisine d’ailleurs n’est pas proposée', async () => {
		const { echecs } = await rejouerCas(await memoire(), [{ ...injectee, injectees: [] }]);
		expect(echecs).toEqual([{ nom: 'fiche injectée', manquees: ['ERP Corvelis.md'], indesirables: [] }]);
	});

	it('une injectée inconnue de l’index est signalée, comme une attendue inconnue : le cas échoue', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'injectée absente', message: 'prépare la maquette du chantier', injectees: ['Absente.md'] })]);
		expect(echecs).toEqual([{ nom: 'injectée absente', manquees: ['Absente.md (injectée inconnue)'], indesirables: [] }]);
		expect(mesure).toMatchObject({ cas: 1, justes: 0, attenduesProposees: 0, attenduesTotal: 0 });
	});
});

describe('rejouerCas : premier message muet en cas silence', () => {
	it('la fiche de position injectée n\'est pas indésirable, seules les cartes le sont', async () => {
		const { mesure, echecs } = await rejouerCas(await memoire(), [cas({ nom: 'ok merci', message: 'oui vas y pousse', premier: true, silence: true })]);
		expect(echecs).toEqual([]);
		expect(mesure).toMatchObject({ justes: 1, indesirables: 0 });
		expect(mesure.caracteres).toBeGreaterThan(0);
	});

	it('un message porteur en cas silence : tout ce qui est proposé reste indésirable', async () => {
		const { mesure } = await rejouerCas(await memoire(), [cas({ nom: 'bavard', message: 'parle-moi de Corvel', premier: true, silence: true })]);
		expect(mesure.indesirables).toBeGreaterThan(0);
	});
});

describe('rejouerCas : index non synchronisé', () => {
	it('synchronise d\'abord : un cas silence qui n\'est pas le premier reste juste', async () => {
		const dep = await memoire({ synchroniser: false });
		const { mesure, echecs } = await rejouerCas(dep, [cas({ nom: 'acquiescement', message: 'oui vas y pousse', silence: true })]);
		expect(echecs).toEqual([]);
		expect(mesure.justes).toBe(1);
	});
});

describe('extraireCas', () => {
	const entree = (message: string, horodatageMs: number, position: string | null, muet: EntreeServie['muet'] = null): EntreeServie => ({
		session: 'abcdef1234', moment: 'message', horodatageMs, ids: [], texte: '', ms: 0, sens: false, demande: message, classement: [], muet, cartes: [], position,
	});

	it('reprend la position de chaque entrée, repère le premier message non muet, laisse attendues et interdites vides', async () => {
		const journal = [entree('Maquette ERP', 2, 'organisations/clients/SVE'), entree('oui vas y', 1, null, 'sans_contenu'), entree('parle-moi de Corvel', 3, 'projets/clients/Corvel')];
		const etat = { servis: async () => journal, lire: async () => ({ position: 'autre' }) } as unknown as EtatSessions;
		const cas = await extraireCas(etat, 'abcdef1234');
		expect(cas.map((c) => [c.message, c.position, c.premier])).toEqual([
			['oui vas y', 'autre', false],
			['Maquette ERP', 'organisations/clients/SVE', true],
			['parle-moi de Corvel', 'projets/clients/Corvel', false],
		]);
		expect(cas.every((c) => c.attendues.length === 0 && c.interdites.length === 0 && !c.silence)).toBe(true);
	});

	it('session inconnue et journal vide : erreur lisible', async () => {
		const etat = { servis: async () => [], lire: async () => null } as unknown as EtatSessions;
		await expect(extraireCas(etat, 'inconnue')).rejects.toThrow('Session inconnue');
	});
});
