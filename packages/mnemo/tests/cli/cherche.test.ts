import { execFile } from 'node:child_process';
import { chmodSync, existsSync, statSync, writeFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { proposer } from '../../src/application/proposer.ts';
import { ouvrirIndex } from '../../src/infra/index-sqlite.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function mnemo(cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: ENV_TEST }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

async function memoireAvecFaits(): Promise<string> {
	const d = await dossierTemporaire();
	await mnemo(d, 'init');
	const dep = dependancesReelles(d);
	try {
		const source = { ref: 'dit en séance', type: 'utilisateur' as const };
		const faits = [
			{ fiche: 'projets/alpha.md', texte: "L'inventaire des machines est fait chaque mois" },
			{ fiche: 'projets/alpha.md', texte: 'La réunion de lancement a lieu en mars' },
			{ fiche: 'clients/beta.md', texte: "L'inventaire du client Beta est annuel" },
		];
		for (const f of faits) {
			const r = await proposer(dep, { genre: 'fait', ...f, titreSiNouvelle: f.fiche, nature: 'declare', source });
			expect(r.statut).toBe('ecrit');
		}
	} finally {
		dep.index.fermer();
	}
	return d;
}

describe('commande mnemo cherche', () => {
	it('trouve un fait, accents et préfixes compris', async () => {
		const d = await memoireAvecFaits();
		const r = await mnemo(d, 'cherche', 'reunion');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^ {2}\d,\d{2} {2}La réunion de lancement a lieu en mars {2}\(.+\)$/mu);
	});

	it('--dossier restreint la recherche', async () => {
		const d = await memoireAvecFaits();
		const tout = await mnemo(d, 'cherche', 'inventaire');
		expect(tout.out).toContain('machines');
		expect(tout.out).toContain('Beta');
		const restreint = await mnemo(d, 'cherche', 'inventaire', '--dossier', 'clients');
		expect(restreint.out).toContain('Beta');
		expect(restreint.out).not.toContain('machines');
	});

	it('une requête avec de la syntaxe FTS5 ne produit pas d\'erreur', async () => {
		const d = await memoireAvecFaits();
		const r = await mnemo(d, 'cherche', '"inventaire*', 'AND', '(l\'inventaire', '-NEAR:');
		expect(r.code).toBe(0);
		expect(r.err).toBe('');
	});

	it('rien trouvé : message, code 0', async () => {
		const d = await memoireAvecFaits();
		const r = await mnemo(d, 'cherche', 'zzzintrouvable');
		expect(r.code).toBe(0);
		expect(r.out).toBe('Rien trouvé.\n');
	});

	it('--contexte : chaque résultat en entier ; un passage avec ses voisins de section, et l\'étendue servie', async () => {
		const d = await memoireAvecFaits();
		const remplissage = (mot: string) => `Le ${mot} est ici. ${'Phrase de remplissage. '.repeat(50)}`;
		writeFileSync(
			join(d, '_mnemo', 'projets', 'manuel.md'),
			`---\nid: 01MAN\ntype: sujet\nupdated: 2026-11-01\n---\n# Manuel\n\n## Journaux\n\n${remplissage('pangolin')}\n\n${remplissage('wombat')}\n\n${remplissage('tatou')}\n`,
		);
		const court = await mnemo(d, 'cherche', 'wombat');
		expect(court.out).not.toContain('pangolin');
		const r = await mnemo(d, 'cherche', 'wombat', '--contexte');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^ {2}\d,\d{2} {2}projets\/manuel\.md#journaux~[0-9a-f]{6} \(passage et ses voisins, 3 passages\)$/mu);
		for (const mot of ['pangolin', 'wombat', 'tatou']) expect(r.out).toContain(`    Le ${mot} est ici.`);
	});

	it('usage : sans texte ou --limite invalide, code 2', async () => {
		const d = await memoireAvecFaits();
		expect((await mnemo(d, 'cherche')).code).toBe(2);
		expect((await mnemo(d, 'cherche', 'a', '--limite', '0')).code).toBe(2);
		expect((await mnemo(d, 'cherche', 'a', '--limite', 'x')).code).toBe(2);
		expect((await mnemo(d, 'cherche', 'a', '--bidule')).code).toBe(2);
		const un = await mnemo(d, 'cherche', 'inventaire', '--limite', '1');
		expect(un.out.trim().split('\n')).toHaveLength(1);
	});
});

