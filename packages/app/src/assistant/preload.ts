/**
 * Preload de la fenêtre de l'assistant (et d'elle seule) : expose `window.assistant` (`ApiAssistant`) par `contextBridge`,
 * la plateforme (en lecture seule) et quatre fonctions, rien d'autre. Construit à part en CommonJS (`dist/assistant/preload.cjs`) : un preload en `sandbox`
 * n'est pas un module ES. Tout ce qui passe ici est revalidé par le processus principal.
 */
import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { LigneInit } from '@mnemo/contrat';
import { CANAUX_ASSISTANT as C, type ApiAssistant } from '../domaine/assistant-pont.ts';
import { plateformeApp } from '../domaine/plateforme.ts';

const api: ApiAssistant = {
	plateforme: plateformeApp(process.platform),
	verifierPoste: () => ipcRenderer.invoke(C.verifierPoste),
	choisirDossier: () => ipcRenderer.invoke(C.choisirDossier),
	installer(choix, surLigne) {
		const ecouter = (_e: IpcRendererEvent, ligne: LigneInit) => {
			if (typeof surLigne === 'function') surLigne(ligne);
		};
		ipcRenderer.on(C.ligne, ecouter);
		return ipcRenderer.invoke(C.installer, choix).finally(() => ipcRenderer.removeListener(C.ligne, ecouter));
	},
	terminer: () => ipcRenderer.invoke(C.terminer),
};

contextBridge.exposeInMainWorld('assistant', api);
