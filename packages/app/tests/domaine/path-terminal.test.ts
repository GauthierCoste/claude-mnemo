import { describe, expect, it } from 'vitest';
import { argumentsShell, extrairePath, lirePathDeSortie, marqueurs, SHELL_PAR_DEFAUT, shellDeConnexion, validerPath } from '../../src/domaine/path-terminal.ts';

const m = marqueurs('0123abcd');

describe('PATH du terminal', () => {
	it('shell de connexion : $SHELL s’il est un chemin absolu, sinon /bin/zsh', () => {
		expect(shellDeConnexion('/opt/homebrew/bin/fish')).toBe('/opt/homebrew/bin/fish');
		for (const valeur of [undefined, '', 'zsh', 'bin/bash', '/bin/zsh\n-c']) expect(shellDeConnexion(valeur), String(valeur)).toBe(SHELL_PAR_DEFAUT);
	});

	it('arguments : -ilc et une commande qui affiche le PATH entre les marqueurs', () => {
		expect(argumentsShell(m)).toEqual(['-ilc', `printf '%s%s%s' '__MNEMO_PATH_DEBUT_0123abcd__' "$PATH" '__MNEMO_PATH_FIN_0123abcd__'`]);
		expect(marqueurs('ff').debut).not.toBe(m.debut);
	});

	it('extraction : seul le texte entre les marqueurs, quoi que les fichiers d’initialisation écrivent autour', () => {
		const sortie = `Bienvenue !\n${m.debut}faux\nnvm: using node v26\n${m.debut}/usr/local/bin:/usr/bin${m.fin}\nau revoir ${m.fin}`;
		expect(extrairePath(sortie, m)).toBe('/usr/local/bin:/usr/bin');
		expect(extrairePath('rien', m)).toBeNull();
		expect(extrairePath(`${m.debut}/usr/bin`, m)).toBeNull();
		expect(extrairePath(`/usr/bin${m.fin}`, m)).toBeNull();
		expect(extrairePath(`${m.debut}${m.fin}`, m)).toBe('');
	});

	it('validation : dossiers absolus, dans l’ordre, sans doublon ni entrée vide ou relative ; sinon null', () => {
		expect(validerPath('/maison/.nvm/versions/node/v26/bin:/usr/bin::.:bin:/usr/bin:/bin')).toBe('/maison/.nvm/versions/node/v26/bin:/usr/bin:/bin');
		for (const texte of ['', ':', '.:bin', 'pas un PATH', '/usr/bin\n/bin', '/usr/bin\0']) expect(validerPath(texte), JSON.stringify(texte)).toBeNull();
	});

	it('lecture de la sortie : le PATH, ou la raison', () => {
		expect(lirePathDeSortie(`x${m.debut}/usr/bin:/bin${m.fin}y`, m)).toEqual({ ok: true, path: '/usr/bin:/bin' });
		expect(lirePathDeSortie('zsh: no such file', m)).toEqual({ ok: false, raison: 'marqueurs absents de la sortie du shell.' });
		expect(lirePathDeSortie(`${m.debut}relatif${m.fin}`, m)).toMatchObject({ ok: false, raison: expect.stringContaining('aucun chemin absolu') });
	});
});
