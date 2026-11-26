/**
 * Processus principal de l'app Mnemo (Electron) : assemble le domaine, l'infrastructure et Electron. Construit par Vite en
 * `dist/main.js` (ESM). `MNEMO_APP_ESSAI=1` : démarre puis quitte aussitôt (vérification de la construction).
 */
import { demarrerApplication } from './electron/application.ts';

demarrerApplication({ essai: process.env['MNEMO_APP_ESSAI'] === '1', dossierMain: import.meta.dirname });
