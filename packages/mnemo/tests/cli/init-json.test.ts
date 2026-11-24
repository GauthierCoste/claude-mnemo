/** `mnemo init` pilotable : options explicites, sortie `--json`, échec d'une étape hors mémoire qui n'arrête pas la suite. */
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { LigneInit } from '@mnemo/contrat';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commandeInit } from '../../src/adaptateurs/cli/init.ts';
import type { SuiviModeles } from '../../src/adaptateurs/cli/init.ts';
import { journalInit, PAS_PROGRESSION_MS } from '../../src/adaptateurs/cli/init-journal.ts';
import { lireOptionsInit } from '../../src/adaptateurs/cli/init-options.ts';
import type { Piece } from '../../src/infra/modeles/catalogue.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';
import { ENV_TEST } from '../aides/env-test.ts';

const MAIN = join(import.meta.dirname, '../../src/adaptateurs/cli/main.ts');

function capture(): { flux: Writable; texte(): string } {
	let texte = '';
	const flux = new Writable({
		write(morceau, _e, fini) {
			texte += String(morceau);
			fini();
		},
	});
	return { flux, texte: () => texte };
}

function entreeInterdite(): Readable {
	return new Readable({
		read() {
			this.destroy(new Error('aucune question ne devait être posée'));
		},
	});
}

/** Chaque ligne de la sortie est un objet JSON (aucune autre ligne). */
function lignesJson(texte: string): LigneInit[] {
	return texte
		.split('\n')
		.filter((l) => l !== '')
		.map((l) => JSON.parse(l) as LigneInit);
}

const evenements = (lignes: LigneInit[]) => lignes.filter((l) => 'etape' in l && l.etat !== 'progression').map((l) => ('etape' in l ? `${l.etape}:${l.etat}` : ''));

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});
const avecMcpFactice = () => vi.stubEnv('MNEMO_SANS_MCP', '');

const actions = () => ({
	installerModeles: vi.fn(async (_racine: string, _suivi?: SuiviModeles) => {}),
	creerLanceur: vi.fn(async (_racine: string, ecrire?: (ligne: string) => void) => ecrire?.('Lanceur créé : ~/Applications/Mnemo.app.')),
	installerCommande: vi.fn(async (ecrire?: (ligne: string) => void) => ecrire?.('Commande installée : ~/.local/bin/mnemo.')),
	commandeAJour: vi.fn(() => false),
	declarerMcp: vi.fn(async () => 'declare' as const),
});

const piece = (nom: Piece['nom']): Piece => ({ nom, libelle: `pièce ${nom}`, adresse: `https://exemple.test/${nom}`, sha256: '0'.repeat(64), archive: null, fichier: nom });

describe('mnemo init : options', () => {
	it('options contradictoires ou inconnues : erreur d’usage', () => {
		for (const [avec, sans] of [['--mcp', '--sans-mcp'], ['--modeles', '--sans-modeles'], ['--commande', '--sans-commande'], ['--lanceur', '--sans-lanceur']]) {
			expect(() => lireOptionsInit([avec!, sans!])).toThrow(expect.objectContaining({ code: 2, message: expect.stringContaining('contradictoires') }));
		}
		expect(() => lireOptionsInit(['--modele'])).toThrow(expect.objectContaining({ code: 2 }));
		expect(lireOptionsInit(['d', '--json', '--mcp', '--sans-lanceur'])).toEqual({ dossier: 'd', oui: false, json: true, mcp: true, modeles: null, commande: null, lanceur: false });
	});

	it('options contradictoires : rien n’est créé', async () => {
		const racine = await dossierTemporaire();
		await expect(commandeInit([racine, '--commande', '--sans-commande'], { sortie: capture().flux, interactif: false, actions: actions() })).rejects.toMatchObject({ code: 2 });
		expect(readdirSync(racine)).toEqual([]);
	});

	it('devant un terminal, les options explicites l’emportent sans question (modèles oui, commande non, lanceur oui, MCP non)', async () => {
		const racine = await dossierTemporaire();
		const a = actions();
		const sortie = capture();
		await commandeInit([racine, '--sans-mcp', '--modeles', '--sans-commande', '--lanceur'], { entree: entreeInterdite(), sortie: sortie.flux, interactif: true, plateforme: 'darwin', actions: a });
		expect(a.installerModeles).toHaveBeenCalledWith(racine);
		expect(a.installerCommande).not.toHaveBeenCalled();
		expect(a.creerLanceur).toHaveBeenCalledWith(racine);
		expect(a.declarerMcp).not.toHaveBeenCalled();
		expect(sortie.texte()).not.toMatch(/\[[oO]\/[nN]\]/u);
	});

	it('sans terminal, --mcp déclare et --commande installe ; mémoire existante : --modeles installe quand même', async () => {
		const racine = await dossierTemporaire();
		await commandeInit([racine, '--oui', '--sans-mcp'], { sortie: capture().flux, interactif: false, plateforme: 'linux', actions: actions() });
		avecMcpFactice();
		const a = actions();
		await commandeInit([racine, '--mcp', '--commande', '--modeles'], { sortie: capture().flux, interactif: false, plateforme: 'linux', actions: a });
		expect(a.declarerMcp).toHaveBeenCalledOnce();
		expect(a.installerCommande).toHaveBeenCalledOnce();
		expect(a.installerModeles).toHaveBeenCalledWith(racine);
	});

	it('MNEMO_SANS_MCP=1 l’emporte sur --mcp', async () => {
		const racine = await dossierTemporaire();
		vi.stubEnv('MNEMO_SANS_MCP', '1');
		const a = actions();
		const sortie = capture();
		await commandeInit([racine, '--json', '--mcp'], { sortie: sortie.flux, plateforme: 'linux', actions: a });
		expect(a.declarerMcp).not.toHaveBeenCalled();
		expect(lignesJson(sortie.texte())).toContainEqual({ etape: 'mcp', etat: 'saute', message: 'Serveur MCP non déclaré (MNEMO_SANS_MCP=1).' });
	});
});

