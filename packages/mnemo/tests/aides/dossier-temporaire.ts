import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

const crees: string[] = [];

afterEach(async () => {
	while (crees.length > 0) {
		await rm(crees.pop() as string, { recursive: true, force: true });
	}
});

/** Crée un dossier temporaire neuf, supprimé après chaque test. */
export async function dossierTemporaire(): Promise<string> {
	const dossier = await mkdtemp(join(tmpdir(), 'mnemo-test-'));
	crees.push(dossier);
	return dossier;
}
