import { open } from 'node:fs/promises';

/**
 * Lignes non vides des `octetsLus` derniers octets d'un fichier (une transcription JSONL qui peut peser des centaines de Mo) :
 * la première ligne, coupée par la lecture, est écartée ; la dernière, peut-être en cours d'écriture, est rendue telle
 * quelle (à l'appelant de l'ignorer si elle ne se lit pas). Null si le fichier est illisible.
 */
export async function lignesDeLaFin(chemin: string, octetsLus: number): Promise<string[] | null> {
	let fichier;
	try {
		fichier = await open(chemin, 'r');
	} catch {
		return null;
	}
	try {
		const { size } = await fichier.stat();
		const debut = Math.max(0, size - octetsLus);
		const tampon = Buffer.alloc(size - debut);
		await fichier.read(tampon, 0, tampon.length, debut);
		const lignes = tampon.toString('utf8').split('\n');
		if (debut > 0) lignes.shift();
		return lignes.filter((l) => l.trim() !== '');
	} catch {
		return null;
	} finally {
		await fichier.close();
	}
}
