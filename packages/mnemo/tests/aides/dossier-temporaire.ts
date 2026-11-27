import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const crees: string[] = [];

afterEach(async () => {
	while (crees.length > 0) {
		// maxRetries : sous Windows, un fichier tenu un instant de plus (processus git qui finit, antivirus) refuse d'abord
		// d'être supprimé (EBUSY, EPERM) ; un fichier gardé ouvert par le test échoue quand même
		await rm(crees.pop() as string, { recursive: true, force: true, maxRetries: 5 });
	}
});

/** Crée un dossier temporaire neuf, supprimé après chaque test. */
export async function dossierTemporaire(): Promise<string> {
	const dossier = await mkdtemp(join(tmpdir(), 'mnemo-test-'));
	crees.push(dossier);
	return dossier;
}
