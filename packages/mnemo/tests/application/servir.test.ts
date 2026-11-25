import { describe, expect, it } from 'vitest';
import type { Carte, CartesCalculees } from '../../src/application/cartes.ts';
import { rendreServi, servir } from '../../src/application/servir.ts';
import { AVERTISSEMENT } from '../../src/domaine/contexte.ts';
import { REGLAGES_PAR_DEFAUT } from '../../src/domaine/reglages.ts';
import { fauxPorts } from '../aides/faux-ports.ts';
import { servirQuestion } from '../aides/servir.ts';

const entete = (type = 'sujet', extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const consigne = (texte: string, portee: string, niveau: string) => `${entete('consigne', `portee: ${portee}\nniveau: ${niveau}\n`)}# C\n\n${texte}\n`;

async function memoire() {
	const dep = fauxPorts();
	await dep.coffre.ecrire('consignes/fr.md', consigne('Réponds en français.', 'globale', 'toujours'));
	await dep.coffre.ecrire('consignes/rappel.md', consigne('Relis la spec avant de coder.', 'globale', 'rappelee'));
	return dep;
}

const carte = (chemin: string, titre: string, surcharge: Partial<Carte> = {}): Carte => ({ chemin, titre, ligne: `Ligne de ${titre}.`, typeFiche: 'sujet', raison: 'perimetre', depuis: null, note: null, encadree: false, empreinte: 'e', ...surcharge });
const calcul = (surcharge: Partial<CartesCalculees> = {}): CartesCalculees => ({ position: null, positionFiche: null, cartes: [], mesure: 'aucune', classement: [], calibree: false, ...surcharge });
const TITRE_PISTES = '## Pistes de Mnemo (lis avec `lire` celles qui servent ta tâche)';

describe('rendreServi', () => {
	it('consignes, fiche de position entière, puis une ligne par carte avec sa raison', () => {
		const texte = rendreServi(
			'## Consignes\n- Réponds en français.',
			calcul({
				position: { chemin: 'projets/vela/vela.md', titre: 'Vela', texte: '# Vela\n\nLe projet Vela.\n', empreinte: 'e1', encadree: false },
				cartes: [carte('projets/vela/avoirs.md', 'Avoirs'), carte('projets/vela/reporting.md', 'Reporting', { typeFiche: 'procedure', raison: 'nommee' })],
			}),
		);
		expect(texte).toBe(
			[
				'## Consignes\n- Réponds en français.',
				'### Vela (projets/vela/vela.md)\n# Vela\n\nLe projet Vela.',
				`${TITRE_PISTES}\n- Avoirs — projets/vela/avoirs.md — Ligne de Avoirs. (sujet, du périmètre)\n- Reporting — projets/vela/reporting.md — Ligne de Reporting. (procedure, nommée)`,
			].join('\n\n'),
		);
		expect(texte).not.toContain('## Fiches servies par Mnemo');
		expect(texte).not.toContain('## Fiches suivantes');
	});

	it('la raison d’une carte de la question est « question »', () => {
		expect(rendreServi('', calcul({ cartes: [carte('a.md', 'A', { raison: 'question' })] }))).toContain('(sujet, question)');
	});

	it('la raison d’une voisine d’une fiche injectée à la main est « liée à <titre> »', () => {
		const texte = rendreServi('', calcul({ cartes: [carte('a.md', 'A', { raison: 'liee', depuis: { chemin: 'p/avoirs.md', titre: 'Avoirs' } })] }));
		expect(texte).toContain('- A — a.md — Ligne de A. (sujet, liée à Avoirs)');
	});

	it('une carte encadrée est dans un bloc <donnees>, précédé une fois de l’avertissement', () => {
		const texte = rendreServi('', calcul({ cartes: [carte('sources/mail.md', 'Mail', { encadree: true }), carte('sources/note.md', 'Note', { encadree: true }), carte('a.md', 'A')] }));
		expect(texte.startsWith(AVERTISSEMENT)).toBe(true);
		expect(texte.split(AVERTISSEMENT)).toHaveLength(2);
		expect(texte).toContain('<donnees source="sources/mail.md">\n- Mail — sources/mail.md — Ligne de Mail. (sujet, du périmètre)\n</donnees>');
		expect(texte).toContain('<donnees source="sources/note.md">');
		expect(texte).not.toContain('<donnees source="a.md">');
	});

	it('les fiches demandées par l’utilisateur, entières, après la fiche de position et avant les cartes ; encadrées si elles citent des documents', () => {
		const texte = rendreServi(
			'',
			calcul({ position: { chemin: 'p.md', titre: 'P', texte: 'Position.', empreinte: 'e0', encadree: false }, cartes: [carte('a.md', 'A')] }),
			[
				{ chemin: 'd.md', titre: 'D', texte: 'Demandée.\n', empreinte: 'e1', encadree: false },
				{ chemin: 'sources/m.md', titre: 'M', texte: 'Mail.', empreinte: 'e2', encadree: true },
			],
		);
		expect(texte.startsWith(AVERTISSEMENT)).toBe(true);
		const [position, demandees, pistes] = ['### P (p.md)', '## Fiches injectées à la demande de l’utilisateur', TITRE_PISTES].map((t) => texte.indexOf(t)) as [number, number, number];
		expect(position).toBeGreaterThan(-1);
		expect(demandees).toBeGreaterThan(position);
		expect(pistes).toBeGreaterThan(demandees);
		expect(texte).toContain('### D (d.md)\nDemandée.');
		expect(texte).toContain('<donnees source="sources/m.md">\n### M (sources/m.md)\nMail.\n</donnees>');
	});

	it('rien à servir et aucune consigne : texte vide', () => {
		expect(rendreServi('', calcul())).toBe('');
	});
});

describe('servir', () => {
	it('les consignes rappelées ne viennent qu’au premier contexte de la session', async () => {
		const dep = await memoire();
		expect((await servirQuestion(dep, '', 'avoirs', true)).texte).toContain('Relis la spec avant de coder.');
		expect((await servirQuestion(dep, '', 'avoirs', false)).texte).not.toContain('Relis la spec avant de coder.');
	});

	it('un message muet en milieu de session ne sert que les consignes', async () => {
		const dep = await memoire();
		const servi = await servir(dep, {
			position: '',
			message: 'merci',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: [],
			moment: 'message',
			muet: 'sans_contenu',
			premier: false,
			fin: Date.now() + 5000,
			rappels: false,
		});
		expect(servi.texte).toBe(servi.consignes);
		expect(servi.texte).toContain('Réponds en français.');
		expect(servi.calcul.cartes).toEqual([]);
		expect(servi.calcul.position).toBeNull();
	});

	it('une fiche demandée est injectée entière, même sur un message muet ; une fiche inconnue de l’index est ignorée', async () => {
		const dep = await memoire();
		await dep.coffre.ecrire('projets/vela/avoirs.md', `${entete()}# Avoirs\n\nLes avoirs du projet Vela.\n`);
		const servi = await servir(dep, {
			position: '',
			message: 'ok',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: ['projets/vela/avoirs.md'],
			moment: 'message',
			muet: 'sans_contenu',
			premier: false,
			fin: Date.now() + 5000,
			rappels: false,
			demandees: ['projets/vela/avoirs.md', 'inconnue.md'],
		});
		expect(servi.demandees.map((f) => f.chemin)).toEqual(['projets/vela/avoirs.md']);
		expect(servi.demandees[0]!.empreinte).not.toBe('');
		expect(servi.texte).toContain('## Fiches injectées à la demande de l’utilisateur');
		expect(servi.texte).toContain('(projets/vela/avoirs.md)\n');
		expect(servi.texte).toContain('Les avoirs du projet Vela.');
		expect(servi.calcul.cartes).toEqual([]);
	});

	it('une fiche demandée est écartée des cartes avant le plafond : elle ne prend la place d’aucune carte', async () => {
		const dep = await memoire();
		const fiche = (titre: string, updated: string, extra = '', corps = '') => `---\nid: 01ABC\ntype: entite\n${extra}updated: ${updated}\n---\n# ${titre}\n\nFiche ${titre}.\n${corps}`;
		await dep.coffre.ecrire('projets/Vela.md', fiche('Vela', '2026-11-01', 'portee: client:Vela\n', '\n## Relations\n- concerne [[Avoirs]]\n- concerne [[Factures]]\n'));
		await dep.coffre.ecrire('projets/Vela/Avoirs.md', fiche('Avoirs', '2026-11-05'));
		await dep.coffre.ecrire('projets/Vela/Factures.md', fiche('Factures', '2026-11-03'));
		dep.reglages = () => ({ ...REGLAGES_PAR_DEFAUT, contexte: { ...REGLAGES_PAR_DEFAUT.contexte, pistesParMessage: 1 } });
		const demande = {
			position: 'projets/Vela',
			message: 'on reprend les écritures',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: [],
			moment: 'message' as const,
			muet: null,
			premier: true,
			fin: Date.now() + 5000,
			rappels: false,
		};
		// sans demande, la plus récente (Avoirs) occupe la seule place
		expect((await servir(dep, demande)).calcul.cartes.map((c) => c.chemin)).toEqual(['projets/Vela/Avoirs.md']);
		const servi = await servir(dep, { ...demande, demandees: ['projets/Vela/Avoirs.md'] });
		expect(servi.demandees.map((f) => f.chemin)).toEqual(['projets/Vela/Avoirs.md']);
		expect(servi.calcul.cartes.map((c) => c.chemin)).toEqual(['projets/Vela/Factures.md']);
	});

	it('la fiche de position et les fiches demandées sont injectées sans leurs faits barrés', async () => {
		const dep = await memoire();
		const corps = (t: string) => `${entete()}# ${t}\n\nSynthèse ${t}.\n\n## Informations\n- [montant] Budget de 10 k€ | src: utilisateur dit ^f-0001\n- [montant] ~~Budget de 8 k€~~ | invalidé 2026-11-02 par ^f-0001 | src: utilisateur dit ^f-0002\n  > « huit »\n`;
		await dep.coffre.ecrire('projets/Vela.md', corps('Vela'));
		await dep.coffre.ecrire('projets/Avoirs.md', corps('Avoirs'));
		const servi = await servir(dep, {
			position: 'projets/Vela',
			message: 'on reprend',
			dejaServies: new Map(),
			dejaLues: new Map(),
			proposees: new Map(),
			ecartes: [],
			moment: 'message',
			muet: null,
			premier: true,
			fin: Date.now() + 5000,
			rappels: false,
			demandees: ['projets/Avoirs.md'],
		});
		expect(servi.calcul.position?.texte).toContain('Budget de 10 k€');
		expect(servi.demandees[0]!.texte).toContain('Budget de 10 k€');
		expect(servi.texte).not.toContain('8 k€');
		expect(servi.texte).not.toContain('« huit »');
	});

	it('rien à servir : texte vide', async () => {
		expect((await servirQuestion(fauxPorts(), '', 'zzz')).texte).toBe('');
	});
});
