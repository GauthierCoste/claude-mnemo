/**
 * Boîtes natives de l'app : la question de « Quitter Mnemo », la désinstallation (question et bilan), le redémarrage après
 * « Reprendre le PATH du terminal », une information, une erreur.
 */
import type { SessionVue } from '@mnemo/contrat';
import { dialog } from 'electron';
import { BOUTON_DESINSTALLER_ANNULER, BOUTONS_DESINSTALLER, type PlanDesinstallation } from '../domaine/desinstallation.ts';
import { BOUTON_QUITTER_ANNULER, BOUTON_QUITTER_DEFAUT, BOUTONS_QUITTER, CASE_NE_PLUS_DEMANDER, questionQuitter, reponseQuitter } from '../domaine/quitter.ts';

/** La question de « Quitter Mnemo » ; rend la suite et le choix à retenir. */
export async function demanderQuitter(sessions: readonly SessionVue[]): Promise<ReturnType<typeof reponseQuitter>> {
	const q = questionQuitter(sessions);
	const r = await dialog.showMessageBox({
		type: 'question',
		message: q.message,
		detail: q.detail,
		buttons: [...BOUTONS_QUITTER],
		defaultId: BOUTON_QUITTER_DEFAUT,
		cancelId: BOUTON_QUITTER_ANNULER,
		checkboxLabel: CASE_NE_PLUS_DEMANDER,
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
		buttons: [...BOUTONS_DESINSTALLER],
		defaultId: BOUTON_DESINSTALLER_ANNULER,
		cancelId: BOUTON_DESINSTALLER_ANNULER,
	});
	return r.response !== BOUTON_DESINSTALLER_ANNULER;
}

/** Le bilan de la désinstallation, avant de quitter. */
export async function direBilan(bilan: { ok: boolean; message: string; detail: string }): Promise<void> {
	await dialog.showMessageBox({ type: bilan.ok ? 'info' : 'warning', message: bilan.message, detail: bilan.detail, buttons: ['Quitter'] });
}

export async function direErreur(message: string, detail: string): Promise<void> {
	await dialog.showMessageBox({ type: 'error', message, detail, buttons: ['OK'] });
}

export async function direInformation(message: string, detail: string): Promise<void> {
	await dialog.showMessageBox({ type: 'info', message, detail, buttons: ['OK'] });
}

/** Après « Reprendre le PATH du terminal », service vivant : vrai pour « Redémarrer le service » (par défaut), faux pour « Plus tard ». */
export async function demanderRedemarrer(path: string): Promise<boolean> {
	const r = await dialog.showMessageBox({
		type: 'question',
		message: 'PATH du terminal repris. Redémarrer le service ?',
		detail: `Les nouvelles sessions Claude Code lancées par Mnemo le recevront une fois le service redémarré ; les sessions en cours s’arrêtent avec lui.\n\n${path}`,
		buttons: ['Redémarrer le service', 'Plus tard'],
		defaultId: 0,
		cancelId: 1,
	});
	return r.response === 0;
}
