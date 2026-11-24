import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { creerServeur, journal, origineDeSession } from '../mcp/serveur.ts';
import { ErreurCli } from './erreurs.ts';
import { racineDeSession } from './racine.ts';
import { cheminReel } from '../../infra/chemin-reel.ts';

const cheminDefini = (chemin: string | undefined): string | undefined => (chemin === undefined || chemin === '' ? chemin : cheminReel(chemin));

/**
 * `mnemo mcp` : serveur MCP sur stdio, lancé par Claude Code pour chaque session. Le projet est `CLAUDE_PROJECT_DIR`
 * (le dossier courant n'est pas garanti) ; la racine est cherchée en remontant depuis lui, puis depuis le dossier courant,
 * et la position part du dossier qui l'a trouvée. Lancé par une session Mnemo (`MNEMO_SESSION`) : instructions réduites.
 * stdout ne porte que le protocole. Arrêt propre (index fermé, file d'extraction arrêtée) puis sortie à la fin de stdin, sur
 * SIGINT et SIGTERM : une extraction en cours ne retient pas le processus.
 */
export async function commandeMcp(args: string[]): Promise<void> {
	if (args.length > 0) throw new ErreurCli('Usage : mnemo mcp', 2);
	const { racine, projet } = racineDeSession(cheminDefini(process.env.CLAUDE_PROJECT_DIR), cheminReel(process.cwd()));
	const serveur = await creerServeur({ racineDossier: racine, dossierProjet: projet, origine: origineDeSession(process.env) });

	let arret: Promise<void> | null = null;
	const arreter = (): Promise<void> => {
		arret ??= serveur.close().catch((erreur: unknown) => journal(`arrêt : ${erreur instanceof Error ? erreur.message : String(erreur)}`));
		return arret;
	};
	// fin de stdin (client parti) comme un signal : sortie aussitôt après l'arrêt, sans attendre une extraction en arrière-plan
	// (son fil isolé et le renouvellement de ses réservations retiendraient le processus jusqu'à son délai)
	const sortir = (): void => void arreter().finally(() => process.exit(0));
	process.stdin.once('end', sortir);
	process.stdin.once('close', sortir);
	for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, sortir);

	await serveur.connect(new StdioServerTransport());
}
