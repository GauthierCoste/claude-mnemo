import { describe, expect, it } from 'vitest';
import {
	adresseVue,
	brancherMnemo,
	debrancherMnemo,
	ecrireServeur,
	entreeMnemo,
	etatMnemo,
	lireConfigClaudeDesktop,
	retirerServeur,
	serveursVus,
	serveurStdio,
	texteConfigClaudeDesktop,
} from '../../src/domaine/config-claude-desktop.ts';
import type { ConfigClaudeDesktop, DemandeServeur } from '../../src/domaine/config-claude-desktop.ts';

const lire = (texte: string | null): ConfigClaudeDesktop => {
	const r = lireConfigClaudeDesktop(texte);
	if (!r.ok) throw new Error(r.erreur);
	return r.config;
};
const ecrite = (r: ReturnType<typeof ecrireServeur>): ConfigClaudeDesktop => {
	if (!r.ok) throw new Error(r.motif);
	return r.config;
};
const relu = (config: ConfigClaudeDesktop): Record<string, unknown> => JSON.parse(texteConfigClaudeDesktop(config)) as Record<string, unknown>;

const FICHIER = JSON.stringify({
	globalShortcut: 'Alt+Space',
	mcpServers: {
		notes: { command: 'npx', args: ['-y', 'serveur-notes'], env: { CLE_API: 'secret-123' } },
		distant: { url: 'https://exemple.test/mcp' },
		bizarre: { command: 'outil', options: { x: 1 } },
	},
	preferences: { theme: 'sombre' },
});
const ATTENDUE = entreeMnemo('/opt/node/bin/node', '/opt/mnemo/main.ts', '/maison/alice/Memoire');
const demande = (d: Partial<DemandeServeur> = {}): DemandeServeur => ({ nom: 'outil', commande: 'uvx', args: ['outil-mcp'], env: {}, ...d });

describe('configuration de l’app Claude : lecture', () => {
	it('absent ou vide : configuration vide', () => {
		expect(lire(null)).toEqual({ brut: {}, serveurs: {} });
		expect(lire('  \n')).toEqual({ brut: {}, serveurs: {} });
		expect(lire('{"autre":1}')).toEqual({ brut: { autre: 1 }, serveurs: {} });
	});

	it('illisible : JSON invalide, racine ou mcpServers qui n’est pas un objet', () => {
		expect(lireConfigClaudeDesktop('{ pas du json')).toMatchObject({ ok: false, erreur: expect.stringContaining('JSON invalide') });
		expect(lireConfigClaudeDesktop('[1, 2]')).toMatchObject({ ok: false });
		expect(lireConfigClaudeDesktop('{"mcpServers": []}')).toMatchObject({ ok: false, erreur: expect.stringContaining('mcpServers') });
		expect(lireConfigClaudeDesktop('{"mcpServers": "x"}')).toMatchObject({ ok: false });
	});

	it('illisible : le motif ne cite jamais le texte du fichier (valeurs de variables)', () => {
		for (const texte of ['{"env":{"KEY":sk-secret-123}}', '{"env":{"KEY":"sk-secret-123","A":tru}}', '{"env":{"KEY":"sk-secret-123"}} x']) {
			const lu = lireConfigClaudeDesktop(texte);
			expect(lu).toMatchObject({ ok: false, erreur: expect.stringContaining('JSON invalide') });
			expect(JSON.stringify(lu)).not.toContain('secret');
			expect(JSON.stringify(lu)).not.toContain('sk-');
		}
	});

	it('vue : noms des variables seulement, jamais leurs valeurs ; serveurs décrits autrement en lecture seule', () => {
		const vus = serveursVus(lire(FICHIER));
		expect(vus).toEqual([
			{ nom: 'notes', commande: 'npx', args: ['-y', 'serveur-notes'], env: ['CLE_API'], modifiable: true },
			{ nom: 'distant', commande: 'https://exemple.test/mcp', args: [], env: [], modifiable: false },
			{ nom: 'bizarre', commande: 'outil', args: [], env: [], modifiable: false },
		]);
		expect(JSON.stringify(vus)).not.toContain('secret-123');
	});

	it('vue : l’adresse d’un serveur distant sans identifiants, paramètres ni fragment', () => {
		const vus = serveursVus(
			lire(
				JSON.stringify({
					mcpServers: {
						jeton: { url: 'https://exemple.test/mcp?token=sk-secret-123&x=1#frag' },
						compte: { type: 'sse', url: 'https://alice:mot-secret@exemple.test:8443/sse/' },
						casse: { url: 'pas une adresse secret-456' },
					},
				}),
			),
		);
		expect(vus.map((v) => v.commande)).toEqual(['https://exemple.test/mcp', 'https://exemple.test:8443/sse/', 'adresse illisible']);
		expect(JSON.stringify(vus)).not.toMatch(/secret|alice|token|frag/u);
		expect(adresseVue('http://[::1')).toBe('adresse illisible');
	});

	it('forme stdio : type « stdio » toléré, toute autre forme refusée', () => {
		expect(serveurStdio({ type: 'stdio', command: 'x' })).toEqual({ commande: 'x', args: [], env: {} });
		expect(serveurStdio({ type: 'sse', command: 'x' })).toBeNull();
		expect(serveurStdio({ command: '' })).toBeNull();
		expect(serveurStdio({ command: 'x', args: [1] })).toBeNull();
		expect(serveurStdio({ command: 'x', env: { A: 1 } })).toBeNull();
		expect(serveurStdio('x')).toBeNull();
	});

	it('l’entrée mnemo n’est pas listée', () => {
		const config = brancherMnemo(lire(FICHIER), ATTENDUE);
		expect(serveursVus(config).map((s) => s.nom)).toEqual(['notes', 'distant', 'bizarre']);
	});
});

