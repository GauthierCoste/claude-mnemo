import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { lireCasContexte, lireOptionsContexte } from '../../src/adaptateurs/cli/banc-contexte.ts';
import { enregistrerCas } from '../../src/adaptateurs/cli/banc-juger.ts';
import { bilanPrejugementEnTexte, commandePrejuger, prejugerLeBanc } from '../../src/adaptateurs/cli/banc-prejuger.ts';
import { ErreurCli } from '../../src/adaptateurs/cli/erreurs.ts';
import type { CasContexte, Prejugement } from '../../src/application/banc-contexte.ts';
import type { Juge } from '../../src/application/prejuger.ts';
import type { Executer } from '../../src/application/ports.ts';
import type { MessageAJuger } from '../../src/domaine/consigne-juge.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

const cas = (nom: string, chemins: string[], extra: Partial<CasContexte> = {}): CasContexte => ({
	nom,
	position: 'projets/Vitrail',
	message: `message ${nom}`,
	premier: false,
	attendues: [],
	interdites: [],
	silence: false,
	session: 'abcdef1234',
	rang: Number(nom.slice(1)),
	candidates: chemins.map((chemin) => ({ chemin, titre: `titre ${chemin}`, ligne: `ligne ${chemin}`, listes: ['sens'], signaux: {} })),
	jugements: {},
	...extra,
});
const PROPOSITION: Prejugement = { jugement: 'non_pertinente', confiance: 0.7, raison: 'autre sujet' };
const toutes = (m: MessageAJuger) => Object.fromEntries(m.candidates.map((c) => [c.chemin, PROPOSITION]));
const lire = (fichier: string) => lireCasContexte(readFileSync(fichier, 'utf8'));

async function banc(depart: CasContexte[]): Promise<string> {
	const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
	await enregistrerCas(fichier, depart);
	return fichier;
}

describe('enregistrerCas', () => {
	it('en échec, aucun fichier provisoire ne reste', async () => {
		const dossier = await dossierTemporaire();
		const fichier = join(dossier, 'banc-contexte.json');
		// un dossier non vide à la place du fichier : le renommage échoue
		await mkdir(join(fichier, 'plein'), { recursive: true });
		await expect(enregistrerCas(fichier, [cas('m1', ['a.md'])])).rejects.toThrow();
		expect(readdirSync(dossier)).toEqual(['banc-contexte.json']);
	});
});

