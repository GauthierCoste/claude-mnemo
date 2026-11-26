import type { LigneInit, PosteVerifie } from '@mnemo/contrat';
import { describe, expect, it } from 'vitest';
import { argumentsInit, argumentsVerifierPoste, CHOIX_PAR_DEFAUT, choixPourPlateforme, etatInitial, evoluer, lirePoste, peutContinuer, peutReessayer, posteSuffisant, type EtatAssistant, type EvenementAssistant } from '../../src/domaine/assistant.ts';
import { decisionDemarrage, MESSAGE_PROVISOIRE } from '../../src/domaine/assistant-demarrage.ts';
import { lienAutorise, LIENS_EXTERNES, validerChoix } from '../../src/domaine/assistant-pont.ts';
import { etapesMontrees } from '../../src/domaine/assistant-lignes.ts';
import { textesAssistant } from '../../src/domaine/assistant-textes.ts';

const POSTE: PosteVerifie = { git: { ok: true, version: '2.50.1' }, claude: { ok: true, chemin: '/usr/local/bin/claude' }, node: { version: '24.1.0' } };
const DOSSIER = { racine: '/srv/exemple/Projets', memoireExistante: false };
const suite = (evenements: EvenementAssistant[], depart: EtatAssistant = etatInitial('darwin')) => evenements.reduce(evoluer, depart);

describe('choix et commandes', () => {
	it('par défaut : Claude Code, commande, ouverture de session oui ; modèles non', () => {
		expect(CHOIX_PAR_DEFAUT).toEqual({ mcp: true, commande: true, modeles: false, ouvrirALaSession: true });
		expect(etatInitial('darwin').choix).toEqual(CHOIX_PAR_DEFAUT);
		expect(etatInitial('darwin').choix).not.toBe(CHOIX_PAR_DEFAUT);
	});

	it('init : un choix explicite par étape, --json, jamais le lanceur', () => {
		expect(argumentsInit('/m/main.ts', '/srv/exemple', CHOIX_PAR_DEFAUT)).toEqual(['/m/main.ts', 'init', '/srv/exemple', '--json', '--mcp', '--sans-modeles', '--commande', '--sans-lanceur']);
		expect(argumentsInit('/m/main.ts', '/srv/exemple', { mcp: false, commande: false, modeles: true, ouvrirALaSession: false })).toEqual(['/m/main.ts', 'init', '/srv/exemple', '--json', '--sans-mcp', '--modeles', '--sans-commande', '--sans-lanceur']);
		expect(argumentsVerifierPoste('/m/main.ts')).toEqual(['/m/main.ts', 'verifier-poste', '--json']);
	});
});

describe('lecture de « mnemo verifier-poste --json »', () => {
	it('valide : rendu sans les champs inconnus ; première ligne non vide', () => {
		expect(lirePoste(`\n${JSON.stringify({ ...POSTE, autre: 1 })}\n`)).toEqual(POSTE);
		const manque = { git: { ok: false, motif: 'git introuvable' }, claude: { ok: false, motif: 'absent' }, node: { version: '24.1.0' } };
		expect(lirePoste(JSON.stringify(manque))).toEqual(manque);
	});

	it('invalide : null', () => {
		for (const sortie of ['', 'texte', '[]', JSON.stringify({ git: { ok: true }, claude: { ok: true } }), JSON.stringify({ ...POSTE, git: { ok: 'oui' } }), JSON.stringify({ ...POSTE, claude: { ok: true, chemin: 3 } }), JSON.stringify({ ...POSTE, node: {} })]) {
			expect(lirePoste(sortie), sortie).toBeNull();
		}
	});

	it('suffisant : git et Claude Code présents', () => {
		expect(posteSuffisant(POSTE)).toBe(true);
		expect(posteSuffisant({ ...POSTE, claude: { ok: false } })).toBe(false);
		expect(posteSuffisant({ ...POSTE, git: { ok: false } })).toBe(false);
	});
});

