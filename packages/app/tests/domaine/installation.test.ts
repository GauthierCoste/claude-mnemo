import { describe, expect, it } from 'vitest';
import { bilanDesinstallation, type EntreeDesinstallation, planDesinstallation } from '../../src/domaine/desinstallation.ts';
import { aRefaire, entreeMnemo, etatCommande, etatEntreeMcp, texteSansEntreeMnemo } from '../../src/domaine/installation.ts';
import { optionsOuvertureSession, ouverteParLaSession } from '../../src/domaine/ouverture-session.ts';

const RESSOURCES = '/Applications/Mnemo.app/Contents/Resources';
const ATTENDU = {
	node: `${RESSOURCES}/node/bin/node`,
	main: `${RESSOURCES}/mnemo/src/adaptateurs/cli/main.ts`,
	mainUrl: `file://${RESSOURCES}/mnemo/src/adaptateurs/cli/main.ts`,
};
const DEPOT = '/maison/exemple/depot/packages/mnemo/src/adaptateurs/cli/main.ts';

/** Le script tel que l'écrit `mnemo commande`. */
const script = (node: string, mainUrl: string) =>
	`#!${node}\n// Commande « mnemo », écrite par Mnemo (local.mnemo.commande) : lance le Mnemo ci-dessous avec ce Node.\n// …\nimport(${JSON.stringify(mainUrl)});\n`;

