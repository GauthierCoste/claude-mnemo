import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
	adresseFenetre,
	agentUtilisateur,
	barreDesMenusCachee,
	bornesAOuvrir,
	decisionNavigation,
	FOND_FENETRE,
	origineService,
	optionsBarreTitre,
	POSITION_BOUTONS_FENETRE,
	BOUTONS_WINDOWS,
	validerBornes,
} from '../../src/domaine/fenetre.ts';
import { lirePreferences, PREFERENCES_DEFAUT } from '../../src/domaine/preferences.ts';

const JETON = 'a'.repeat(64);

describe('adresse de la fenêtre', () => {
	it('le service sur 127.0.0.1, le jeton ou la session dans le fragment', () => {
		expect(origineService(4321)).toBe('http://127.0.0.1:4321');
		expect(adresseFenetre(4321, { jeton: JETON })).toBe(`http://127.0.0.1:4321/#jeton=${JETON}`);
		expect(adresseFenetre(4321, { session: 's-1' })).toBe('http://127.0.0.1:4321/#session=s-1');
	});

	it('jeton et session ensemble au chargement : l’interface lit les deux du même fragment', () => {
		const adresse = adresseFenetre(4321, { jeton: JETON, session: 's 1' });
		const fragment = new URLSearchParams(new URL(adresse).hash.slice(1));
		expect([fragment.get('jeton'), fragment.get('session')]).toEqual([JETON, 's 1']);
	});

	it('un id de session est encodé (rien ne s’ajoute au fragment)', () => {
		expect(adresseFenetre(80, { session: 'a&jeton=b' })).toBe('http://127.0.0.1:80/#session=a%26jeton%3Db');
	});
});