describe('mnemo init --json', () => {
	it('une ligne JSON par événement, rien d’autre ; aucune question même « devant un terminal » ; ligne de fin', async () => {
		const racine = await dossierTemporaire();
		avecMcpFactice();
		const a = actions();
		const sortie = capture();
		await commandeInit([racine, '--json', '--mcp', '--commande', '--sans-modeles', '--sans-lanceur'], { entree: entreeInterdite(), sortie: sortie.flux, interactif: true, plateforme: 'darwin', actions: a });
		const lignes = lignesJson(sortie.texte());
		expect(evenements(lignes)).toEqual(['memoire:debut', 'memoire:fait', 'mcp:debut', 'mcp:fait', 'modeles:saute', 'commande:debut', 'commande:fait', 'lanceur:saute']);
		expect(lignes[0]).toEqual({ etape: 'memoire', etat: 'debut', message: `Dossier Mnemo : ${racine}` });
		expect(lignes).toContainEqual({ etape: 'mcp', etat: 'fait', message: 'Serveur MCP déclaré pour toutes les sessions Claude Code.' });
		expect(lignes).toContainEqual({ etape: 'commande', etat: 'fait', message: 'Commande installée : ~/.local/bin/mnemo.' });
		expect(lignes.at(-1)).toEqual({ fin: true, racine, ok: true });
		expect(a.installerCommande).toHaveBeenCalledWith(expect.any(Function));
		expect(existsSync(join(racine, '_mnemo', 'SCHEMA.md'))).toBe(true);
	});

	it('sans option explicite : les défauts de « sans terminal » (rien hors du dossier), chaque étape dite « saute »', async () => {
		const racine = await dossierTemporaire();
		avecMcpFactice();
		const a = actions();
		const sortie = capture();
		await commandeInit([racine, '--json'], { sortie: sortie.flux, plateforme: 'darwin', actions: a });
		expect(evenements(lignesJson(sortie.texte()))).toEqual(['memoire:debut', 'memoire:fait', 'mcp:saute', 'modeles:saute', 'commande:saute', 'lanceur:saute']);
		expect(a.declarerMcp).not.toHaveBeenCalled();
	});

	it('commande déjà installée : « debut » puis « fait » (sautée sur --sans-commande)', async () => {
		const racine = await dossierTemporaire();
		const a = { ...actions(), commandeAJour: vi.fn(() => true) };
		const sortie = capture();
		await commandeInit([racine, '--json', '--sans-mcp', '--sans-lanceur'], { sortie: sortie.flux, plateforme: 'linux', actions: a });
		expect(evenements(lignesJson(sortie.texte())).filter((e) => e.startsWith('commande:'))).toEqual(['commande:debut', 'commande:fait']);
		const sansCommande = capture();
		await commandeInit([racine, '--json', '--sans-mcp', '--sans-commande'], { sortie: sansCommande.flux, plateforme: 'linux', actions: a });
		expect(evenements(lignesJson(sansCommande.texte())).filter((e) => e.startsWith('commande:'))).toEqual(['commande:saute']);
		expect(a.installerCommande).not.toHaveBeenCalled();
	});

	it('progression des modèles : au plus une ligne par seconde et par pièce', async () => {
		const racine = await dossierTemporaire();
		let t = 0;
		const a = {
			...actions(),
			installerModeles: vi.fn(async (_racine: string, suivi?: SuiviModeles) => {
				for (const [ms, nom, recu] of [[0, 'sens', 1], [0, 'moteur', 1], [300, 'sens', 2], [999, 'sens', 3], [1000, 'sens', 4], [1500, 'moteur', 2], [1999, 'sens', 5], [2000, 'sens', 6]] as const) {
					t = ms;
					suivi?.progression(piece(nom), recu, 10);
				}
				suivi?.journal.info('pièce sens : téléchargé');
			}),
		};
		const sortie = capture();
		await commandeInit([racine, '--json', '--sans-mcp', '--modeles'], { sortie: sortie.flux, plateforme: 'linux', actions: a, maintenant: () => t });
		const lignes = lignesJson(sortie.texte());
		const progression = lignes.flatMap((l) => ('etat' in l && l.etat === 'progression' ? [`${l.piece}:${l.recu}`] : []));
		expect(progression).toEqual(['sens:1', 'moteur:1', 'sens:4', 'moteur:2', 'sens:6']);
		expect(lignes).toContainEqual({ etape: 'modeles', etat: 'progression', piece: 'sens', libelle: 'pièce sens', recu: 1, total: 10 });
		expect(lignes).toContainEqual({ etape: 'modeles', etat: 'fait', message: 'pièce sens : téléchargé' });
	});

	it('échec des modèles : la suite continue, ligne « echec », fin ok:false, code 1', async () => {
		const racine = await dossierTemporaire();
		const a = {
			...actions(),
			installerModeles: vi.fn(async (_racine: string, suivi?: SuiviModeles) => {
				suivi?.journal.erreur('pièce sens : échec — connexion coupée');
				throw new Error('1 pièce non installée.');
			}),
		};
		const sortie = capture();
		await expect(commandeInit([racine, '--json', '--sans-mcp', '--modeles', '--commande'], { sortie: sortie.flux, plateforme: 'linux', actions: a })).rejects.toMatchObject({ code: 1 });
		const lignes = lignesJson(sortie.texte());
		expect(lignes).toContainEqual({ etape: 'modeles', etat: 'echec', message: 'pièce sens : échec — connexion coupée ; 1 pièce non installée.' });
		expect(a.installerCommande).toHaveBeenCalledOnce();
		expect(evenements(lignes).slice(-4)).toEqual(['modeles:echec', 'commande:debut', 'commande:fait', 'lanceur:saute']);
		expect(lignes.at(-1)).toEqual({ fin: true, racine, ok: false });
	});

	it('Claude Code introuvable : la déclaration est un échec, la commande à lancer est dans le message', async () => {
		const racine = await dossierTemporaire();
		avecMcpFactice();
		const a = { ...actions(), declarerMcp: vi.fn(async () => ({ manuel: 'claude mcp add --scope user mnemo -- node main.ts mcp', introuvable: true, raison: 'introuvable' })) };
		const sortie = capture();
		await expect(commandeInit([racine, '--json', '--mcp'], { sortie: sortie.flux, plateforme: 'linux', actions: a })).rejects.toMatchObject({ code: 1 });
		const lignes = lignesJson(sortie.texte());
		expect(lignes).toContainEqual({ etape: 'mcp', etat: 'echec', message: 'Claude Code introuvable : lancez vous-même : claude mcp add --scope user mnemo -- node main.ts mcp' });
		expect(lignes.at(-1)).toEqual({ fin: true, racine, ok: false });
	});

	it('déjà déclaré pour une autre installation de Mnemo : échec de motif « perime » (mnemo declarer --remplacer le reprend), les autres échecs n’en ont pas', async () => {
		const racine = await dossierTemporaire();
		avecMcpFactice();
		const manuel = 'claude mcp add --scope user mnemo -- node main.ts mcp';
		const a = { ...actions(), declarerMcp: vi.fn(async () => ({ perime: true as const, manuel, portee: 'User config', scope: 'user' as const, remplacable: true })) };
		const sortie = capture();
		await expect(commandeInit([racine, '--json', '--mcp'], { sortie: sortie.flux, plateforme: 'linux', actions: a })).rejects.toMatchObject({ code: 1 });
		const lignes = lignesJson(sortie.texte());
		const echec = lignes.find((l) => 'etat' in l && l.etape === 'mcp' && l.etat === 'echec');
		expect(echec).toMatchObject({ motif: 'perime' });
		expect((echec as { message: string }).message).toContain('déclaré avec un autre chemin');
		expect(lignes.at(-1)).toEqual({ fin: true, racine, ok: false });
	});

	it('déjà déclaré par autre chose que Mnemo, ou d’une autre portée : échec sans motif (`mnemo declarer --remplacer` le laisserait)', async () => {
		avecMcpFactice();
		const manuel = 'claude mcp add --scope user mnemo -- node main.ts mcp';
		for (const perime of [
			{ perime: true as const, manuel, portee: 'Local config', scope: 'local' as const, remplacable: false },
			{ perime: true as const, manuel, scope: 'user' as const, remplacable: false },
		]) {
			const racine = await dossierTemporaire();
			const a = { ...actions(), declarerMcp: vi.fn(async () => perime) };
			const sortie = capture();
			await expect(commandeInit([racine, '--json', '--mcp'], { sortie: sortie.flux, plateforme: 'linux', actions: a })).rejects.toMatchObject({ code: 1 });
			const echec = lignesJson(sortie.texte()).find((l) => 'etat' in l && l.etape === 'mcp' && l.etat === 'echec');
			expect(echec).toBeDefined();
			expect(echec).not.toHaveProperty('motif');
		}
	});

	it('processus réel : la sortie standard n’a que des lignes JSON, code 0', async () => {
		const racine = await dossierTemporaire();
		const home = await dossierTemporaire();
		const r = await new Promise<{ code: number; out: string }>((resoudre) => {
			execFile(process.execPath, [MAIN, 'init', racine, '--json', '--sans-mcp', '--sans-modeles', '--sans-commande', '--sans-lanceur'], { env: { ...ENV_TEST, HOME: home }, timeout: 30_000 }, (e, out) =>
				resoudre({ code: e ? Number(e.code) : 0, out }),
			);
		});
		expect(r.code).toBe(0);
		const lignes = lignesJson(r.out);
		expect(lignes.at(-1)).toEqual({ fin: true, racine, ok: true });
		expect(lignes.filter((l) => 'etat' in l && l.etat === 'debut').map((l) => ('etape' in l ? l.etape : ''))).toEqual(['memoire']);
	});
});