describe('configuration de l’app Claude : Mnemo', () => {
	it('états : absent, branché, périmé (autre Node, autre main.ts, autre racine)', () => {
		const vide = lire(null);
		expect(etatMnemo(vide, ATTENDUE)).toBe('absent');
		expect(etatMnemo(brancherMnemo(vide, ATTENDUE), ATTENDUE)).toBe('branche');
		for (const autre of [
			entreeMnemo('/usr/bin/node', '/opt/mnemo/main.ts', '/maison/alice/Memoire'),
			entreeMnemo('/opt/node/bin/node', '/ailleurs/main.ts', '/maison/alice/Memoire'),
			entreeMnemo('/opt/node/bin/node', '/opt/mnemo/main.ts', '/maison/alice/Autre'),
			{ command: '/opt/node/bin/node', args: ['/opt/mnemo/main.ts', 'mcp'] },
		])
			expect(etatMnemo(brancherMnemo(vide, autre), ATTENDUE)).toBe('perime');
	});

	it('entrée attendue : Node, main.ts, mcp, MNEMO_RACINE', () => {
		expect(ATTENDUE).toEqual({ command: '/opt/node/bin/node', args: ['/opt/mnemo/main.ts', 'mcp'], env: { MNEMO_RACINE: '/maison/alice/Memoire' } });
	});

	it('brancher puis débrancher : les autres clés et serveurs gardés tels quels, à leur place', () => {
		const avant = JSON.parse(FICHIER) as Record<string, unknown>;
		const branche = relu(brancherMnemo(lire(FICHIER), ATTENDUE));
		expect(Object.keys(branche)).toEqual(['globalShortcut', 'mcpServers', 'preferences']);
		expect(branche).toEqual({ ...avant, mcpServers: { ...(avant['mcpServers'] as object), mnemo: ATTENDUE } });
		expect(relu(debrancherMnemo(lire(texteConfigClaudeDesktop(brancherMnemo(lire(FICHIER), ATTENDUE)))))).toEqual(avant);
	});

	it('mise à jour d’une entrée périmée : remplacée à sa place', () => {
		const texte = JSON.stringify({ mcpServers: { a: { command: 'a' }, mnemo: { command: 'vieux' }, b: { command: 'b' } } });
		const config = brancherMnemo(lire(texte), ATTENDUE);
		expect(Object.keys(config.serveurs)).toEqual(['a', 'mnemo', 'b']);
		expect(etatMnemo(config, ATTENDUE)).toBe('branche');
	});

	it('texte : JSON indenté de 2 espaces, \\n final', () => {
		expect(texteConfigClaudeDesktop(lire('{"a":1}'))).toBe('{\n  "a": 1,\n  "mcpServers": {}\n}\n');
	});
});

