/**
 * Boîtes natives de l'app : la question de « Quitter Mnemo », la désinstallation (question et bilan), le redémarrage après
 * « Reprendre le PATH du terminal », une information, une erreur. Dans la langue des textes donnés.
 */
import type { SessionVue } from '@mnemo/contrat';
import { dialog } from 'electron';
import { BOUTON_DESINSTALLER_ANNULER, type PlanDesinstallation } from '../domaine/desinstallation.ts';
import type { TextesApp } from '../domaine/langue/textes.ts';
import { BOUTON_QUITTER_ANNULER, BOUTON_QUITTER_DEFAUT, questionQuitter, reponseQuitter } from '../domaine/quitter.ts';

/** La question de « Quitter Mnemo » ; rend la suite et le choix à retenir. */
export async function demanderQuitter(sessions: readonly SessionVue[], t: TextesApp): Promise<ReturnType<typeof reponseQuitter>> {
	const q = questionQuitter(sessions, t);
	const r = await dialog.showMessageBox({
		type: 'question',
		message: q.message,
		detail: q.detail,
		buttons: q.boutons,
		defaultId: BOUTON_QUITTER_DEFAUT,
		cancelId: BOUTON_QUITTER_ANNULER,
		checkboxLabel: q.case,
		checkboxChecked: false,
	});
	return reponseQuitter(r.response, r.checkboxChecked);
}

/** « Désinstaller Mnemo… » : ce qui sera retiré, ce qui reste ; vrai si confirmé (Annuler par défaut). */
export async function demanderDesinstaller(plan: PlanDesinstallation): Promise<boolean> {
	const r = await dialog.showMessageBox({
		type: 'warning',
		message: plan.message,
		detail: plan.detail,
		buttons: plan.boutons,
		defaultId: BOUTON_DESINSTALLER_ANNULER,
		cancelId: BOUTON_DESINSTALLER_ANNULER,
	});
	return r.response !== BOUTON_DESINSTALLER_ANNULER;
}

/** Le bilan de la désinstallation, avant de quitter. */
export async function direBilan(bilan: { ok: boolean; message: string; detail: string }, t: TextesApp): Promise<void> {
	await dialog.showMessageBox({ type: bilan.ok ? 'info' : 'warning', message: bilan.message, detail: bilan.detail, buttons: [t.boites.quitter] });
}

export async function direErreur(message: string, detail: string, t: TextesApp): Promise<void> {
	await dialog.showMessageBox({ type: 'error', message, detail, buttons: [t.boites.ok] });
}

export async function direInformation(message: string, detail: string, t: TextesApp): Promise<void> {
	await dialog.showMessageBox({ type: 'info', message, detail, buttons: [t.boites.ok] });
}

/** Après « Reprendre le PATH du terminal », service vivant : vrai pour « Redémarrer le service » (par défaut), faux pour « Plus tard ». */
export async function demanderRedemarrer(path: string, t: TextesApp): Promise<boolean> {
	const b = t.boites.redemarrer;
	const r = await dialog.showMessageBox({
		type: 'question',
		message: b.message,
		detail: b.detail(path),
		buttons: [b.redemarrer, b.plusTard],
		defaultId: 0,
		cancelId: 1,
	});
	return r.response === 0;
}