describe('mnemo banc contexte --prejuger : options', () => {
	it('--prejuger, avec --nombre et --json ; refusé avec une autre action, --par-session ou --empreintes', () => {
		expect(lireOptionsContexte(['--prejuger'])).toMatchObject({ prejuger: true, nombre: null });
		expect(lireOptionsContexte(['--prejuger', '--nombre', '10', '--json'])).toMatchObject({ prejuger: true, nombre: 10, json: true });
		expect(() => lireOptionsContexte(['--prejuger', '--juger'])).toThrow(/ne vont pas ensemble/u);
		expect(() => lireOptionsContexte(['--prejuger', '--extraire'])).toThrow(/ne vont pas ensemble/u);
		expect(() => lireOptionsContexte(['--prejuger', '--par-session', '2'])).toThrow(/--par-session ne va qu'avec --extraire/u);
		expect(() => lireOptionsContexte(['--prejuger', '--empreintes', 'garder'])).toThrow(/--empreintes ne va pas avec --prejuger/u);
		expect(() => lireOptionsContexte(['--prejuger', '--gestes'])).toThrow(/--gestes/u);
		expect(() => lireOptionsContexte(['--nombre', '3'])).toThrow(/--nombre ne va qu'avec --extraire ou --prejuger/u);
	});
});

describe('prejugerLeBanc', () => {
	it('écrit les propositions de chaque message dans le fichier, sous le verrou, sans écraser un jugement fait entre-temps', async () => {
		const depart = [cas('m1', ['a.md', 'b.md']), cas('m2', ['c.md']), cas('m3', ['d.md'], { valideLe: 'v', jugements: { 'd.md': 'pertinente' } })];
		const fichier = await banc(depart);
		const syntheses: string[] = [];
		const juge: Juge = {
			juger: async (m) => {
				syntheses.push(...m.candidates.map((c) => c.synthese));
				expect(existsSync(`${fichier}.verrou`)).toBe(true);
				// pendant que le juge travaille sur m2, l'utilisateur juge m1 à la main (comme le fera le service)
				if (m.message === 'message m2') {
					// une fois les propositions de m1 écrites (l'écriture du service passe après celles du banc, jamais en même temps)
					while (lire(fichier)[0]!.prejugements === undefined) await new Promise((r) => setTimeout(r, 2));
					const relus = lire(fichier);
					relus[0] = { ...relus[0]!, jugements: { 'a.md': 'pertinente' } };
					await enregistrerCas(fichier, relus);
				}
				return toutes(m);
			},
		};
		const bilan = await prejugerLeBanc(fichier, { juge, synthese: (chemin) => `synthèse ${chemin}` });
		expect(bilan).toEqual({ juges: 2, echecs: 0, restants: 0, motifs: [] });
		expect(syntheses.sort()).toEqual(['synthèse a.md', 'synthèse b.md', 'synthèse c.md']);
		const apres = lire(fichier);
		expect(apres[0]!.prejugements).toEqual({ 'a.md': PROPOSITION, 'b.md': PROPOSITION });
		expect(apres[0]!.jugements).toEqual({ 'a.md': 'pertinente' });
		expect(apres[1]!.prejugements).toEqual({ 'c.md': PROPOSITION });
		expect(apres[2]).toEqual(depart[2]);
		expect(existsSync(`${fichier}.verrou`)).toBe(false);
	});

	it('refusé si le fichier des jugements est ouvert par une autre commande', async () => {
		const fichier = await banc([cas('m1', ['a.md'])]);
		// un processus vivant (le parent de ce test) tient le verrou
		await writeFile(`${fichier}.verrou`, JSON.stringify({ pid: process.ppid, operation: '--juger', depuis: 'x' }));
		const juge: Juge = { juger: async () => expect.unreachable() };
		await expect(prejugerLeBanc(fichier, { juge, synthese: () => '' })).rejects.toThrow(/ouvert par « mnemo banc contexte --juger »/u);
	});

	it('bilan en mots : rien à faire, échecs avec leurs motifs, arrêt', () => {
		expect(bilanPrejugementEnTexte({ juges: 0, echecs: 0, restants: 0, motifs: [] }, 'f.json')).toMatch(/Aucun message à pré-juger/u);
		const texte = bilanPrejugementEnTexte({ juges: 3, echecs: 1, restants: 2, motifs: ['claude -p a échoué (code 1) : quota'] }, 'f.json');
		expect(texte).toContain('3 message(s) pré-jugé(s), 1 en échec, 2 non faits (arrêté)');
		expect(texte).toContain('échec : claude -p a échoué (code 1) : quota');
		expect(texte).toMatch(/Relancez --prejuger/u);
		expect(texte).toMatch(/qu'une fois validées/u);
	});
});

describe('commandePrejuger', () => {
	it('lance le juge Claude par l\'exécuteur, deux messages à la fois au plus, et rend le bilan en JSON', async () => {
		const fichier = await banc([cas('m1', ['a.md']), cas('m2', ['b.md']), cas('m3', ['c.md'])]);
		// un `claude` trouvé (MNEMO_CLAUDE : un fichier qui existe), jamais lancé : l'exécuteur est factice
		vi.stubEnv('MNEMO_CLAUDE', fichier);
		let enCours = 0;
		let maximum = 0;
		const entrees: string[] = [];
		const executer: Executer = async (_commande, args, options) => {
			enCours++;
			maximum = Math.max(maximum, enCours);
			entrees.push(options?.entree ?? '');
			await new Promise((r) => setTimeout(r, 5));
			enCours--;
			const chemin = /chemin : (\S+)/u.exec(options?.entree ?? '')![1]!;
			expect(args).toContain('--strict-mcp-config');
			return { code: 0, sortie: JSON.stringify({ is_error: false, result: JSON.stringify({ jugements: [{ chemin, jugement: 'pertinente', confiance: 0.95, raison: 'oui' }] }) }), erreur: '' };
		};
		const sortie = vi.spyOn(console, 'log').mockImplementation(() => {});
		await commandePrejuger(fichier, { nombre: null, json: true, synthese: () => 'courte' }, executer);
		expect(JSON.parse(String(sortie.mock.calls[0]![0]))).toEqual({ juges: 3, echecs: 0, restants: 0, motifs: [] });
		expect(maximum).toBe(2);
		expect(entrees.every((e) => e.includes('synthèse : courte'))).toBe(true);
		expect(lire(fichier).map((c) => c.prejugements)).toEqual([
			{ 'a.md': { jugement: 'pertinente', confiance: 0.95, raison: 'oui' } },
			{ 'b.md': { jugement: 'pertinente', confiance: 0.95, raison: 'oui' } },
			{ 'c.md': { jugement: 'pertinente', confiance: 0.95, raison: 'oui' } },
		]);
	});

	it('claude introuvable : erreur claire, rien n\'est écrit', async () => {
		const fichier = await banc([cas('m1', ['a.md'])]);
		vi.stubEnv('MNEMO_CLAUDE', join(fichier, 'absent'));
		const erreur = await commandePrejuger(fichier, { nombre: null, json: true, synthese: () => '' }, async () => expect.unreachable()).catch((e: unknown) => e);
		expect(erreur).toBeInstanceOf(ErreurCli);
		expect((erreur as Error).message).toMatch(/claude` introuvable/u);
		expect(lire(fichier)[0]!.prejugements).toBeUndefined();
	});
});