describe('enchaînement des étapes', () => {
	it('vérifications → dossier → choix → installation → terminé', () => {
		let e = suite([{ type: 'verification' }]);
		expect(e.verification).toBe(true);
		expect(peutContinuer(e)).toBe(false);
		e = suite([{ type: 'poste', poste: POSTE }, { type: 'continuer' }], e);
		expect(e.etape).toBe('dossier');
		expect(peutContinuer(e)).toBe(false);
		e = suite([{ type: 'continuer' }], e);
		expect(e.etape).toBe('dossier');
		e = suite([{ type: 'dossier', dossier: DOSSIER }, { type: 'continuer' }, { type: 'choix', cle: 'modeles', valeur: true }, { type: 'installer' }], e);
		expect(e.etape).toBe('installation');
		expect(e.choix.modeles).toBe(true);
		expect(e.installation?.enCours).toBe(true);
		const lignes: LigneInit[] = [
			{ etape: 'memoire', etat: 'fait', message: 'ok' },
			{ etape: 'mcp', etat: 'echec', message: 'non' },
			{ fin: true, racine: DOSSIER.racine, ok: false },
		];
		e = suite([...lignes.map((ligne): EvenementAssistant => ({ type: 'ligne', ligne })), { type: 'fin-installation', resultat: { fin: { fin: true, racine: DOSSIER.racine, ok: false }, erreur: null } }], e);
		expect(e.etape).toBe('termine');
		expect(e.installation?.enCours).toBe(false);
	});

	it('poste incomplet ou vérification en échec : on reste aux vérifications', () => {
		const e = suite([{ type: 'poste', poste: { ...POSTE, claude: { ok: false, motif: 'absent' } } }, { type: 'continuer' }]);
		expect(e.etape).toBe('verifications');
		const erreur = suite([{ type: 'verification' }, { type: 'erreur-poste', message: 'Mnemo introuvable' }, { type: 'continuer' }]);
		expect(erreur).toMatchObject({ etape: 'verifications', verification: false, poste: null, erreurPoste: 'Mnemo introuvable' });
	});

	it('retour : du dossier aux vérifications, des choix au dossier (le dossier gardé)', () => {
		const choix = suite([{ type: 'poste', poste: POSTE }, { type: 'continuer' }, { type: 'dossier', dossier: DOSSIER }, { type: 'continuer' }]);
		expect(choix.etape).toBe('choix');
		const dossier = evoluer(choix, { type: 'retour' });
		expect(dossier).toMatchObject({ etape: 'dossier', dossier: DOSSIER });
		expect(evoluer(dossier, { type: 'retour' }).etape).toBe('verifications');
	});

	it('événements hors de propos : sans effet', () => {
		const depart = etatInitial('darwin');
		for (const e of [{ type: 'dossier', dossier: DOSSIER }, { type: 'choix', cle: 'mcp', valeur: false }, { type: 'installer' }, { type: 'ligne', ligne: { fin: true, racine: '/r', ok: true } }, { type: 'retour' }, { type: 'fin-installation', resultat: { fin: null, erreur: 'x' } }] as EvenementAssistant[]) {
			expect(evoluer(depart, e), e.type).toBe(depart);
		}
	});

	it('installation sans mémoire (arrêt, erreur d’usage) : on reste, l’erreur dite, retour aux choix possible', () => {
		const installation = suite([{ type: 'poste', poste: POSTE }, { type: 'continuer' }, { type: 'dossier', dossier: DOSSIER }, { type: 'continuer' }, { type: 'installer' }]);
		expect(peutReessayer(installation)).toBe(false);
		const arretee = evoluer(installation, { type: 'fin-installation', resultat: { fin: null, erreur: 'L’installation a échoué : code de sortie 2.' } });
		expect(arretee.etape).toBe('installation');
		expect(arretee.installation).toMatchObject({ enCours: false, erreur: 'L’installation a échoué : code de sortie 2.' });
		expect(peutReessayer(arretee)).toBe(true);
		expect(evoluer(arretee, { type: 'retour' })).toMatchObject({ etape: 'choix', installation: null });
		const sansFin = evoluer(installation, { type: 'fin-installation', resultat: { fin: null, erreur: null } });
		expect(sansFin.installation?.erreur).toBe('L’installation s’est arrêtée sans finir.');
	});
});

