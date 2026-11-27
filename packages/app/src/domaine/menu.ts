/**
 * Modèle du menu de la barre des menus, en données pures : Electron le traduit tel quel (`src/electron/`). Ordre :
 * « Ouvrir Mnemo » ; les sessions actives (un clic ouvre la fenêtre sur la session) ; le service (démarrer, arrêter,
 * redémarrer) ; « Ouvrir à l'ouverture de session » ; « Journal du service » ; « Reprendre le PATH du terminal » ; la version de l'app, la version plus récente
 * publiée s'il y en a une (un clic ouvre sa page), « Chercher les nouvelles versions », « Désinstaller Mnemo… » ;
 * « Quitter Mnemo ».
 *
 * Sous Windows : pas de « Reprendre le PATH du terminal » (pas de shell de connexion à lire : l'app reçoit le `Path` du
 * compte, et le service comme les commandes de `mnemo` sont lancés avec celui du processus de l'app, pas celui de la
 * configuration : voir `infra/environnement.ts`) ; le détail d'une session (seconde ligne, ignorée par Windows) va dans son
 * libellé.
 */
import type { SessionVue } from '@mnemo/contrat';
import { TEXTES_FR, type TextesApp } from './langue/textes.ts';
import type { PlateformeApp } from './plateforme.ts';
import type { EtatVie } from './vie-service.ts';
import type { VersionPubliee } from './version.ts';
import { dossierAffiche, libelleSession, sessionsActives } from './sessions.ts';

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
	plateforme: PlateformeApp;
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
	/** Langue des libellés ; par défaut le français. */
	textes?: TextesApp;
};

const action = (libelle: string, a: ActionMenu, actif = true, detail: string | null = null): ElementMenu => ({ type: 'action', libelle, detail, actif, action: a });
const SEPARATEUR: ElementMenu = { type: 'separateur' };

export function modeleMenu(entree: EntreeMenu): ElementMenu[] {
	const t = entree.textes ?? TEXTES_FR;
	const m = t.menu;
	const vivant = entree.vie === 'vivant';
	return [
		action(m.ouvrir, { type: 'ouvrir' }, vivant),
		SEPARATEUR,
		...partieSessions(entree, t),
		SEPARATEUR,
		elementService(entree.vie, t),
		{ type: 'case', libelle: m.ouvertureSession, coche: entree.ouvertureSession, action: { type: 'ouvertureSession', active: !entree.ouvertureSession } },
		action(m.journal, { type: 'journal' }),
		...(entree.plateforme === 'win32' ? [] : [action(m.reprendrePath, { type: 'reprendrePath' })]),
		SEPARATEUR,
		{ type: 'texte', libelle: m.version(entree.version) },
		...(entree.nouvelleVersion === null ? [] : [action(m.nouvelleVersion(entree.nouvelleVersion.version), { type: 'nouvelleVersion', url: entree.nouvelleVersion.url })]),
		{ type: 'case', libelle: m.chercherVersions, coche: entree.chercherVersions, action: { type: 'chercherVersions', active: !entree.chercherVersions } },
		action(m.desinstaller, { type: 'desinstaller' }),
		SEPARATEUR,
		action(m.quitter, { type: 'quitter' }),
	];
}

/** Sessions actives (service vivant) ; sinon l'état du service en clair. */
function partieSessions(entree: EntreeMenu, t: TextesApp): ElementMenu[] {
	const m = t.menu;
	switch (entree.vie) {
		case 'arrete':
			return [{ type: 'texte', libelle: m.serviceArrete }];
		case 'demarrage':
			return [{ type: 'texte', libelle: m.demarrage }];
		case 'arret':
			return [{ type: 'texte', libelle: m.arret }];
		case 'erreur':
			return [{ type: 'texte', libelle: entree.raison ?? m.erreur }];
		case 'vivant': {
			const actives = sessionsActives(entree.sessions);
			if (actives.length === 0) return [{ type: 'texte', libelle: m.aucuneSession }];
			const listees = actives.slice(0, SESSIONS_MENU_MAX).map((s) => {
				const detail = m.detailSession(t.sessions.etats[s.etat], dossierAffiche(s, t));
				const ouvrir: ActionMenu = { type: 'ouvrirSession', session: s.id };
				return entree.plateforme === 'win32' ? action(m.sessionEnLigne(libelleSession(s, t), detail), ouvrir) : action(libelleSession(s, t), ouvrir, true, detail);
			});
			const reste = actives.length - listees.length;
			return reste > 0 ? [...listees, action(m.autresSessions(reste), { type: 'ouvrir' })] : listees;
		}
	}
}

function elementService(vie: EtatVie, t: TextesApp): ElementMenu {
	const m = t.menu;
	switch (vie) {
		case 'arrete':
			return action(m.demarrer, { type: 'demarrerService' });
		case 'demarrage':
			return action(m.demarrer, { type: 'demarrerService' }, false);
		case 'erreur':
			return action(m.redemarrer, { type: 'demarrerService' });
		case 'vivant':
			return action(m.arreter, { type: 'arreterService' });
		case 'arret':
			return action(m.arreter, { type: 'arreterService' }, false);
	}
}