describe('mnemo init : échec en mode texte', () => {
	it('la commande échoue : dit, le lanceur est quand même créé, code 1', async () => {
		const racine = await dossierTemporaire();
		const a = { ...actions(), installerCommande: vi.fn(async () => Promise.reject(new Error('droits insuffisants'))) };
		const sortie = capture();
		await expect(commandeInit([racine, '--sans-mcp', '--commande', '--lanceur'], { sortie: sortie.flux, interactif: false, plateforme: 'darwin', actions: a })).rejects.toThrow(/en échec : commande/u);
		expect(sortie.texte()).toContain('Commande « mnemo » : échec — droits insuffisants');
		expect(a.creerLanceur).toHaveBeenCalledWith(racine);
		expect(sortie.texte()).toContain('Pour démarrer : ouvrez l’application Mnemo');
	});
});

describe('journalInit', () => {
	it('texte : seulement les lignes pour un humain ; JSON : seulement les événements', () => {
		const vues: string[] = [];
		const texte = journalInit((l) => vues.push(l), false);
		texte.texte('bonjour');
		texte.evenement('memoire', 'fait', 'x');
		texte.progression({ nom: 'sens', libelle: 's' }, 1, null);
		texte.fin('/r', true);
		expect(vues).toEqual(['bonjour']);
		vues.length = 0;
		const json = journalInit((l) => vues.push(l), true, () => 0);
		json.texte('bonjour');
		json.progression({ nom: 'sens', libelle: 's' }, 1, null);
		json.progression({ nom: 'sens', libelle: 's' }, 2, null);
		expect(vues).toEqual([JSON.stringify({ etape: 'modeles', etat: 'progression', piece: 'sens', libelle: 's', recu: 1, total: null })]);
		expect(PAS_PROGRESSION_MS).toBe(1000);
	});
});