describe('configuration de l’app Claude : autres serveurs', () => {
	it('ajout : args et env omis s’ils sont vides ; nom déjà pris refusé', () => {
		const config = ecrite(ecrireServeur(lire(FICHIER), demande({ args: [] })));
		expect(config.serveurs['outil']).toEqual({ command: 'uvx' });
		expect(ecrireServeur(lire(FICHIER), demande({ nom: 'notes' }))).toMatchObject({ ok: false, genre: 'existe' });
		expect(ecrite(ecrireServeur(lire(null), demande({ env: { A: '1' } }))).serveurs['outil']).toEqual({ command: 'uvx', args: ['outil-mcp'], env: { A: '1' } });
	});

	it('validation : nom, nom réservé, commande, arguments, variables', () => {
		const refus = (d: Partial<DemandeServeur>) => ecrireServeur(lire(null), demande(d));
		for (const d of [
			{ nom: '' },
			{ nom: 'a b' },
			{ nom: 'x'.repeat(65) },
			{ nom: 'mnemo' },
			{ nom: 'Mnemo' },
			{ nom: '__proto__' },
			{ commande: '  ' },
			{ commande: 'x'.repeat(1001) },
			{ args: Array<string>(51).fill('a') },
			{ args: ['x'.repeat(4001)] },
			{ env: { '1A': 'x' } },
			{ env: { 'A-B': 'x' } },
			{ env: { A: null } },
		] as Partial<DemandeServeur>[])
			expect(refus(d), JSON.stringify(d).slice(0, 60)).toMatchObject({ ok: false, genre: 'refuse' });
		expect(refus({ nom: 'a.b_c-9', args: Array<string>(50).fill('a'), env: { _A1: '' } })).toMatchObject({ ok: true });
	});

	it('modification : null garde la valeur, une variable absente est retirée, une nouvelle valeur remplace', () => {
		const config = ecrite(ecrireServeur(lire(FICHIER), { nom: 'notes', commande: 'npx', args: ['-y', 'serveur-notes@2'], env: { CLE_API: null, AUTRE: 'b' } }, 'notes'));
		expect(config.serveurs['notes']).toEqual({ command: 'npx', args: ['-y', 'serveur-notes@2'], env: { CLE_API: 'secret-123', AUTRE: 'b' } });
		const sans = ecrite(ecrireServeur(lire(FICHIER), { nom: 'notes', commande: 'npx', args: [], env: {} }, 'notes'));
		expect(sans.serveurs['notes']).toEqual({ command: 'npx' });
		const remplacee = ecrite(ecrireServeur(lire(FICHIER), { nom: 'notes', commande: 'npx', args: [], env: { CLE_API: 'neuve' } }, 'notes'));
		expect(remplacee.serveurs['notes']).toEqual({ command: 'npx', env: { CLE_API: 'neuve' } });
		// les autres serveurs, même illisibles par Mnemo, ne bougent pas
		expect(remplacee.serveurs['distant']).toEqual({ url: 'https://exemple.test/mcp' });
		expect(remplacee.serveurs['bizarre']).toEqual({ command: 'outil', options: { x: 1 } });
	});

	it('renommage : à la même place, valeurs gardées ; nouveau nom déjà pris refusé', () => {
		const config = ecrite(ecrireServeur(lire(FICHIER), { nom: 'carnet', commande: 'npx', args: [], env: { CLE_API: null } }, 'notes'));
		expect(Object.keys(config.serveurs)).toEqual(['carnet', 'distant', 'bizarre']);
		expect(config.serveurs['carnet']).toEqual({ command: 'npx', env: { CLE_API: 'secret-123' } });
		expect(ecrireServeur(lire(FICHIER), demande({ nom: 'distant' }), 'notes')).toMatchObject({ ok: false, genre: 'existe' });
	});

	it('modification refusée : serveur inconnu, décrit autrement, ou Mnemo', () => {
		expect(ecrireServeur(lire(FICHIER), demande(), 'absent')).toMatchObject({ ok: false, genre: 'inconnu' });
		expect(ecrireServeur(lire(FICHIER), demande({ nom: 'distant' }), 'distant')).toMatchObject({ ok: false, genre: 'refuse' });
		expect(ecrireServeur(brancherMnemo(lire(FICHIER), ATTENDUE), demande(), 'mnemo')).toMatchObject({ ok: false, genre: 'refuse' });
	});

	it('retrait : tout serveur, même décrit autrement ; jamais mnemo ; inconnu refusé', () => {
		const config = brancherMnemo(lire(FICHIER), ATTENDUE);
		const r = retirerServeur(config, 'distant');
		expect(r.ok && Object.keys(r.config.serveurs)).toEqual(['notes', 'bizarre', 'mnemo']);
		expect(retirerServeur(config, 'mnemo')).toMatchObject({ ok: false, genre: 'refuse' });
		expect(retirerServeur(config, 'absent')).toMatchObject({ ok: false, genre: 'inconnu' });
	});

	it('un serveur nommé « __proto__ » dans le fichier reste une clé comme les autres', () => {
		const config = lire('{"mcpServers":{"__proto__":{"command":"x"},"a":{"command":"a"}}}');
		const renomme = ecrite(ecrireServeur(config, demande({ nom: 'b' }), 'a'));
		expect(relu(renomme)).toEqual(JSON.parse('{"mcpServers":{"__proto__":{"command":"x"},"b":{"command":"uvx","args":["outil-mcp"]}}}'));
	});
});
