import { describe, expect, it } from 'vitest';
import { commandeDemarrage } from '../../src/adaptateurs/cli/init.ts';
import { cheminReel } from '../../src/infra/chemin-reel.ts';
import { messageEchecGit } from '../../src/infra/historique-git.ts';
import { nodeDurable } from '../../src/infra/node-durable.ts';
import { imageProcessusWindows } from '../../src/infra/processus.ts';

const LIEN_FNM = 'D:\\profil\\AppData\\Local\\fnm_multishells\\123_456\\node.exe';
const NODE_REEL = 'D:\\profil\\AppData\\Roaming\\fnm\\node-versions\\v24.22.3\\installation\\node.exe';

describe('Windows', () => {
	it('nodeDurable : sous Windows, le lien de fnm propre au shell est résolu ; ailleurs, inchangé', () => {
		const resoudre = (c: string) => (c === LIEN_FNM ? NODE_REEL : c);
		expect(nodeDurable('win32', LIEN_FNM, resoudre)).toBe(NODE_REEL);
		expect(nodeDurable('darwin', '/opt/node/bin/node', () => '/ailleurs')).toBe('/opt/node/bin/node');
		expect(
			nodeDurable('win32', LIEN_FNM, () => {
				throw new Error('ENOENT');
			}),
		).toBe(LIEN_FNM);
	});

	it('cheminReel : sous Windows, la casse du disque ; ailleurs, ou introuvable, inchangé', () => {
		expect(cheminReel('c:\\projets\\clients\\acme', 'win32', () => 'C:\\Projets\\Clients\\Acme')).toBe('C:\\Projets\\Clients\\Acme');
		expect(cheminReel('/projets/acme', 'linux', () => '/autre')).toBe('/projets/acme');
		expect(
			cheminReel('c:\\absent', 'win32', () => {
				throw new Error('ENOENT');
			}),
		).toBe('c:\\absent');
	});

	it('commandeDemarrage : PowerShell (& et apostrophes doublées) sous Windows, POSIX ailleurs', () => {
		expect(commandeDemarrage('C:\\Program Files\\nodejs\\node.exe', 'C:\\Mnemo\\main.ts', "D:\\Memoire\\L'atelier", 'win32')).toBe(
			"& 'C:\\Program Files\\nodejs\\node.exe' 'C:\\Mnemo\\main.ts' 'D:\\Memoire\\L''atelier'",
		);
		expect(commandeDemarrage('/usr/bin/node', '/m/main.ts', "/srv/L'atelier", 'darwin')).toBe("'/usr/bin/node' '/m/main.ts' '/srv/L'\\''atelier'");
	});

	it('messageEchecGit : « dubious ownership » donne la commande safe.directory, en « / »', () => {
		const erreur = "fatal: detected dubious ownership in repository at 'D:/Memoire/_mnemo'";
		const message = messageEchecGit('commit', erreur, 'D:\\Memoire\\_mnemo');
		expect(message).toContain('git commit a échoué : fatal: detected dubious ownership');
		expect(message).toContain('git config --global --add safe.directory "D:/Memoire/_mnemo"');
		expect(messageEchecGit('add', 'fatal: autre\n', '/m')).toBe('git add a échoué : fatal: autre');
	});

	it('imageProcessusWindows : nom lu dans le CSV de tasklist, vide sans processus, null si tasklist échoue', async () => {
		const sortie = (texte: string | null) => async () => texte;
		expect(await imageProcessusWindows(4242, sortie('"node.exe","4242","Console","1","52 340 K"\r\n'))).toBe('node.exe');
		expect(await imageProcessusWindows(4242, sortie('INFO: aucune tâche en service ne correspond aux critères spécifiés.\r\n'))).toBe('');
		expect(await imageProcessusWindows(4242, sortie('"chrome.exe","42420","Console","1","1 K"\r\n'))).toBe('');
		expect(await imageProcessusWindows(4242, sortie(null))).toBeNull();
		expect(await imageProcessusWindows(0, sortie('"x","0"'))).toBe('');
	});
});