describe('sous Windows', () => {
	it('pas de commande « mnemo » : ni proposée, ni cochée, ni menée, ni montrée parmi les étapes', () => {
		const depart = etatInitial('win32');
		expect(depart.choix).toEqual({ ...CHOIX_PAR_DEFAUT, commande: false });
		expect(textesAssistant('win32').cases.map((c) => c.cle)).toEqual(['mcp', 'modeles', 'ouvrirALaSession']);
		expect(textesAssistant('darwin').cases.map((c) => c.cle)).toEqual(['mcp', 'commande', 'modeles', 'ouvrirALaSession']);
		const choisi = suite([{ type: 'poste', poste: POSTE }, { type: 'continuer' }, { type: 'dossier', dossier: DOSSIER }, { type: 'continuer' }, { type: 'choix', cle: 'commande', valeur: true }], depart);
		expect(choisi.choix.commande).toBe(false);
		expect(choixPourPlateforme(CHOIX_PAR_DEFAUT, 'win32').commande).toBe(false);
		expect(choixPourPlateforme(CHOIX_PAR_DEFAUT, 'darwin')).toBe(CHOIX_PAR_DEFAUT);
		expect(suite([{ type: 'installer' }], choisi).installation?.etapes.map((e) => e.etape)).toEqual(['memoire', 'mcp', 'modeles']);
		expect(etapesMontrees('darwin')).toEqual(['memoire', 'mcp', 'modeles', 'commande']);
	});

	it('textes : « cet ordinateur », zone de notification, Git pour Windows sans commande d’Apple ; macOS inchangé', () => {
		const w = textesAssistant('win32');
		expect(w.intro).toBe('Mnemo donne une mémoire à tes sessions Claude Code. Il lui faut git et Claude Code sur cet ordinateur.');
		expect(w.aideGit).toEqual({ commande: null, libelleLien: 'Installer Git pour Windows', lien: 'https://git-scm.com/downloads/win' });
		expect(w.cases.find((c) => c.cle === 'ouvrirALaSession')?.detail).toBe('Mnemo reste dans la zone de notification.');
		expect(w.cases.find((c) => c.cle === 'modeles')?.detail).toMatch(/^Recherche par le sens, sur cet ordinateur ; /u);
		expect(w.cases.find((c) => c.cle === 'modeles')?.detail).toBe('Recherche par le sens, sur cet ordinateur ; environ 1,3 Go à télécharger. Sans eux, la recherche se fait par les mots.');
		expect(w.relance).toBeNull();
		expect(JSON.stringify(w)).not.toMatch(/Mac|barre des menus|xcode|mnemo /u);
		const m = textesAssistant('darwin');
		expect(m.intro).toBe('Mnemo donne une mémoire à tes sessions Claude Code. Il lui faut git et Claude Code sur ce Mac.');
		expect(m.aideGit).toEqual({ commande: 'xcode-select --install', libelleLien: 'installer git', lien: 'https://git-scm.com/downloads/mac' });
		expect(m.cases.find((c) => c.cle === 'ouvrirALaSession')?.detail).toBe('Mnemo reste dans la barre des menus.');
		expect(m.cases.find((c) => c.cle === 'commande')?.detail).toBe('Pour le terminal : ~/.local/bin/mnemo.');
		expect(m.cases.find((c) => c.cle === 'modeles')?.detail).toMatch(/ ; plus tard : mnemo modeles installer\.$/u);
		expect(m.relance).toBe('Tu pourras le refaire plus tard (mnemo init, dans ce dossier).');
	});
});

