/**
 * Modèle du menu de la barre des menus, en données pures : Electron le traduit tel quel (`src/electron/`). Ordre :
 * « Ouvrir Mnemo » ; les sessions actives (un clic ouvre la fenêtre sur la session) ; le service (démarrer, arrêter,
 * redémarrer) ; « Ouvrir à l'ouverture de session » ; « Journal du service » ; « Reprendre le PATH du terminal » ; la version de l'app, la version plus récente
 * publiée s'il y en a une (un clic ouvre sa page), « Chercher les nouvelles versions », « Désinstaller Mnemo… » ;
 * « Quitter Mnemo ».
 */
import type { SessionVue } from '@mnemo/contrat';
import type { EtatVie } from './vie-service.ts';
import type { VersionPubliee } from './version.ts';
import { dossierAffiche, LIBELLES_ETATS, libelleSession, sessionsActives } from './sessions.ts';

/** Nombre de sessions listées dans le menu au plus ; au-delà, une ligne qui ouvre la fenêtre. */
export const SESSIONS_MENU_MAX = 10;

export type ActionMenu =
	| { type: 'ouvrir' }
	| { type: 'ouvrirSession'; session: string }
	| { type: 'demarrerService' }
	| { type: 'arreterService' }
	/** Coche ou décoche « Ouvrir à l'ouverture de session » : `active` est la nouvelle valeur. */
	| { type: 'ouvertureSession'; active: boolean }
	| { type: 'journal' }
	/** Relit le `PATH` du shell de connexion, l'écrit dans la configuration, propose de redémarrer le service. */
	| { type: 'reprendrePath' }
	/** Ouvre la page de la version publiée (lien déjà vérifié : une page de version du dépôt). */
	| { type: 'nouvelleVersion'; url: string }
	/** Coche ou décoche « Chercher les nouvelles versions » : `active` est la nouvelle valeur. */
	| { type: 'chercherVersions'; active: boolean }
	| { type: 'desinstaller' }
	| { type: 'quitter' };

export type ElementMenu =
	/** `detail` : seconde ligne (état et dossier d'une session) ; `actif` faux : grisé. */
	| { type: 'action'; libelle: string; detail: string | null; actif: boolean; action: ActionMenu }
	| { type: 'case'; libelle: string; coche: boolean; action: ActionMenu }
	/** Texte grisé, sans action. */
	| { type: 'texte'; libelle: string }
	| { type: 'separateur' };

export type EntreeMenu = {
	vie: EtatVie;
	/** Raison de l'erreur du service (`VieService.raison`). */
	raison: string | null;
	sessions: readonly SessionVue[];
	/** L'app s'ouvre à l'ouverture de session. */
	ouvertureSession: boolean;
	/** Version de l'app. */
	version: string;
	/** Version publiée plus récente que celle de l'app, ou null. */
	nouvelleVersion: VersionPubliee | null;
	chercherVersions: boolean;
};

const action = (libelle: string, a: ActionMenu, actif = true, detail: string | null = null): ElementMenu => ({ type: 'action', libelle, detail, actif, action: a });
const SEPARATEUR: ElementMenu = { type: 'separateur' };

export function modeleMenu(entree: EntreeMenu): ElementMenu[] {
	const vivant = entree.vie === 'vivant';
	return [
		action('Ouvrir Mnemo', { type: 'ouvrir' }, vivant),
		SEPARATEUR,
		...partieSessions(entree),
		SEPARATEUR,
		elementService(entree.vie),
		{ type: 'case', libelle: 'Ouvrir à l’ouverture de session', coche: entree.ouvertureSession, action: { type: 'ouvertureSession', active: !entree.ouvertureSession } },
		action('Journal du service', { type: 'journal' }),
		action('Reprendre le PATH du terminal', { type: 'reprendrePath' }),
		SEPARATEUR,
		{ type: 'texte', libelle: `Mnemo ${entree.version}` },
		...(entree.nouvelleVersion === null ? [] : [action(`Version ${entree.nouvelleVersion.version} disponible`, { type: 'nouvelleVersion', url: entree.nouvelleVersion.url })]),
		{ type: 'case', libelle: 'Chercher les nouvelles versions', coche: entree.chercherVersions, action: { type: 'chercherVersions', active: !entree.chercherVersions } },
		action('Désinstaller Mnemo…', { type: 'desinstaller' }),
		SEPARATEUR,
		action('Quitter Mnemo', { type: 'quitter' }),
	];
}

/** Sessions actives (service vivant) ; sinon l'état du service en clair. */
function partieSessions(entree: EntreeMenu): ElementMenu[] {
	switch (entree.vie) {
		case 'arrete':
			return [{ type: 'texte', libelle: 'Service arrêté' }];
		case 'demarrage':
			return [{ type: 'texte', libelle: 'Démarrage du service…' }];
		case 'arret':
			return [{ type: 'texte', libelle: 'Arrêt du service…' }];
		case 'erreur':
			return [{ type: 'texte', libelle: entree.raison ?? 'Le service ne répond pas' }];
		case 'vivant': {
			const actives = sessionsActives(entree.sessions);
			if (actives.length === 0) return [{ type: 'texte', libelle: 'Aucune session active' }];
			const listees = actives.slice(0, SESSIONS_MENU_MAX).map((s) => action(libelleSession(s), { type: 'ouvrirSession', session: s.id }, true, `${LIBELLES_ETATS[s.etat]} · ${dossierAffiche(s)}`));
			const reste = actives.length - listees.length;
			return reste > 0 ? [...listees, action(`${reste} autre${reste > 1 ? 's' : ''} session${reste > 1 ? 's' : ''}…`, { type: 'ouvrir' })] : listees;
		}
	}
}

function elementService(vie: EtatVie): ElementMenu {
	switch (vie) {
		case 'arrete':
			return action('Démarrer le service', { type: 'demarrerService' });
		case 'demarrage':
			return action('Démarrer le service', { type: 'demarrerService' }, false);
		case 'erreur':
			return action('Redémarrer le service', { type: 'demarrerService' });
		case 'vivant':
			return action('Arrêter le service', { type: 'arreterService' });
		case 'arret':
			return action('Arrêter le service', { type: 'arreterService' }, false);
	}
}
