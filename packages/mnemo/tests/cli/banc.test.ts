import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { lireQuestions } from '../../src/adaptateurs/cli/banc.ts';
import { proposer } from '../../src/application/proposer.ts';
import { piecesPourPlateforme } from '../../src/infra/modeles/catalogue.ts';
import { dossierPiece } from '../../src/infra/modeles/installer.ts';
import { pidVivant } from '../../src/infra/modeles/serveurs.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function mnemo(cwd: string, ...args: string[]): Promise<{ code: number; out: string; err: string }> {
	return new Promise((resoudre) => {
		execFile(process.execPath, [MAIN, ...args], { cwd, env: { ...ENV_TEST, TMPDIR: cwd } }, (erreur, out, err) => {
			resoudre({ code: erreur ? (erreur.code as number) : 0, out, err });
		});
	});
}

const FAUX_LLAMA = join(import.meta.dirname, '../aides/faux-llama.mjs');
const attendre = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function attendreQue(condition: () => boolean, delaiMs = 20_000): Promise<void> {
	const fin = Date.now() + delaiMs;
	while (Date.now() < fin) {
		if (condition()) return;
		await attendre(50);
	}
	throw new Error('condition jamais remplie');
}
const serveursLances: number[] = [];
afterEach(() => {
	// filet : aucun faux serveur laissé derrière, même si le test échoue
	while (serveursLances.length > 0) {
		try {
			process.kill(serveursLances.pop()!, 'SIGKILL');
		} catch {
			/* déjà mort */
		}
	}
});

const CLES = ['variante', 'presentsDans5', 'total', 'mrr', 'doublonsDans10', 'egalitesEnTete', 'echecsUnSeulDe', 'msMoyen', 'modelesAbsents', 'parGenre'];

describe('lireQuestions', () => {
	it('lit la section recherche, et refuse une question mal formée en la nommant', () => {
		expect(lireQuestions('recherche:\n  - question: a b\n    attendus: [x.md]\n    genre: mots\n    position: projets/p\n')).toEqual([
			{ question: 'a b', attendus: ['x.md'], genre: 'mots', position: 'projets/p' },
		]);
		expect(lireQuestions('recherche:\n  - question: a b\n    attendus: [x.md]\n    perimetre: projets\n    unSeulDe: [s/a.md, s/b.md]\n')).toEqual([
			{ question: 'a b', attendus: ['x.md'], perimetre: 'projets', unSeulDe: ['s/a.md', 's/b.md'] },
		]);
		expect(() => lireQuestions('recherche:\n  - question: a\n    attendus: [x.md]\n    unSeulDe: x.md\n')).toThrow(/question 1.*unSeulDe/u);
		expect(() => lireQuestions('recherche: []\n')).toThrow(/aucune question/u);
		expect(() => lireQuestions('autre: 1\n')).toThrow(/recherche/u);
		expect(() => lireQuestions('recherche:\n  - question: a\n')).toThrow(/question 1.*attendus/u);
		expect(() => lireQuestions('recherche:\n  - question: ""\n    attendus: [x.md]\n')).toThrow(/question 1/u);
		expect(() => lireQuestions('recherche:\n  - question: a\n    attendus: [x.md]\n    position: 3\n')).toThrow(/question 1.*position/u);
		expect(() => lireQuestions('recherche: [\n')).toThrow(/YAML/u);
	});
});

