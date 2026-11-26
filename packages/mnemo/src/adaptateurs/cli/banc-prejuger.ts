/**
 * `mnemo banc contexte --prejuger` : le juge Claude propose un jugement pour chaque candidate des messages à juger qui n'en
 * ont pas encore (spec « entraîner la note », D4). Sous le verrou du banc ; les propositions de chaque message sont
 * enregistrées dès qu'il est jugé ; Ctrl-C arrête proprement (ce qui est enregistré le reste).
 */
import { fusionnerPrejugements, prejuger } from '../../application/prejuger.ts';
import type { BilanPrejuger, Juge } from '../../application/prejuger.ts';
import type { Executer } from '../../application/ports.ts';
import { executeurReel } from '../../infra/executeur.ts';
import { jugeClaude } from '../../infra/juge-claude.ts';
import { trouverClaude } from '../../infra/moteurs/claude-code/trouver-claude.ts';
import { lireCasDuFichier } from './banc-contexte.ts';
import { enregistrerCas } from './banc-juger.ts';
import { ErreurCli } from './erreurs.ts';
import { prendreVerrouBanc } from './verrou-banc.ts';

const CLAUDE_INTROUVABLE = '`claude` introuvable (PATH, ou MNEMO_CLAUDE) : le juge Claude ne peut pas être lancé.';

/** `synthese` : synthèse courte d'une fiche ; `nombre` : au plus tant de messages ; `signal` : arrêt. */
export type OptionsPrejugerLeBanc = { juge: Juge; synthese: (chemin: string) => string; nombre?: number; signal?: AbortSignal; avancement?: (faits: number, total: number) => void };

/**
 * Pré-juge les messages du fichier des jugements, sous son verrou. Chaque message jugé est écrit aussitôt : le fichier est relu
 * et seules ses propositions y sont ajoutées (`fusionnerPrejugements`).
 */
export async function prejugerLeBanc(fichier: string, o: OptionsPrejugerLeBanc): Promise<BilanPrejuger> {
	const rendre = prendreVerrouBanc(fichier, '--prejuger');
	try {
		const cas = await lireCasDuFichier(fichier);
		return await prejuger(cas, {
			juge: o.juge,
			synthese: o.synthese,
			enregistrer: async (cible, propositions) => enregistrerCas(fichier, fusionnerPrejugements(await lireCasDuFichier(fichier), cible, propositions)),
			...(o.nombre === undefined ? {} : { nombre: o.nombre }),
			...(o.signal === undefined ? {} : { signal: o.signal }),
			...(o.avancement === undefined ? {} : { avancement: o.avancement }),
		});
	} finally {
		rendre();
	}
}

/** Le bilan en mots. */
export function bilanPrejugementEnTexte(b: BilanPrejuger, fichier: string): string {
	if (b.juges + b.echecs + b.restants === 0) return `Aucun message à pré-juger dans ${fichier} (tous ont déjà des propositions, ou sont jugés). Ajoutez-en avec --extraire.`;
	return [
		`${b.juges} message(s) pré-jugé(s), ${b.echecs} en échec${b.restants === 0 ? '' : `, ${b.restants} non faits (arrêté)`} ; propositions enregistrées dans ${fichier}.`,
		...b.motifs.slice(0, 5).map((m) => `  échec : ${m}`),
		...(b.juges === 0 ? [] : ["Ensuite : relisez et validez les propositions (Mémoire › Entraîner) : elles ne comptent qu'une fois validées."]),
		...(b.echecs + b.restants === 0 ? [] : ['Relancez --prejuger pour reprendre les messages restants.']),
	].join('\n');
}

/**
 * `--prejuger` : le juge Claude (`claude -p`, abonnement de l'utilisateur), deux appels à la fois ; progression sur la sortie
 * d'erreur ; Ctrl-C ou SIGTERM arrêtent (les `claude -p` en cours sont tués). `executer` : l'exécuteur réel par défaut.
 */
export async function commandePrejuger(fichier: string, o: { nombre: number | null; json: boolean; synthese: (chemin: string) => string }, executer: Executer = executeurReel()): Promise<void> {
	const claude = trouverClaude(process.env, process.platform);
	if (claude === null) throw new ErreurCli(CLAUDE_INTROUVABLE);
	const abandon = new AbortController();
	const arreter = (): void => abandon.abort();
	process.once('SIGINT', arreter);
	process.once('SIGTERM', arreter);
	try {
		const bilan = await prejugerLeBanc(fichier, {
			juge: jugeClaude({ executer, claude, env: process.env }),
			synthese: o.synthese,
			signal: abandon.signal,
			...(o.nombre === null ? {} : { nombre: o.nombre }),
			avancement: (faits, total) => {
				if (o.json) return;
				if (faits === 0) process.stderr.write(`${total} message(s) à pré-juger : ${total} appel(s) à claude -p, deux à la fois (abonnement Claude). Ctrl-C arrête.\n`);
				process.stderr.write(`\rMessages pré-jugés : ${faits} / ${total}${faits === total ? '\n' : ''}`);
			},
		});
		if (abandon.signal.aborted && !o.json) process.stderr.write('\n');
		console.log(o.json ? JSON.stringify(bilan) : bilanPrejugementEnTexte(bilan, fichier));
	} finally {
		process.off('SIGINT', arreter);
		process.off('SIGTERM', arreter);
	}
}
