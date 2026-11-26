import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { fichiersDuZip } from '../../outils/zip.ts';

async function archive(remplir: (zip: JSZip) => void): Promise<Buffer> {
	const zip = new JSZip();
	remplir(zip);
	return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', platform: 'UNIX' });
}

describe('lecture d’une archive zip', () => {
	it('les fichiers demandés, décompressés ; rien d’autre', async () => {
		const donnees = await archive((zip) => {
			zip.file('a/node.exe', 'binaire '.repeat(1000));
			zip.file('a/LICENSE', 'licence');
			zip.file('a/autre.txt', 'autre');
		});
		const lus = await fichiersDuZip(donnees, ['a/node.exe', 'a/LICENSE']);
		expect([...lus.keys()]).toEqual(['a/node.exe', 'a/LICENSE']);
		expect(lus.get('a/node.exe')!.toString('utf8')).toBe('binaire '.repeat(1000));
		expect(lus.get('a/LICENSE')!.toString('utf8')).toBe('licence');
	});

	it('absent, dossier ou lien symbolique : refusé', async () => {
		const donnees = await archive((zip) => {
			zip.folder('a/dossier');
			zip.file('a/lien', '/bin/sh', { unixPermissions: 0o120777 });
			zip.file('a/fichier', 'x', { unixPermissions: 0o100644 });
		});
		await expect(fichiersDuZip(donnees, ['a/absent'])).rejects.toThrow(/absent/u);
		await expect(fichiersDuZip(donnees, ['a/dossier/'])).rejects.toThrow(/absent/u);
		await expect(fichiersDuZip(donnees, ['a/lien'])).rejects.toThrow(/lien/u);
		expect((await fichiersDuZip(donnees, ['a/fichier'])).get('a/fichier')!.toString('utf8')).toBe('x');
	});

	it('pas une archive zip : refusé', async () => {
		await expect(fichiersDuZip(Buffer.from('pas un zip'), ['x'])).rejects.toThrow(/illisible/u);
	});
});
