import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prendreVerrouBanc as prendreAuCli } from '../../src/adaptateurs/cli/verrou-banc.ts';
import { ErreurCli } from '../../src/adaptateurs/cli/erreurs.ts';
import { ErreurVerrouBanc, prendreVerrouBanc, verrouTenuIci } from '../../src/infra/verrou-banc.ts';
import { dossierTemporaire } from '../aides/dossier-temporaire.ts';

describe('verrou du banc entre le service et le CLI (D7)', () => {
	it('le service ne se vole pas son propre verrou : une deuxième tâche du même processus est refusée en nommant la première', async () => {
		const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
		const rendre = prendreVerrouBanc(fichier, 'préparer des messages', { service: true });
		expect(verrouTenuIci(fichier)).toBe(true);
		expect(JSON.parse(readFileSync(`${fichier}.verrou`, 'utf8'))).toMatchObject({ pid: process.pid, operation: 'préparer des messages', service: true });
		let refus: unknown;
		try {
			prendreVerrouBanc(fichier, 'apprendre', { service: true });
		} catch (e) {
			refus = e;
		}
		expect(refus).toBeInstanceOf(ErreurVerrouBanc);
		expect((refus as ErreurVerrouBanc).message).toMatch(/service Mnemo \(préparer des messages/u);
		// toujours tenu par la première
		expect(existsSync(`${fichier}.verrou`)).toBe(true);
		rendre();
		expect(verrouTenuIci(fichier)).toBe(false);
		expect(existsSync(`${fichier}.verrou`)).toBe(false);
		prendreVerrouBanc(fichier, 'apprendre', { service: true })();
	});

	it("un verrou de ce pid que ce processus ne tient plus (arrêt brutal, pid réutilisé) est repris ; rendre deux fois ne retire pas celui d'une autre prise", async () => {
		const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
		writeFileSync(`${fichier}.verrou`, JSON.stringify({ pid: process.pid, operation: '--juger', depuis: 'x' }));
		const rendre = prendreVerrouBanc(fichier, '--extraire');
		rendre();
		const autre = prendreVerrouBanc(fichier, '--juger');
		rendre();
		expect(existsSync(`${fichier}.verrou`)).toBe(true);
		autre();
	});

	it("le service reprend le verrou « du service » d'un autre processus, même vivant (service d'avant mort, pid réutilisé) ; un verrou du CLI vivant, non", async () => {
		const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
		writeFileSync(`${fichier}.verrou`, JSON.stringify({ pid: process.ppid, operation: 'apprendre la note', depuis: 'x', service: true }));
		const rendre = prendreVerrouBanc(fichier, 'préparer des messages', { service: true });
		expect(JSON.parse(readFileSync(`${fichier}.verrou`, 'utf8'))).toMatchObject({ pid: process.pid, operation: 'préparer des messages' });
		rendre();
		writeFileSync(`${fichier}.verrou`, JSON.stringify({ pid: process.ppid, operation: '--juger', depuis: 'x' }));
		expect(() => prendreVerrouBanc(fichier, 'préparer des messages', { service: true })).toThrow(ErreurVerrouBanc);
	});

	it('le CLI qui trouve le verrou du service (autre pid vivant) refuse en nommant la tâche du service', async () => {
		const fichier = join(await dossierTemporaire(), 'banc-contexte.json');
		// un processus vivant (le parent de ce test) joue le service
		writeFileSync(`${fichier}.verrou`, JSON.stringify({ pid: process.ppid, operation: 'pré-juger avec Claude', depuis: '2026-11-26T10:00:00.000Z', service: true }));
		let refus: unknown;
		try {
			prendreAuCli(fichier, '--juger');
		} catch (e) {
			refus = e;
		}
		expect(refus).toBeInstanceOf(ErreurCli);
		expect((refus as ErreurCli).message).toBe(
			`Le fichier des jugements est utilisé par le service Mnemo (pré-juger avec Claude, processus ${process.ppid}, depuis 2026-11-26T10:00:00.000Z) : attendre la fin de la tâche ou l’arrêter (Mémoire › Entraîner) avant de lancer --juger.`,
		);
	});
});