describe('ce que Mnemo a installé', () => {
	it('commande : absente, la nôtre, de Mnemo ailleurs, ou une autre commande', () => {
		expect(etatCommande(null, ATTENDU)).toBe('absent');
		expect(etatCommande(script(ATTENDU.node, ATTENDU.mainUrl), ATTENDU)).toBe('nous');
		expect(etatCommande(script('/usr/local/bin/node', ATTENDU.mainUrl), ATTENDU)).toBe('ailleurs');
		expect(etatCommande(script(ATTENDU.node, `file://${DEPOT}`), ATTENDU)).toBe('ailleurs');
		expect(etatCommande('#!/bin/sh\nexec autre "$@"\n', ATTENDU)).toBe('autre');
	});

	it('entrée MCP : la nôtre, celle de Mnemo ailleurs, ou une autre', () => {
		expect(etatEntreeMcp(undefined, ATTENDU, 'darwin')).toBe('absent');
		expect(etatEntreeMcp({ type: 'stdio', command: ATTENDU.node, args: [ATTENDU.main, 'mcp'] }, ATTENDU, 'darwin')).toBe('nous');
		expect(etatEntreeMcp({ command: ATTENDU.node, args: [ATTENDU.main, 'mcp'], env: { MNEMO_RACINE: '/x' } }, ATTENDU, 'darwin')).toBe('nous');
		expect(etatEntreeMcp({ command: '/vieux/node', args: [DEPOT, 'mcp'] }, ATTENDU, 'darwin')).toBe('ailleurs');
		expect(etatEntreeMcp({ command: 'C:\\node.exe', args: ['C:\\depot\\packages\\mnemo\\src\\adaptateurs\\cli\\main.ts', 'mcp'] }, ATTENDU, 'darwin')).toBe('ailleurs');
		expect(etatEntreeMcp({ command: 'npx', args: ['autre-serveur', 'mcp'] }, ATTENDU, 'darwin')).toBe('autre');
		expect(etatEntreeMcp({ command: ATTENDU.node, args: [ATTENDU.main] }, ATTENDU, 'darwin')).toBe('autre');
		expect(etatEntreeMcp({ url: 'https://exemple.test/mcp' }, ATTENDU, 'darwin')).toBe('autre');
		expect(etatEntreeMcp('texte', ATTENDU, 'darwin')).toBe('autre');
	});

	it('entrée MCP sous Windows : chemins comparés sans casse ni sens des séparateurs ; à l’identique sous macOS', () => {
		const windows = { node: 'C:\\Program Files\\Mnemo\\resources\\node\\node.exe', main: 'C:\\Program Files\\Mnemo\\resources\\mnemo\\src\\adaptateurs\\cli\\main.ts' };
		const ecrite = { command: 'c:/program files/mnemo/resources/node/node.exe', args: ['C:/Program Files/Mnemo/resources/mnemo/src/adaptateurs/cli/main.ts', 'mcp'] };
		expect(etatEntreeMcp(ecrite, windows, 'win32')).toBe('nous');
		expect(etatEntreeMcp(ecrite, windows, 'darwin')).toBe('ailleurs');
		expect(etatEntreeMcp({ command: ATTENDU.node.toUpperCase(), args: [ATTENDU.main, 'mcp'] }, ATTENDU, 'darwin')).toBe('ailleurs');
	});

	it('entrée « mnemo » d’un fichier de configuration', () => {
		expect(entreeMnemo(null)).toBeUndefined();
		expect(entreeMnemo({})).toBeUndefined();
		expect(entreeMnemo({ mcpServers: [] })).toBeUndefined();
		expect(entreeMnemo({ mcpServers: { autre: {} } })).toBeUndefined();
		expect(entreeMnemo({ mcpServers: { mnemo: { command: 'x' } } })).toEqual({ command: 'x' });
	});

	it('à refaire au lancement : seulement ce qui est de Mnemo et pointe ailleurs', () => {
		expect(aRefaire({ commande: 'ailleurs', claudeCode: 'ailleurs', appClaude: 'ailleurs' })).toEqual(['commande', 'claudeCode', 'appClaude']);
		expect(aRefaire({ commande: 'absent', claudeCode: 'autre', appClaude: 'nous' })).toEqual([]);
	});

	it('configuration de l’app Claude sans « mnemo » : autres clés et serveurs gardés dans leur ordre', () => {
		const brut = { preferences: { a: 1 }, mcpServers: { avant: { command: 'a' }, mnemo: { command: 'm' }, apres: { command: 'b' } }, fin: true };
		const texte = texteSansEntreeMnemo(brut);
		expect(texte).toBe(`${JSON.stringify({ preferences: { a: 1 }, mcpServers: { avant: { command: 'a' }, apres: { command: 'b' } }, fin: true }, null, 2)}\n`);
		expect(brut.mcpServers).toHaveProperty('mnemo');
	});

	it('ouverte par l’ouverture de session : l’argument, ou ce que dit le système', () => {
		expect(ouverteParLaSession(['/Applications/Mnemo.app/Contents/MacOS/Mnemo', '--ouverture-session'], false)).toBe(true);
		expect(ouverteParLaSession(['/Applications/Mnemo.app/Contents/MacOS/Mnemo'], true)).toBe(true);
		expect(ouverteParLaSession(['/Applications/Mnemo.app/Contents/MacOS/Mnemo'], false)).toBe(false);
	});

	it('élément d’ouverture : sous Windows l’exécutable et l’argument (mêmes options pour inscrire, lire et retirer) ; sous macOS l’argument seul', () => {
		const exe = 'D:\\Profils\\exemple\\AppData\\Local\\Programs\\Mnemo\\Mnemo.exe';
		expect(optionsOuvertureSession('win32', exe)).toEqual({ path: exe, args: ['--ouverture-session'] });
		expect(optionsOuvertureSession('darwin', '/Applications/Mnemo.app/Contents/MacOS/Mnemo')).toEqual({ args: ['--ouverture-session'] });
	});
});

const entree = (e: Partial<EntreeDesinstallation> = {}): EntreeDesinstallation => ({
	plateforme: 'darwin',
	etat: { commande: 'nous', claudeCode: 'nous', appClaude: 'nous' },
	ouvertureSession: true,
	serviceVivant: true,
	empaquetee: true,
	racine: '/maison/exemple/Mnemo',
	chemins: { commande: '~/.local/bin/mnemo', app: '/Applications/Mnemo.app', dossierApp: '~/Library/Application Support/Mnemo' },
	...e,
});

