import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ecrireFichierClaudeDesktop, fichierConfigClaudeDesktop, lireFichierClaudeDesktop } from '../../src/infra/config-claude-desktop.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('fichier de configuration de l’app Claude', () => {
	it('chemin selon la plateforme', () => {
		expect(fichierConfigClaudeDesktop('darwin', '/maison/alice', {})).toBe('/maison/alice/Library/Application Support/Claude/claude_desktop_config.json');
		expect(fichierConfigClaudeDesktop('win32', 'D:\\Profils\\alice', { APPDATA: 'D:\\Profils\\alice\\AppData\\Roaming' })).toBe('D:\\Profils\\alice\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
		expect(fichierConfigClaudeDesktop('win32', 'D:\\Profils\\alice', {})).toBe('D:\\Profils\\alice\\AppData\\Roaming\\Claude\\claude_desktop_config.json');
		expect(fichierConfigClaudeDesktop('linux', '/maison/alice', {})).toBe('/maison/alice/.config/Claude/claude_desktop_config.json');
		expect(fichierConfigClaudeDesktop('linux', '/maison/alice', { XDG_CONFIG_HOME: '/conf' })).toBe('/conf/Claude/claude_desktop_config.json');
	});

	it('lecture : app absente (pas de dossier), fichier absent, fichier présent', async () => {
		const d = await dossierTemporaire();
		const fichier = join(d, 'Claude', 'claude_desktop_config.json');
		expect(lireFichierClaudeDesktop(fichier)).toEqual({ installee: false });
		mkdirSync(join(d, 'Claude'));
		expect(lireFichierClaudeDesktop(fichier)).toEqual({ installee: true, texte: null });
		writeFileSync(fichier, '{"a":1}');
		expect(lireFichierClaudeDesktop(fichier)).toEqual({ installee: true, texte: '{"a":1}' });
	});

	it('lecture : un dossier à la place du fichier est une erreur, jamais une configuration vide', async () => {
		const d = await dossierTemporaire();
		const fichier = join(d, 'claude_desktop_config.json');
		mkdirSync(fichier);
		expect(lireFichierClaudeDesktop(fichier)).toMatchObject({ installee: true, erreur: expect.stringContaining('illisible') });
	});

	it('écriture atomique : contenu remplacé, droits 0600, aucun provisoire laissé', async () => {
		const d = await dossierTemporaire();
		const fichier = join(d, 'claude_desktop_config.json');
		writeFileSync(fichier, '{}');
		ecrireFichierClaudeDesktop(fichier, '{\n  "a": 1\n}\n');
		expect(readFileSync(fichier, 'utf8')).toBe('{\n  "a": 1\n}\n');
		if (process.platform !== 'win32') expect(statSync(fichier).mode & 0o777).toBe(0o600);
		expect(readdirSync(d)).toEqual(['claude_desktop_config.json']);
	});

	it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('écriture en échec : rien n’est laissé, le fichier reste intact', async () => {
		const d = await dossierTemporaire();
		const fichier = join(d, 'claude_desktop_config.json');
		writeFileSync(fichier, '{"garde":true}');
		chmodSync(d, 0o500);
		try {
			expect(() => ecrireFichierClaudeDesktop(fichier, '{}')).toThrow();
		} finally {
			chmodSync(d, 0o700);
		}
		expect(readFileSync(fichier, 'utf8')).toBe('{"garde":true}');
		expect(readdirSync(d)).toEqual(['claude_desktop_config.json']);
	});
});
