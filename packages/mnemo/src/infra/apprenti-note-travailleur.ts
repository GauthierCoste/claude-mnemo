// Fil d'exécution de l'apprentissage de la note (voir apprenti-note.ts) : reçoit le jeu et les options, rend le rapport.
// Aucun fichier lu ni écrit ici : l'appelant écrit les coefficients.
import { parentPort, workerData } from 'node:worker_threads';
import { apprendreNote } from '../application/apprendre-note.ts';
import type { TravailDApprentissage } from './apprenti-note.ts';

const travail = workerData as TravailDApprentissage;
parentPort!.postMessage(apprendreNote(travail.jeu, travail.options));
