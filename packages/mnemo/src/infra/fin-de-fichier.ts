import { constants } from 'node:fs';
import { open } from 'node:fs/promises';

/** Sans attente à l'ouverture : une FIFO (ou un autre fichier spécial) ne bloque jamais la lecture ; absent sous Windows. */
const OUVERTURE = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0);

/**
 * Lignes non vides des `octetsLus` derniers octets d'un fichier ordinaire (une transcription JSONL qui peut peser des
 * centaines de Mo) : la première ligne, coupée par la lecture, est écartée ; la dernière, peut-être en cours d'écriture, est
 * rendue telle quelle (à l'appelant de l'ignorer si elle ne se lit pas). Null si le fichier est illisible ou n'est pas un
 * fichier ordinaire (FIFO, périphérique, dossier).
 */
export async function lignesDeLaFin(chemin: string, octetsLus: number): Promise<string[] | null> {
	let fichier;
	try {
		fichier = await open(chemin, OUVERTURE);
	} catch {
		return null;
	}
	try {
		const infos = await fichier.stat();
		if (!infos.isFile()) return null;
		const debut = Math.max(0, infos.size - octetsLus);
		const tampon = Buffer.alloc(infos.size - debut);
		const { bytesRead } = await fichier.read(tampon, 0, tampon.length, debut);
		const lignes = tampon.subarray(0, bytesRead).toString('utf8').split('\n');
		if (debut > 0) lignes.shift();
		return lignes.filter((l) => l.trim() !== '');
	} catch {
		return null;
	} finally {
		await fichier.close();
	}
}