describe('désinstallation', () => {
	it('tout est à nous : tout est retiré, dans l’ordre, le service arrêté puis l’app à la corbeille', () => {
		const plan = planDesinstallation(entree());
		expect(plan.etapes).toEqual(['ouvertureSession', 'commande', 'claudeCode', 'appClaude', 'configuration', 'service', 'corbeille']);
		expect(plan.detail).toContain('Seront retirés :');
		expect(plan.detail).toContain('la commande « mnemo » (~/.local/bin/mnemo)');
		expect(plan.detail).toContain('Resteront :\n• ta mémoire (/maison/exemple/Mnemo/_mnemo) et le dossier local /maison/exemple/Mnemo/.mnemo');
	});

	it('ce qui ne lance pas cette app reste, et le dit : une autre installation de Mnemo comme ce qui n’est pas de Mnemo', () => {
		const plan = planDesinstallation(entree({ etat: { commande: 'ailleurs', claudeCode: 'ailleurs', appClaude: 'autre' }, ouvertureSession: false, serviceVivant: false, empaquetee: false }));
		expect(plan.etapes).toEqual(['configuration']);
		expect(plan.detail).toContain('la commande « mnemo » (~/.local/bin/mnemo), qui lance une autre installation de Mnemo');
		expect(plan.detail).toContain('la déclaration « mnemo » de Claude Code, qui lance une autre installation de Mnemo');
		expect(plan.detail).toContain('l’entrée « mnemo » de l’app Claude, qui ne lance pas Mnemo');
		expect(plan.detail).toContain('version de développement');
		expect(plan.detail.split('Resteront :')[0]).not.toContain('la commande');
		const autre = planDesinstallation(entree({ etat: { commande: 'autre', claudeCode: 'absent', appClaude: 'absent' } }));
		expect(autre.etapes).not.toContain('commande');
		expect(autre.detail).toContain('~/.local/bin/mnemo, qui n’a pas été écrit par Mnemo');
	});

	it('bilan : chaque étape, et la raison d’un échec', () => {
		const e = entree();
		const ok = bilanDesinstallation([{ etape: 'commande', ok: true }, { etape: 'configuration', ok: true, note: 'déjà absente' }], e);
		expect(ok.ok).toBe(true);
		expect(ok.message).toBe('Mnemo est désinstallé.');
		expect(ok.detail).toContain('✓ la commande « mnemo »');
		expect(ok.detail).toContain('(déjà absente)');
		const ko = bilanDesinstallation([{ etape: 'commande', ok: true }, { etape: 'claudeCode', ok: false, raison: '`claude` introuvable.' }], e);
		expect(ko.ok).toBe(false);
		expect(ko.detail).toContain('✗ la déclaration de la mémoire à Claude Code (serveur MCP « mnemo ») : `claude` introuvable.');
		expect(ko.detail).toContain('Ta mémoire et /maison/exemple/Mnemo/.mnemo sont restés en place.');
	});

	it('Windows : l’app retirée par son désinstalleur après la fermeture, jamais la corbeille ; sans désinstalleur, Paramètres › Applications', () => {
		const windows = { plateforme: 'win32', racine: 'D:\\Profils\\exemple\\Mnemo', chemins: { commande: '~\\.local\\bin\\mnemo', app: 'D:\\Profils\\exemple\\AppData\\Local\\Programs\\Mnemo\\Uninstall Mnemo.exe', dossierApp: 'D:\\Profils\\exemple\\AppData\\Roaming\\Mnemo' } } as const;
		const plan = planDesinstallation(entree({ ...windows, etat: { commande: 'absent', claudeCode: 'nous', appClaude: 'nous' } }));
		expect(plan.etapes).toEqual(['ouvertureSession', 'claudeCode', 'appClaude', 'configuration', 'service', 'desinstalleur']);
		expect(plan.detail).toContain('• l’app elle-même, par son désinstalleur (D:\\Profils\\exemple\\AppData\\Local\\Programs\\Mnemo\\Uninstall Mnemo.exe), qui s’ouvre quand Mnemo a quitté');
		expect(plan.detail).toContain('ta mémoire (D:\\Profils\\exemple\\Mnemo\\_mnemo) et le dossier local D:\\Profils\\exemple\\Mnemo\\.mnemo');
		expect(plan.detail).not.toMatch(/corbeille|image disque|macOS/u);
		const sans = planDesinstallation(entree({ ...windows, empaquetee: false }));
		expect(sans.etapes).not.toContain('desinstalleur');
		expect(sans.detail).toContain('l’app elle-même : à désinstaller depuis Paramètres › Applications');
		expect(sans.detail).not.toMatch(/image disque|macOS/u);
		const e = entree(windows);
		expect(bilanDesinstallation([{ etape: 'configuration', ok: true }, { etape: 'desinstalleur', ok: true }], e).message).toBe('Mnemo est désinstallé ; son désinstalleur retire l’app quand tu quittes.');
		expect(bilanDesinstallation([{ etape: 'configuration', ok: true }], e).message).toBe('Mnemo est désinstallé.');
	});
});
