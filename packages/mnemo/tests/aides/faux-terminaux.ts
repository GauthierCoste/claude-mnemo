import type { OptionsTerminal, Terminal, Terminaux } from '../../src/application/ports.ts';

/** Un terminal simulé : rien n'est lancé ; le test émet la sortie (`emettre`) et la fin (`finir`). */
export type FauxTerminal = Terminal & {
	options: OptionsTerminal;
	ecrits: string[];
	tailles: [number, number][];
	/** Délais reçus par `arreter` (undefined : celui par défaut). */
	arrets: (number | undefined)[];
	/** Options reçues par `arreter` (`echap` : un Échap précède `/exit` ; `sansTouche` : signaux seulement). */
	optionsArret: ({ echap?: boolean; sansTouche?: boolean } | undefined)[];
	/** Nombre d'écritures (`ecrits`) déjà faites à chaque appel de `arreter` : l'ordre des écritures et des arrêts. */
	ecritsAvantArret: number[];
	/** Instant (`Date.now()`) de chaque écriture, dans l'ordre de `ecrits`. */
	instants: number[];
	fini: boolean;
	emettre(d: string): void;
	finir(code: number | null): void;
};

export type FauxTerminaux = Terminaux & {
	lances: FauxTerminal[];
	/** Mode dégradé : `disponibles()` rend ce motif. */
	indisponible: string | null;
	/** `arreter` finit le processus aussitôt (sinon le test appelle `finir`). */
	arretFinit: boolean;
};

let prochainPid = 700_000;

export function fauxTerminaux(): FauxTerminaux {
	const lances: FauxTerminal[] = [];
	const t: FauxTerminaux = {
		lances,
		indisponible: null,
		arretFinit: true,
		disponibles() {
			return t.indisponible === null ? { ok: true } : { ok: false, motif: t.indisponible };
		},
		lancer(options) {
			const sorties = new Set<(d: string) => void>();
			const fins: ((code: number | null) => void)[] = [];
			let code: number | null = null;
			let attenteFin: Promise<void> | null = null;
			let resoudreFin: () => void = () => {};
			const terminal: FauxTerminal = {
				pid: prochainPid++,
				options,
				ecrits: [],
				tailles: [],
				arrets: [],
				optionsArret: [],
				ecritsAvantArret: [],
				instants: [],
				fini: false,
				ecrire(d) {
					terminal.ecrits.push(d);
					terminal.instants.push(Date.now());
				},
				redimensionner(c, l) {
					terminal.tailles.push([c, l]);
				},
				surSortie(f) {
					sorties.add(f);
					return () => sorties.delete(f);
				},
				surFin(f) {
					if (terminal.fini) f(code);
					else fins.push(f);
				},
				emettre(d) {
					for (const f of sorties) f(d);
				},
				finir(c) {
					if (terminal.fini) return;
					terminal.fini = true;
					code = c;
					for (const f of fins) f(c);
					resoudreFin();
				},
				arreter(delaiMs, options) {
					terminal.arrets.push(delaiMs);
					terminal.optionsArret.push(options);
					terminal.ecritsAvantArret.push(terminal.ecrits.length);
					attenteFin ??= new Promise<void>((r) => {
						resoudreFin = r;
					});
					if (terminal.fini) return Promise.resolve();
					if (t.arretFinit) queueMicrotask(() => terminal.finir(null));
					return attenteFin;
				},
			};
			lances.push(terminal);
			return terminal;
		},
	};
	return t;
}
