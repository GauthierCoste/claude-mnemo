/**
 * Coquille de l'interface : dans l'app de bureau (dont l'agent utilisateur porte ` MnemoApp/<version>`), la
 * fenêtre devient l'app (ni marge, ni bordure, ni arrondi, ni ombre ; barre de titre poignée de la fenêtre, voir
 * `styles/coquille.css` et les règles `[data-coquille='app']` des modules). Dans un navigateur, rien n'est posé.
 */

/** Vrai si l'agent utilisateur est celui de l'app de bureau de Mnemo. */
export function estAppDeBureau(agent: string): boolean {
	return agent.includes('MnemoApp/');
}

/** Pose `data-coquille="app"` sur la racine du document dans l'app de bureau ; ne touche à rien sinon. */
export function poserCoquille(racine: HTMLElement, agent: string): void {
	if (estAppDeBureau(agent)) racine.dataset['coquille'] = 'app';
}
