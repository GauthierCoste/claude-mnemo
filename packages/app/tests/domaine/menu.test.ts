import { describe, expect, it } from 'vitest';
import { type ElementMenu, modeleMenu, SESSIONS_MENU_MAX } from '../../src/domaine/menu.ts';
import { session } from '../aides/sessions.ts';

/** Le menu en lignes de texte lisibles : `[x]` case cochée, `( )` grisé, `—` séparateur. */
function lignes(menu: ElementMenu[]): string[] {
	return menu.map((e) => {
		switch (e.type) {
			case 'separateur':
				return '—';
			case 'texte':
				return `( ${e.libelle} )`;
			case 'case':
				return `[${e.coche ? 'x' : ' '}] ${e.libelle}`;
			case 'action':
				return `${e.actif ? '' : '( ) '}${e.libelle}${e.detail === null ? '' : ` | ${e.detail}`}`;
		}
	});
}

const base = { plateforme: 'darwin', raison: null, ouvertureSession: false, version: '1.5.0', nouvelleVersion: null, chercherVersions: true } as const;

describe('menu de la barre des menus', () => {
	it('service vivant : les sessions actives (objectif, état, dossier), puis arrêter, la case, le journal, quitter', () => {
		const menu = modeleMenu({
			...base,
			vie: 'vivant',
			ouvertureSession: true,
			sessions: [
				session({ id: 't', objectif: 'Préparer le devis', etat: 'travaille', creeeMs: 1 }),
				session({ id: 'a', objectif: 'Relire le contrat', etat: 'attend', dossier: '', creeeMs: 2 }),
				session({ id: 'p', etat: 'en_pause' }),
			],
		});
		expect(lignes(menu)).toEqual([
			'Ouvrir Mnemo',
			'—',
			'Relire le contrat | Attend ta réponse · racine',
			'Préparer le devis | Travaille · clients/exemple',
			'—',
			'Arrêter le service',
			'[x] Ouvrir à l’ouverture de session',
			'Journal du service',
			'Reprendre le PATH du terminal',
			'—',
			'( Mnemo 1.5.0 )',
			'[x] Chercher les nouvelles versions',
			'Désinstaller Mnemo…',
			'—',
			'Quitter Mnemo',
		]);
		expect(menu[2]).toMatchObject({ action: { type: 'ouvrirSession', session: 'a' } });
		expect(menu[5]).toMatchObject({ action: { type: 'arreterService' } });
		expect(menu[6]).toMatchObject({ action: { type: 'ouvertureSession', active: false } });
		expect(menu[8]).toMatchObject({ actif: true, action: { type: 'reprendrePath' } });
	});

	it('sous Windows : pas de « Reprendre le PATH du terminal », le détail d’une session dans son libellé', () => {
		const menu = modeleMenu({ ...base, plateforme: 'win32', vie: 'vivant', sessions: [session({ id: 'a', objectif: 'Relire le contrat', etat: 'attend', dossier: '' })] });
		expect(lignes(menu).slice(0, 8)).toEqual(['Ouvrir Mnemo', '—', 'Relire le contrat — Attend ta réponse · racine', '—', 'Arrêter le service', '[ ] Ouvrir à l’ouverture de session', 'Journal du service', '—']);
		expect(menu[2]).toMatchObject({ detail: null, action: { type: 'ouvrirSession', session: 'a' } });
		expect(menu.some((e) => e.type === 'action' && e.action.type === 'reprendrePath')).toBe(false);
	});

	it('« Reprendre le PATH du terminal » : toujours là (le menu n’existe qu’avec une configuration), quel que soit le service', () => {
		for (const vie of ['arrete', 'demarrage', 'vivant', 'arret', 'erreur'] as const) {
			const menu = modeleMenu({ ...base, vie, sessions: [] });
			expect(menu.find((e) => e.type === 'action' && e.action.type === 'reprendrePath'), vie).toMatchObject({ libelle: 'Reprendre le PATH du terminal', actif: true });
		}
	});

	it('aucune session active : dit ; la case décochée se coche', () => {
		const menu = modeleMenu({ ...base, vie: 'vivant', sessions: [session({ id: 'p', etat: 'en_pause' })] });
		expect(lignes(menu).slice(2, 3)).toEqual(['( Aucune session active )']);
		expect(menu.find((e) => e.type === 'case')).toMatchObject({ coche: false, action: { type: 'ouvertureSession', active: true } });
	});

	it('au-delà de la limite : une ligne « N autres sessions… » qui ouvre la fenêtre', () => {
		const sessions = Array.from({ length: SESSIONS_MENU_MAX + 2 }, (_, i) => session({ id: `s${i}`, creeeMs: i }));
		const menu = modeleMenu({ ...base, vie: 'vivant', sessions });
		const ouvrant = menu.filter((e) => e.type === 'action' && e.action.type === 'ouvrirSession');
		expect(ouvrant).toHaveLength(SESSIONS_MENU_MAX);
		expect(menu[2 + SESSIONS_MENU_MAX]).toMatchObject({ libelle: '2 autres sessions…', action: { type: 'ouvrir' } });
	});

	it('service arrêté : « Ouvrir Mnemo » grisé, « Démarrer le service »', () => {
		expect(lignes(modeleMenu({ ...base, vie: 'arrete', sessions: [] })).slice(0, 6)).toEqual([
			'( ) Ouvrir Mnemo',
			'—',
			'( Service arrêté )',
			'—',
			'Démarrer le service',
			'[ ] Ouvrir à l’ouverture de session',
		]);
	});

	it('en démarrage : démarrer grisé ; en arrêt : arrêter grisé ; en erreur : la raison et « Redémarrer le service »', () => {
		expect(lignes(modeleMenu({ ...base, vie: 'demarrage', sessions: [] })).slice(2, 5)).toEqual(['( Démarrage du service… )', '—', '( ) Démarrer le service']);
		expect(lignes(modeleMenu({ ...base, vie: 'arret', sessions: [] })).slice(0, 5)).toEqual(['( ) Ouvrir Mnemo', '—', '( Arrêt du service… )', '—', '( ) Arrêter le service']);
		const erreur = modeleMenu({ ...base, vie: 'erreur', raison: 'Le service ne démarre pas.', sessions: [] });
		expect(lignes(erreur).slice(2, 5)).toEqual(['( Le service ne démarre pas. )', '—', 'Redémarrer le service']);
		expect(erreur[4]).toMatchObject({ action: { type: 'demarrerService' } });
	});

	it('version : la nouvelle version publiée ouvre sa page ; la case se décoche ; « Désinstaller Mnemo… »', () => {
		const url = 'https://github.com/GauthierCoste/claude-mnemo/releases/tag/v1.6.0';
		const menu = modeleMenu({ ...base, vie: 'arrete', sessions: [], nouvelleVersion: { version: '1.6.0', url } });
		expect(lignes(menu).slice(-7)).toEqual(['—', '( Mnemo 1.5.0 )', 'Version 1.6.0 disponible', '[x] Chercher les nouvelles versions', 'Désinstaller Mnemo…', '—', 'Quitter Mnemo']);
		expect(menu.find((e) => e.type === 'action' && e.action.type === 'nouvelleVersion')).toMatchObject({ action: { url } });
		expect(menu.filter((e) => e.type === 'case')[1]).toMatchObject({ action: { type: 'chercherVersions', active: false } });
		expect(menu.find((e) => e.type === 'action' && e.libelle === 'Désinstaller Mnemo…')).toMatchObject({ actif: true, action: { type: 'desinstaller' } });
		const sansRecherche = modeleMenu({ ...base, vie: 'arrete', sessions: [], chercherVersions: false });
		expect(sansRecherche.filter((e) => e.type === 'case')[1]).toMatchObject({ coche: false, action: { type: 'chercherVersions', active: true } });
	});
});
