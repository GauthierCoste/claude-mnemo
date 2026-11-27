import { afterEach } from 'vitest';
import type { Dependances } from '../../src/application/ports.ts';
import { dependancesReelles } from '../../src/infra/systeme.ts';
import { dossierTemporaire } from './dossier-temporaire.ts';

const ouvertes: Dependances[] = [];

// Bases SQLite (index, lots) fermées après chaque test, avant la suppression du dossier temporaire : Windows refuse de
// supprimer un fichier ouvert (EBUSY). Ce module importe dossier-temporaire.ts, dont le `afterEach` est donc inscrit avant
// celui-ci, et passe après (les `afterEach` s'exécutent en pile).
afterEach(() => {
	while (ouvertes.length > 0) {
		const dep = ouvertes.pop()!;
		dep.index.fermer();
		dep.lots.fermer();
	}
});

/** Les ports réels de `racine` (un dossier temporaire), fermés après le test. */
export function dependancesFermees(racine: string): Dependances {
	const dep = dependancesReelles(racine);
	ouvertes.push(dep);
	return dep;
}
