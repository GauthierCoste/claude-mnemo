// Script de bilan de `faux-claude` (variable `FAUX_CLAUDE_BILAN`) : ce que Claude ferait au bilan, sans MCP — l'épisode de la
// session écrit par `proposer` genre `episode`, avec l'origine tirée de l'environnement de la session (`MNEMO_SESSION`,
// `MNEMO_PROJET`, `MNEMO_RACINE`). Affiche le statut du résultat.
import { proposer } from '../../src/application/proposer.ts';
import { origineDeSession } from '../../src/adaptateurs/mcp/serveur.ts';
import { dependancesReelles, etatParesseux } from '../../src/infra/systeme.ts';

const racine = process.env.MNEMO_RACINE ?? '';
const origine = origineDeSession(process.env);
const dep = dependancesReelles(racine);
const sessions = etatParesseux(racine);
if (origine !== null) dep.origine = origine;
dep.sessions = sessions;
try {
	const r = await proposer(dep, {
		genre: 'episode',
		titre: 'Bilan rédigé par Claude',
		synthese: 'La session a écrit le fichier a.txt.',
		decisions: ['Écrire a.txt à la racine du projet : le plus simple.'],
		resultat: 'Terminé.',
		fichiers: ['a.txt'],
	});
	console.log(r.statut === 'refuse' ? `refuse ${r.motif}` : r.statut);
} finally {
	dep.index.fermer();
	sessions.fermer();
}