describe('la fenêtre est l’app', () => {
	it('agent utilisateur marqué MnemoApp/<version>, à la fin', () => {
		expect(agentUtilisateur('Mozilla/5.0 Chrome/140', '1.5.0')).toBe('Mozilla/5.0 Chrome/140 MnemoApp/1.5.0');
	});

	it('fond = --bg de l’interface ; boutons de la fenêtre centrés dans sa barre de titre de 44 px', () => {
		const jetons = readFileSync(join(import.meta.dirname, '../../../ui/src/styles/jetons.css'), 'utf8');
		expect(/--bg:\s*(#[0-9a-f]{6})/iu.exec(jetons)?.[1]?.toLowerCase()).toBe(FOND_FENETRE);
		expect(POSITION_BOUTONS_FENETRE).toEqual({ x: 14, y: 14 });
	});

	it('barre de titre : macOS inchangé (boutons incrustés), Windows : boutons du système par-dessus, aux couleurs de la barre', () => {
		expect(optionsBarreTitre('darwin', POSITION_BOUTONS_FENETRE)).toEqual({ titleBarStyle: 'hidden', trafficLightPosition: { x: 14, y: 14 } });
		expect(optionsBarreTitre('darwin', null)).toEqual({ titleBarStyle: 'hiddenInset' });
		for (const position of [POSITION_BOUTONS_FENETRE, null]) {
			expect(optionsBarreTitre('win32', position)).toEqual({ titleBarStyle: 'hidden', titleBarOverlay: BOUTONS_WINDOWS });
		}
		// Windows : barre des menus cachée pour de bon (Alt seul ne la montre plus) ; macOS : rien à cacher
		expect(barreDesMenusCachee('win32')).toBe(true);
		expect(barreDesMenusCachee('darwin')).toBe(false);
		const jetons = readFileSync(join(import.meta.dirname, '../../../ui/src/styles/jetons.css'), 'utf8');
		expect(/--tx:\s*(#[0-9a-f]{6})/iu.exec(jetons)?.[1]?.toLowerCase()).toBe(BOUTONS_WINDOWS.symbolColor);
		expect(jetons).toMatch(/--degrade-titre:\s*linear-gradient\(#121317, #0e0f12\)/u);
		expect(BOUTONS_WINDOWS.height).toBe(43);
	});
});

describe('navigation', () => {
	const origine = origineService(4321);

	it('même origine : autorisée, quel que soit le chemin ou le fragment', () => {
		expect(decisionNavigation('http://127.0.0.1:4321/', origine)).toBe('autoriser');
		expect(decisionNavigation('http://127.0.0.1:4321/api/x?y=1#z', origine)).toBe('autoriser');
	});

	it('autre port, autre hôte, localhost : ailleurs, ouvert dans le navigateur s’il est en http ou https', () => {
		expect(decisionNavigation('http://127.0.0.1:4322/', origine)).toBe('externe');
		expect(decisionNavigation('http://localhost:4321/', origine)).toBe('externe');
		expect(decisionNavigation('https://example.org/doc', origine)).toBe('externe');
	});

	it('autres protocoles et adresses invalides : refusés', () => {
		for (const a of ['file:///etc/passwd', 'javascript:alert(1)', 'mailto:x@example.org', 'data:text/html,x', 'pas une adresse', '']) {
			expect(decisionNavigation(a, origine)).toBe('refuser');
		}
	});
});

describe('bornes de la fenêtre', () => {
	const ecran = { x: 0, y: 25, largeur: 1440, hauteur: 875 };

	it('validées : quatre entiers, taille au moins minimale', () => {
		expect(validerBornes({ x: 10, y: 40, largeur: 900, hauteur: 600 })).toEqual({ x: 10, y: 40, largeur: 900, hauteur: 600 });
		expect(validerBornes({ x: 10, y: 40, largeur: 100, hauteur: 600 })).toBeNull();
		expect(validerBornes({ x: 1.5, y: 40, largeur: 900, hauteur: 600 })).toBeNull();
		expect(validerBornes({ x: 10, y: 40, largeur: '900', hauteur: 600 })).toBeNull();
		expect(validerBornes(null)).toBeNull();
	});

	it('rouvertes là si elles tiennent sur un écran, même à moitié ; sinon taille par défaut', () => {
		const ici = { x: 100, y: 100, largeur: 900, hauteur: 600 };
		expect(bornesAOuvrir(ici, [ecran])).toEqual(ici);
		expect(bornesAOuvrir({ ...ici, x: 1000 }, [ecran])).toEqual({ ...ici, x: 1000 });
		// sur un second écran débranché depuis
		expect(bornesAOuvrir({ ...ici, x: 1600 }, [ecran])).toBeNull();
		expect(bornesAOuvrir({ ...ici, x: 1600 }, [ecran, { x: 1440, y: 0, largeur: 1920, hauteur: 1080 }])).toEqual({ ...ici, x: 1600 });
		// à peine un coin visible
		expect(bornesAOuvrir({ ...ici, x: 1400, y: 860 }, [ecran])).toBeNull();
		expect(bornesAOuvrir(null, [ecran])).toBeNull();
	});
});

describe('préférences', () => {
	it('lues avec leurs valeurs par défaut pour ce qui manque ou ne se lit pas', () => {
		expect(lirePreferences(null)).toEqual(PREFERENCES_DEFAUT);
		expect(lirePreferences([])).toEqual(PREFERENCES_DEFAUT);
		expect(lirePreferences({ quitter: 'arreter' })).toEqual({ ...PREFERENCES_DEFAUT, quitter: 'arreter' });
		expect(lirePreferences({ quitter: 'toujours', fenetre: { x: 0 } })).toEqual(PREFERENCES_DEFAUT);
		const fenetre = { x: 0, y: 0, largeur: 1000, hauteur: 700 };
		expect(lirePreferences({ quitter: 'laisser', fenetre, autre: 1 })).toEqual({ ...PREFERENCES_DEFAUT, quitter: 'laisser', fenetre });
	});

	it('nouvelles versions : réglage, date et version publiée lus, sinon les défauts', () => {
		const versionPubliee = { version: '1.6.0', url: 'https://github.com/GauthierCoste/claude-mnemo/releases/tag/v1.6.0' };
		expect(lirePreferences({ chercherVersions: false, verificationVersionsMs: 12, versionPubliee })).toEqual({ ...PREFERENCES_DEFAUT, chercherVersions: false, verificationVersionsMs: 12, versionPubliee });
		expect(lirePreferences({ chercherVersions: 'non', verificationVersionsMs: 'hier', versionPubliee: { version: 'x', url: 'https://a' } })).toEqual(PREFERENCES_DEFAUT);
		expect(lirePreferences({ versionPubliee: { version: '1.6.0', url: 'javascript:alert(1)' } })).toEqual(PREFERENCES_DEFAUT);
	});
});
