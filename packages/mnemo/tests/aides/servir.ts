import type { Dependances } from '../../src/application/ports.ts';
import { servir } from '../../src/application/servir.ts';
import type { Servi } from '../../src/application/servir.ts';

/** `servir` au premier message de la session, avec `question` pour message, sans fiche déjà servie, lue ou proposée. */
export function servirQuestion(dep: Dependances, position: string, question: string | null, rappels = true): Promise<Servi> {
	return servir(dep, {
		position,
		message: question ?? '',
		dejaServies: new Map(),
		dejaLues: new Map(),
		proposees: new Map(),
		ecartes: [],
		moment: 'message',
		muet: null,
		premier: true,
		fin: Date.now() + 5000,
		rappels,
	});
}
