// Fil d'exécution isolé : un temps de l'extraction d'UN fichier (voir extraction-isolee.ts), puis le résultat.
// `decouper` : le fichier neuf découpé, sans ses pièces jointes ; `extraire` : les passages de chaque cible, sans les pièces ;
// `pieces` : des pièces jointes, une à une, chaque issue rendue dès qu'elle est prête (`piece`).
// Le fichier n'est pas transmis : le fil en demande les morceaux au processus (`lire`), à mesure que l'extraction les lit.
import { parentPort, workerData } from 'node:worker_threads';
import { decouperSansPieces, extrairePieces, extraireSansPieces } from '../application/extraire-passages.ts';
import type { DemandePiece } from '../application/extraire-passages.ts';
import type { CibleExtraction, Contenu } from '../application/ports.ts';
import { extracteursReels } from './extracteurs/index.ts';
import type { MessageDuFil, MessageVersLeFil } from './extraction-isolee.ts';

/** Ce que le fil reçoit : le fichier (nom, taille) et le temps à faire. */
export type Travail =
	| { mode: 'decouper'; chemin: string; taille: number }
	| { mode: 'extraire'; chemin: string; taille: number; cibles: CibleExtraction[] }
	| { mode: 'pieces'; chemin: string; taille: number; demandes: DemandePiece[]; budget: number };

const travail = workerData as Travail;
const port = parentPort!;
const attente = new Map<number, { resoudre(octets: Uint8Array): void; rejeter(erreur: Error): void }>();
let suivant = 0;

port.on('message', (m: MessageVersLeFil) => {
	const demande = attente.get(m.id);
	if (demande === undefined) return;
	attente.delete(m.id);
	if (m.erreur !== undefined) demande.rejeter(new Error(m.erreur));
	else demande.resoudre(m.octets!);
});

const contenu: Contenu = {
	taille: travail.taille,
	lire(position, longueur) {
		return new Promise((resoudre, rejeter) => {
			const id = suivant++;
			attente.set(id, { resoudre, rejeter });
			port.postMessage({ type: 'lire', id, position, longueur } satisfies MessageDuFil);
		});
	},
};

const extracteurs = extracteursReels();
let resultat: unknown = null;
if (travail.mode === 'decouper') resultat = await decouperSansPieces(extracteurs, travail.chemin, contenu);
else if (travail.mode === 'extraire') resultat = await extraireSansPieces(extracteurs, travail.chemin, contenu, travail.cibles);
else await extrairePieces(extracteurs, travail.chemin, contenu, travail.demandes, travail.budget, (issue) => port.postMessage({ type: 'piece', issue } satisfies MessageDuFil));
port.postMessage({ type: 'resultat', resultat } satisfies MessageDuFil);
// plus rien à attendre du processus : le fil peut s'arrêter
port.close();