describe('commande mnemo index', () => {
	it('synchronise puis compte ; --reconstruire recrée l\'index supprimé', async () => {
		const d = await memoireAvecFaits();
		const fichier = join(d, '.mnemo', 'index.sqlite');
		const r = await mnemo(d, 'index');
		expect(r.code).toBe(0);
		expect(r.out).toMatch(/^\d+ fiches indexées \(0 ajoutées, 0 modifiées, 0 retirées\)\.\nmodèle de sens absent : recherche par les mots\n$/u);
		await rm(fichier);
		const rebuild = await mnemo(d, 'index', '--reconstruire');
		expect(rebuild.code).toBe(0);
		expect(rebuild.out).toMatch(/^\d+ fiches indexées \([1-9]\d* ajoutées, 0 modifiées, 0 retirées\)\.\nmodèle de sens absent : recherche par les mots\n$/u);
		expect(existsSync(fichier)).toBe(true);
		const encore = await mnemo(d, 'index', '--reconstruire');
		expect(encore.out).toMatch(/\([1-9]\d* ajoutées/u);
		expect((await mnemo(d, 'cherche', 'reunion')).out).toContain('réunion');
	});

	it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('signale les fiches illisibles sans échouer', async () => {
		const d = await memoireAvecFaits();
		const fiche = join(d, '_mnemo', 'clients', 'beta.md');
		chmodSync(fiche, 0o000);
		try {
			const r = await mnemo(d, 'index', '--reconstruire');
			expect(r.code).toBe(0);
			expect(r.out).toContain('1 fiche illisible :\n- clients/beta.md : lecture impossible : EACCES');
		} finally {
			chmodSync(fiche, 0o644);
		}
	});

	it('--reconstruire travaille sur place, même si un autre processus tient l\'index ouvert', async () => {
		const d = await memoireAvecFaits();
		const fichier = join(d, '.mnemo', 'index.sqlite');
		const tenu = ouvrirIndex(fichier);
		try {
			const avant = (await tenu.fiches()).length;
			expect(avant).toBeGreaterThan(0);
			const inode = statSync(fichier).ino;
			const r = await mnemo(d, 'index', '--reconstruire');
			expect(r.code).toBe(0);
			expect(r.out).toMatch(new RegExp(`^${avant} fiches indexées \\(${avant} ajoutées, 0 modifiées, 0 retirées\\)\\.\nmodèle de sens absent : recherche par les mots\n$`, 'u'));
			expect(await tenu.fiches()).toHaveLength(avant);
			expect((await tenu.chercher('"reunion"*', {}, 5)).length).toBe(1);
			expect(statSync(fichier).ino).toBe(inode);
			// la connexion tenue voit ce qui est indexé ensuite : c'est bien le même fichier
			writeFileSync(join(d, '_mnemo', 'nouvelle.md'), '# Nouvelle\n\nUne licorne.\n');
			expect((await mnemo(d, 'index')).code).toBe(0);
			expect(await tenu.fiches()).toHaveLength(avant + 1);
		} finally {
			tenu.fermer();
		}
	});

	it('nomme les fiches lues hors de leur forme, à chaque passage, même sans changement', async () => {
		const d = await memoireAvecFaits();
		writeFileSync(join(d, '_mnemo', 'reunion.md'), '---\ntype: Réunion\n---\n# Réunion\n\nLe tarif journalier est revu.\n');
		for (const fois of [1, 2]) {
			const r = await mnemo(d, 'index');
			expect(r.code, `passage ${fois}`).toBe(0);
			expect(r.out).toContain('1 fiche à vérifier (indexée comme texte) :\n- reunion.md : type de fiche mal formé « Réunion »');
		}
		expect((await mnemo(d, 'cherche', 'tarif journalier')).out).toContain('reunion.md');
	});

	it('option inconnue : code 2', async () => {
		const d = await memoireAvecFaits();
		expect((await mnemo(d, 'index', '--bidule')).code).toBe(2);
	});
});

describe('mnemo cherche : passages d\'un document du dossier (câblage réel)', () => {
	it('des documents (Markdown, PDF) référencés par une fiche source sont trouvés par leurs passages, une fois extraits par mnemo index', async () => {
		const d = await memoireAvecFaits();
		const { mkdir, writeFile, copyFile } = await import('node:fs/promises');
		await mkdir(join(d, 'docs'), { recursive: true });
		await writeFile(join(d, 'docs', 'notice.md'), '# Notice\n\nLe tamanoir mange des termites.\n');
		await copyFile(join(import.meta.dirname, '../fixtures/documents/contrat.pdf'), join(d, 'docs', 'contrat.pdf'));
		await mkdir(join(d, '_mnemo', 'sources'), { recursive: true });
		await writeFile(join(d, '_mnemo', 'sources', 'notice.md'), '---\nid: 01N\ntype: source\nchemin: docs/notice.md\ntype_source: spec_validee\nupdated: 2026-11-01\n---\n# Notice\n');
		await writeFile(join(d, '_mnemo', 'sources', 'contrat.md'), '---\nid: 01C\ntype: source\nchemin: docs/contrat.pdf\ntype_source: contrat\nupdated: 2026-11-01\n---\n# Contrat\n');
		// la recherche n'extrait aucun document : elle sert l'index tel quel, et renvoie à mnemo index
		const avant = await mnemo(d, 'cherche', 'tamanoir');
		expect(avant.out).not.toContain('Le tamanoir mange des termites.');
		expect(avant.out).toContain('2 documents changés pas encore réindexés (recherche sur leur ancien texte) : lance « mnemo index ».');
		expect((await mnemo(d, 'index')).code).toBe(0);
		const r = await mnemo(d, 'cherche', 'tamanoir');
		expect(r.out).not.toContain('pas encore réindexé');
		expect(r.code).toBe(0);
		expect(r.out).toContain('Le tamanoir mange des termites.');
		expect(r.out).toMatch(/sources\/notice\.md#p-[0-9a-f]{8}/u);
		const pdf = await mnemo(d, 'cherche', 'contrat');
		expect(pdf.out).toMatch(/sources\/contrat\.md#p-[0-9a-f]{8}/u);
	});
});