describe('commande mnemo banc', () => {
	it('sans argument : le corpus d\'essai, copié dans un dossier temporaire puis supprimé ; JSON stable', async () => {
		const d = await dossierTemporaire();
		const r = await mnemo(d, 'banc', '--json');
		expect(r.err).toBe('');
		expect(r.code).toBe(0);
		const sortie = JSON.parse(r.out) as { questions: number; resultats: Record<string, unknown>[] };
		expect(Object.keys(sortie)).toEqual(['questions', 'resultats']);
		expect(sortie.questions).toBeGreaterThanOrEqual(35);
		expect(sortie.resultats.map((v) => v['variante'])).toEqual(['mots', '+ sens', '+ reranker', '+ graphe', '+ position', 'référence sans moteur']);
		for (const v of sortie.resultats) {
			expect(Object.keys(v)).toEqual(CLES);
			expect(v['total']).toBe(sortie.questions);
			expect(Object.keys(v['parGenre'] as object)).toEqual(['confiance', 'contexte', 'doublons', 'flexion', 'graphe', 'long-texte', 'mots', 'paraphrase', 'saturation', 'texte-libre']);
		}
		// aucun modèle dans les tests : les variantes à modèles le disent
		expect(sortie.resultats[1]!['modelesAbsents']).toEqual(['sens']);
		expect(sortie.resultats[2]!['modelesAbsents']).toEqual(['sens', 'reranker']);
		// mots seuls : le banc trouve les questions de mots, pas les paraphrases
		const mots = sortie.resultats[0]!;
		expect((mots['parGenre'] as Record<string, { presentsDans5: number }>)['paraphrase']!.presentsDans5).toBe(0);
		expect((mots['presentsDans5'] as number)).toBeGreaterThan(10);
		// le texte libre des fiches (passages `fiche.md#section`) est trouvé par les mots seuls
		const texteLibre = (mots['parGenre'] as Record<string, { presentsDans5: number; total: number }>)['texte-libre']!;
		expect(texteLibre.presentsDans5).toBe(texteLibre.total);
		// le dossier temporaire est supprimé
		expect(readdirSync(d)).toEqual([]);

		// une seconde exécution rend les mêmes mesures (hors durées)
		const encore = JSON.parse((await mnemo(d, 'banc', '--json')).out) as typeof sortie;
		const sansDurees = (s: typeof sortie) => s.resultats.map(({ msMoyen: _, ...reste }) => reste);
		expect(sansDurees(encore)).toEqual(sansDurees(sortie));
	}, 60_000);

	it('tableau lisible : une ligne par variante, la référence en dernier, puis le détail par genre', async () => {
		const d = await dossierTemporaire();
		const r = await mnemo(d, 'banc');
		expect(r.code).toBe(0);
		const lignes = r.out.split('\n');
		expect(lignes[0]).toMatch(/^variante\s+présents dans 5\s+MRR\s+doublons dans 10\s+égalités en tête\s+copies en trop\s+ms moyen$/u);
		const rangs = ['mots', '+ sens', '+ reranker', '+ graphe', '+ position', 'référence sans moteur'].map((v) => lignes.findIndex((l) => l.startsWith(v)));
		expect(rangs.every((x, i) => x > 0 && (i === 0 || x > rangs[i - 1]!))).toBe(true);
		expect(r.out).toContain('+ sens (sans sens)');
		expect(r.out).toContain('+ graphe (sans sens ni reranker)');
		expect(r.out).not.toContain('mots seuls');
		// même libellé dans le détail par genre
		const parGenre = r.out.slice(r.out.indexOf('Par genre'));
		expect(parGenre).toMatch(/^\+ reranker \(sans sens ni reranker\)\s+\d+ \/ \d+/mu);
		expect(r.out).toMatch(/^mots\s+\d+ \/ \d+\s+0\.\d{3}\s+\d+\s+\d+\s+\d+\s+\d+$/mu);
		expect(r.out).toMatch(/^Par genre/mu);
		expect(r.out).toMatch(/paraphrase/u);
	}, 60_000);

	it('avec un fichier de questions : sur la mémoire courante', async () => {
		const d = await dossierTemporaire();
		await mnemo(d, 'init');
		const dep = dependancesReelles(d);
		try {
			const r = await proposer(dep, {
				genre: 'fait', fiche: 'projets/alpha.md', texte: "L'inventaire des machines est fait chaque mois",
				titreSiNouvelle: 'Alpha', nature: 'declare', source: { ref: 'dit en séance', type: 'utilisateur' },
			});
			expect(r.statut).toBe('ecrit');
		} finally {
			dep.index.fermer();
		}
		writeFileSync(join(d, 'q.yaml'), 'recherche:\n  - question: inventaire\n    genre: mots\n    attendus: [projets/alpha.md#^f-0001]\n  - question: rien\n    attendus: [projets/alpha.md#^f-0009]\n');
		const r = await mnemo(join(d, '_mnemo'), 'banc', '../q.yaml', '--json');
		expect(r.err).toBe('');
		const sortie = JSON.parse(r.out) as { questions: number; resultats: { variante: string; presentsDans5: number; mrr: number; parGenre: object }[] };
		expect(sortie.questions).toBe(2);
		expect(sortie.resultats[0]).toMatchObject({ variante: 'mots', presentsDans5: 1, mrr: 0.5 });
		expect(Object.keys(sortie.resultats[0]!.parGenre)).toEqual(['autre', 'mots']);
		expect(sortie.resultats.at(-1)).toMatchObject({ variante: 'référence sans moteur', presentsDans5: 1 });
	}, 30_000);

	it('erreurs : option inconnue (code 2), fichier absent, hors mémoire', async () => {
		const d = await dossierTemporaire();
		expect((await mnemo(d, 'banc', '--bidule')).code).toBe(2);
		expect((await mnemo(d, 'banc', 'a.yaml', 'b.yaml')).code).toBe(2);
		await mnemo(d, 'init');
		const absent = await mnemo(d, 'banc', 'absent.yaml');
		expect(absent.code).toBe(1);
		expect(absent.err).toMatch(/absent\.yaml/u);
		const hors = await dossierTemporaire();
		writeFileSync(join(hors, 'q.yaml'), 'recherche:\n  - question: a\n    attendus: [x.md]\n');
		const r = await mnemo(hors, 'banc', 'q.yaml');
		expect(r.code).toBe(1);
		expect(r.err).toMatch(/mémoire/u);
	});

	it('interrompu (Ctrl-C) : serveur de modèle arrêté, dossier temporaire supprimé, code 130', async () => {
		const d = await dossierTemporaire();
		const modeles = await dossierTemporaire();
		// faux modèle de sens « installé », lent à répondre : le banc est encore en train de vectoriser quand on l'interrompt
		const piece = piecesPourPlateforme(process.platform, process.arch)!.find((p) => p.nom === 'sens')!;
		const dossier = dossierPiece(modeles, piece);
		mkdirSync(dossier, { recursive: true });
		writeFileSync(join(dossier, '.empreinte'), `${piece.sha256}\n`);
		writeFileSync(join(dossier, piece.fichier), '');
		writeFileSync(join(dossier, `${piece.fichier}.faux.json`), JSON.stringify({ delaiMs: 5000 }));
		const journal = join(dossier, 'lancements.log');
		const enfant = spawn(process.execPath, [MAIN, 'banc'], {
			cwd: d,
			env: { ...ENV_TEST, TMPDIR: d, MNEMO_MODELES: modeles, MNEMO_LLAMA_SERVEUR: FAUX_LLAMA },
			stdio: 'ignore',
		});
		const fin = new Promise<number | null>((r) => enfant.on('exit', (code) => r(code)));
		const pids = () => (existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean).map((l) => (JSON.parse(l) as { pid: number }).pid) : []);
		// le serveur de sens est lancé et le dossier temporaire existe
		await attendreQue(() => pids().length > 0 && readdirSync(d).some((n) => n.startsWith('mnemo-banc-')));
		serveursLances.push(...pids());
		await attendre(500);
		enfant.kill('SIGINT');
		expect(await fin).toBe(130);
		expect(readdirSync(d).filter((n) => n.startsWith('mnemo-banc-'))).toEqual([]);
		await attendreQue(() => pids().every((pid) => !pidVivant(pid)), 10_000);
	}, 60_000);
});