describe('pont : ce qui vient de la page', () => {
	it('choix : exactement quatre booléens', () => {
		expect(validerChoix({ ...CHOIX_PAR_DEFAUT })).toEqual(CHOIX_PAR_DEFAUT);
		for (const brut of [null, [], 'oui', { ...CHOIX_PAR_DEFAUT, mcp: 'true' }, { mcp: true, commande: true, modeles: false }, { ...CHOIX_PAR_DEFAUT, dossier: '/etc' }]) {
			expect(validerChoix(brut), JSON.stringify(brut)).toBeNull();
		}
	});

	it('liens : seulement ceux de l’installation, à l’identique', () => {
		expect(lienAutorise(LIENS_EXTERNES.claude)).toBe(true);
		expect(lienAutorise(LIENS_EXTERNES.git)).toBe(true);
		expect(lienAutorise(LIENS_EXTERNES.gitWindows)).toBe(true);
		for (const url of [`${LIENS_EXTERNES.claude}?x`, 'https://exemple.test', 'file:///etc/passwd', 'javascript:alert(1)']) expect(lienAutorise(url)).toBe(false);
	});
});

describe('au lancement : interface ou assistant', () => {
	const configuration = { racine: '/srv/exemple', node: '/usr/local/bin/node', main: '/opt/mnemo/main.ts', path: '/usr/bin:/bin' };
	const paquet = { node: '/Applications/Mnemo.app/Contents/Resources/node', main: '/Applications/Mnemo.app/main.ts', path: '/usr/bin' };

	it('configuration valide et mémoire présente : l’interface', () => {
		expect(decisionDemarrage({ ok: true, configuration }, true, null)).toEqual({ assistant: false, configuration });
	});

	it('mémoire disparue : l’assistant, avec le Mnemo et le port de la configuration', () => {
		expect(decisionDemarrage({ ok: true, configuration: { ...configuration, port: 4747 } }, false, paquet)).toEqual({
			assistant: true,
			raison: 'Plus de mémoire Mnemo dans /srv/exemple.',
			executable: { node: configuration.node, main: configuration.main, path: configuration.path },
			port: 4747,
		});
	});

	it('configuration absente ou invalide : l’assistant, avec le Mnemo par défaut (ou aucun)', () => {
		expect(decisionDemarrage({ ok: false, erreurs: ['absente'] }, false, paquet)).toEqual({ assistant: true, raison: 'absente', executable: paquet });
		expect(decisionDemarrage({ ok: false, erreurs: ['a', 'b'] }, false, null)).toEqual({ assistant: true, raison: 'a b', executable: null });
	});

	it('depuis l’image disque ou une translocation : l’assistant, sans rien à lancer ; l’interface si tout est déjà là', () => {
		expect(decisionDemarrage({ ok: false, erreurs: ['absente'] }, false, paquet, true)).toEqual({ assistant: true, raison: 'absente', executable: null, provisoire: true });
		expect(decisionDemarrage({ ok: true, configuration: { ...configuration, port: 4747 } }, false, paquet, true)).toEqual({ assistant: true, raison: 'Plus de mémoire Mnemo dans /srv/exemple.', executable: null, provisoire: true });
		expect(decisionDemarrage({ ok: true, configuration }, true, paquet, true)).toEqual({ assistant: false, configuration });
		expect(MESSAGE_PROVISOIRE).toContain('Applications');
	});

	it('emplacement provisoire : la page ne montre que la demande de déplacer l’app, plus rien n’avance', () => {
		const e = suite([{ type: 'verification' }, { type: 'provisoire' }]);
		expect(e).toMatchObject({ deplacer: true, verification: false, poste: null, erreurPoste: null, etape: 'verifications' });
		expect(peutContinuer(e)).toBe(false);
		expect(suite([{ type: 'poste', poste: POSTE }, { type: 'continuer' }, { type: 'dossier', dossier: DOSSIER }], e)).toBe(e);
		expect(etatInitial('darwin').deplacer).toBe(false);
	});
});
