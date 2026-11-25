import { describe, expect, it } from 'vitest';
import { cheminsTouches, commandesDe, correspondGlob, FORMES_MAX, formesDeCommande, motifRegleInvalide, verifier } from '../../src/domaine/regles-verifiees.ts';
import type { ActionOutil } from '../../src/domaine/regles-verifiees.ts';
import type { Regle } from '../../src/domaine/consigne.ts';
import { TOLERANCE } from '../aides/charge.ts';
import { OUTILS_CLAUDE_CODE as CC } from '../../src/domaine/moteurs/claude-code/outils.ts';
import { OUTILS_CODEX } from '../../src/domaine/moteurs/codex/outils.ts';

const RACINE = '/home/u/dossier';
const ecrire = (chemin: string, nom = 'Write'): ActionOutil => ({ nom, entree: { file_path: chemin, content: 'x' } });
const bash = (command: string): ActionOutil => ({ nom: 'Bash', entree: { command } });

describe('correspondGlob', () => {
	it('« ** » traverse les dossiers, y compris aucun ; « * » et « ? » restent dans un segment', () => {
		expect(correspondGlob('**/.env', '.env', false)).toBe(true);
		expect(correspondGlob('**/.env', 'a/b/.env', false)).toBe(true);
		expect(correspondGlob('**/.env', 'a/.envrc', false)).toBe(false);
		expect(correspondGlob('vendor/**', 'vendor/a/b.php', false)).toBe(true);
		expect(correspondGlob('vendor/**', 'vendor', false)).toBe(true);
		expect(correspondGlob('vendor/**', 'src/vendor/a.php', false)).toBe(false);
		expect(correspondGlob('vendor/**', 'vendorx/a', false)).toBe(false);
		expect(correspondGlob('src/*.ts', 'src/a.ts', false)).toBe(true);
		expect(correspondGlob('src/*.ts', 'src/a/b.ts', false)).toBe(false);
		expect(correspondGlob('a?.md', 'ab.md', false)).toBe(true);
		expect(correspondGlob('a?.md', 'a/.md', false)).toBe(false);
		expect(correspondGlob('a.b+(c)', 'a.b+(c)', false)).toBe(true);
		expect(correspondGlob('a.b', 'axb', false)).toBe(false);
		expect(correspondGlob('**', 'a/b/c', false)).toBe(true);
		expect(correspondGlob('a/**/b', 'a/b', false)).toBe(true);
		expect(correspondGlob('a/**/b', 'a/x/y/b', false)).toBe(true);
		expect(correspondGlob('a/**/b', 'a/xb', false)).toBe(false);
		expect(correspondGlob('a**b', 'a/x/b', false)).toBe(true);
		expect(correspondGlob('*', 'a/b', false)).toBe(false);
		expect(correspondGlob('*', '', false)).toBe(true);
		expect(correspondGlob('é?', 'éà', false)).toBe(true);
		expect(correspondGlob('x😀', 'x😀', false)).toBe(true);
		expect(correspondGlob('?', '😀', false)).toBe(true);
	});

	it('casse : selon sansCasse', () => {
		expect(correspondGlob('**/.ENV', 'a/.env', false)).toBe(false);
		expect(correspondGlob('**/.ENV', 'a/.env', true)).toBe(true);
		expect(correspondGlob('Vendor/**', 'vendor/x', true)).toBe(true);
	});
});

describe('temps de correspondance (pas de retour arrière exponentiel)', () => {
	const LIMITE_MS = process.env.CI ? 200 : 50 * TOLERANCE;
	const mesure = (f: () => unknown) => {
		const debut = performance.now();
		f();
		return performance.now() - debut;
	};
	it.each([
		['*a'.repeat(20) + 'b', 'a'.repeat(4000)],
		['**/'.repeat(20) + 'x', 'a/'.repeat(2000) + 'b'],
		['**a'.repeat(20) + 'b', 'a'.repeat(4000)],
		['*a*a*a*a*ab', 'a'.repeat(200)],
	])('glob %#', (motif, chemin) => {
		let r = true;
		expect(mesure(() => (r = correspondGlob(motif, chemin, true)))).toBeLessThan(LIMITE_MS);
		expect(r).toBe(false);
	});

	it('commande : motif piège sur une longue commande', () => {
		const motifs = ['*a'.repeat(20) + 'b'];
		const regle = { texte: 'T', regle: { type: 'commandes_interdites' as const, motifs } };
		expect(mesure(() => expect(verifier([regle], bash('a'.repeat(16000)), { racine: RACINE, cwd: RACINE, sansCasse: false, outils: CC })).toEqual({ refus: false }))).toBeLessThan(LIMITE_MS * 2);
	});

	it('commande à préfixes nombreux : un seul passage pour toutes les formes', () => {
		const regle = { texte: 'T', regle: { type: 'commandes_interdites' as const, motifs: ['*a'.repeat(20) + 'b'] } };
		const commande = 'sudo '.repeat(40) + 'a'.repeat(15000);
		expect(mesure(() => expect(verifier([regle], bash(commande), { racine: RACINE, cwd: RACINE, sansCasse: false, outils: CC })).toEqual({ refus: false }))).toBeLessThan(LIMITE_MS * 2);
	});

	it('au-delà de 4 096 caractères (chemin) ou 16 384 (commande) : refus, action non vérifiée', () => {
		const ctx = { racine: RACINE, cwd: RACINE, sansCasse: false, outils: CC };
		const env = { texte: 'Pas de .env.', regle: { type: 'chemins_interdits' as const, motifs: ['**/.env'] } };
		expect(verifier([env], ecrire(`/home/u/dossier/${'a'.repeat(4000)}`), ctx)).toEqual({ refus: false });
		expect(verifier([env], ecrire(`/home/u/dossier/${'a'.repeat(4100)}`), ctx)).toEqual({ refus: true, cause: 'chemin_trop_long', detail: null });
		const git = { texte: 'Git.', regle: { type: 'commandes_interdites' as const, motifs: ['git push*'] } };
		expect(verifier([git], bash(`ls ${'x'.repeat(16000)}`), ctx)).toEqual({ refus: false });
		expect(verifier([git], bash(`ls ${'x'.repeat(16400)}`), ctx)).toEqual({ refus: true, cause: 'commande_trop_longue', detail: null });
		// sans règle du type concerné, la longueur ne compte pas
		expect(verifier([git], ecrire(`/home/u/dossier/${'a'.repeat(4100)}`), ctx)).toEqual({ refus: false });
		expect(verifier([env], bash(`ls ${'x'.repeat(16400)}`), ctx)).toEqual({ refus: false });
	});
});

/** Référence : l'ancienne traduction en expression régulière (exacte, mais exponentielle), sur de petites entrées. */
function reference(motif: string, chemin: string, sansCasse: boolean): boolean {
	let source = '';
	for (let i = 0; i < motif.length; i++) {
		const c = motif[i]!;
		if (c === '/' && motif.slice(i) === '/**') {
			source += '(?:/.*)?';
			break;
		}
		if (c === '*' && motif[i + 1] === '*') {
			source += motif[i + 2] === '/' ? '(?:.*/)?' : '.*';
			i += motif[i + 2] === '/' ? 2 : 1;
		} else if (c === '*') source += '[^/]*';
		else if (c === '?') source += '[^/]';
		else source += c.replace(/[.+^${}()|[\]\\]/gu, '\\$&');
	}
	return new RegExp(`^${source}$`, sansCasse ? 'isu' : 'su').test(chemin);
}

describe('correspondGlob : même verdict que la référence', () => {
	it('2 000 tirages aléatoires', () => {
		let graine = 42;
		const hasard = (n: number) => {
			graine = (graine * 1103515245 + 12345) % 2147483648;
			return graine % n;
		};
		const tirer = (alphabet: string[], max: number) => Array.from({ length: hasard(max + 1) }, () => alphabet[hasard(alphabet.length)]!).join('');
		for (let k = 0; k < 2000; k++) {
			const motif = tirer(['a', 'B', '/', '*', '**', '?', '.'], 6);
			const chemin = tirer(['a', 'b', '/', '.'], 7);
			const casse = hasard(2) === 0;
			expect(correspondGlob(motif, chemin, casse), `${motif} ${chemin} ${casse}`).toBe(reference(motif, chemin, casse));
		}
	});
});

describe('cheminsTouches', () => {
	it('outils d\'écriture : chemin relatif à la racine, en « / »', () => {
		expect(cheminsTouches(ecrire('/home/u/dossier/src/a.ts'), CC, RACINE, RACINE)).toEqual(['src/a.ts']);
		expect(cheminsTouches(ecrire('/home/u/dossier/src/a.ts', 'Edit'), CC, RACINE, RACINE)).toEqual(['src/a.ts']);
		expect(cheminsTouches(ecrire('/home/u/dossier/src/a.ts', 'MultiEdit'), CC, RACINE, RACINE)).toEqual(['src/a.ts']);
		expect(cheminsTouches({ nom: 'NotebookEdit', entree: { notebook_path: '/home/u/dossier/n.ipynb' } }, CC, RACINE, RACINE)).toEqual(['n.ipynb']);
	});

	it('relatif au cwd, « . » et « .. » résolus', () => {
		expect(cheminsTouches(ecrire('./b/../.env'), CC, RACINE, '/home/u/dossier/projet')).toEqual(['projet/.env']);
		expect(cheminsTouches(ecrire('../.env'), CC, RACINE, '/home/u/dossier/projet')).toEqual(['.env']);
		expect(cheminsTouches(ecrire('/home/u/dossier/x/../../autre/.env'), CC, RACINE, RACINE)).toEqual(['/home/u/autre/.env']);
		expect(cheminsTouches(ecrire('/../../etc/passwd'), CC, RACINE, RACINE)).toEqual(['/etc/passwd']);
	});

	it('Windows : « \\ », lettre de lecteur (casse comprise)', () => {
		expect(cheminsTouches(ecrire('C:\\Users\\u\\Dossier\\vendor\\a.php'), CC, 'c:\\Users\\u\\Dossier', 'C:\\Users\\u\\Dossier')).toEqual(['vendor/a.php']);
		expect(cheminsTouches(ecrire('src\\..\\.env'), CC, 'C:\\d', 'C:\\d\\p')).toEqual(['p/.env']);
		expect(cheminsTouches(ecrire('D:\\autre\\.env'), CC, 'C:\\d', 'C:\\d')).toEqual(['D:/autre/.env']);
	});

	it('outils non concernés : null ; chemin absent : aucun', () => {
		expect(cheminsTouches(bash('ls'), CC, RACINE, RACINE)).toBeNull();
		expect(cheminsTouches({ nom: 'Read', entree: { file_path: '/home/u/dossier/.env' } }, CC, RACINE, RACINE)).toBeNull();
		expect(cheminsTouches({ nom: 'Write', entree: {} }, CC, RACINE, RACINE)).toEqual([]);
	});
});

describe('commandesDe', () => {
	it('Bash seulement', () => {
		expect(commandesDe(ecrire('/a'), CC)).toBeNull();
		expect(commandesDe({ nom: 'Bash', entree: {} }, CC)).toEqual([]);
	});

	it('coupe sur ; && || | et retour à la ligne, espaces réduits', () => {
		expect(commandesDe(bash('cd x &&  git   push --force ; ls | wc -l || echo non\nrm -rf /tmp/a'), CC)).toEqual(['cd x', 'git push --force', 'ls', 'wc -l', 'echo non', 'rm -rf /tmp/a']);
	});

	it('pas de coupe entre guillemets', () => {
		expect(commandesDe(bash('git commit -m "a; git push --force" && echo \'b | c\''), CC)).toEqual(['git commit -m "a; git push --force"', 'echo \'b | c\'']);
		expect(commandesDe(bash('echo "a \\" ; b" ; c'), CC)).toEqual(['echo "a \\" ; b"', 'c']);
	});

	it('« & » de fond coupe aussi, pas une redirection', () => {
		expect(commandesDe(bash('make 2>&1 & git push --force'), CC)).toEqual(['make 2>&1', 'git push --force']);
	});
});

describe('commandes : formes brute et dépouillées, commentaires', () => {
	const ctx = { racine: RACINE, cwd: RACINE, sansCasse: false, outils: CC };
	const regle = (...motifs: string[]) => ({ texte: 'R.', regle: { type: 'commandes_interdites' as const, motifs } });

	it('formesDeCommande : brute, puis chaque préfixe retiré (VAR=val, sudo, nohup, time, exec, command, !, then, do, else, ( et {)', () => {
		expect(formesDeCommande('GIT_X=1 B="a b" sudo nohup git push --force')).toEqual(['GIT_X=1 B="a b" sudo nohup git push --force', 'B="a b" sudo nohup git push --force', 'sudo nohup git push --force', 'nohup git push --force', 'git push --force']);
		expect(formesDeCommande('(git push --force)')).toEqual(['(git push --force)', 'git push --force)']);
		expect(formesDeCommande('{ time git push')).toEqual(['{ time git push', 'time git push', 'git push']);
		expect(formesDeCommande('! command exec x')).toEqual(['! command exec x', 'command exec x', 'exec x', 'x']);
		expect(formesDeCommande('sudo')).toEqual(['sudo']);
		expect(formesDeCommande('ls -l')).toEqual(['ls -l']);
		expect(formesDeCommande('sudo '.repeat(100) + 'x')).toHaveLength(FORMES_MAX);
	});

	it('options de sudo (avec argument : -u -g -h -p -C -D) et de time', () => {
		expect(formesDeCommande('sudo -u root -E git push --force').at(-1)).toBe('git push --force');
		expect(formesDeCommande('sudo -g staff -C 3 -- git push').at(-1)).toBe('git push');
		expect(formesDeCommande('time -p git push --force').at(-1)).toBe('git push --force');
		for (const c of ['sudo -u root git push --force', 'time -p git push --force', 'sudo -D /tmp -p x nohup git push --force']) {
			expect(verifier([regle('git push --force*')], bash(c), ctx), c).toMatchObject({ refus: true });
		}
	});

	it('une règle qui vise un préfixe garde la forme brute', () => {
		expect(verifier([regle('sudo*')], bash('sudo rm x'), ctx)).toMatchObject({ refus: true, motif: 'sudo*' });
		expect(verifier([regle('sudo *')], bash('sudo rm x'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('nohup *')], bash('nohup ./serveur'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('time *')], bash('time make'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('exec *')], bash('exec bash'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('FOO=*')], bash('FOO=1 make'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('sudo *')], bash('ls'), ctx)).toEqual({ refus: false });
	});

	it('verifier : un préfixe ne masque plus la commande', () => {
		for (const c of ['FOO=1 git push --force', 'sudo git push --force', '(git push --force)', 'nohup time git push --force', 'if x; then git push --force; fi', 'for a in b; do command git push --force; done']) {
			expect(verifier([regle('git push --force*')], bash(c), ctx), c).toMatchObject({ refus: true });
		}
	});

	it('commandesDe rend les commandes brutes', () => {
		expect(commandesDe(bash('if true; then git push --force; else exec rm -rf /; fi'), CC)).toEqual(['if true', 'then git push --force', 'else exec rm -rf /', 'fi']);
	});

	it('« # » en début de mot : commentaire jusqu\'à la fin de la ligne, sauf dans ${…}, $(…) ou accents graves', () => {
		expect(commandesDe(bash('ls # ; git push --force\ngit status'), CC)).toEqual(['ls', 'git status']);
		expect(commandesDe(bash('# git push --force'), CC)).toEqual([]);
		expect(commandesDe(bash('echo a#b ; echo "#c" ; d'), CC)).toEqual(['echo a#b', 'echo "#c"', 'd']);
		expect(commandesDe(bash('echo ${x:-a #}; git push --force'), CC)).toEqual(['echo ${x:-a #}', 'git push --force']);
		expect(verifier([regle('git push --force*')], bash('echo ${x:-a #}; git push --force'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('git push --force*')], bash('echo $(f (a) #b) ; git push --force'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('git push --force*')], bash('echo `a #b` ; git push --force'), ctx)).toMatchObject({ refus: true });
		expect(verifier([regle('git push --force*')], bash('ls # git push --force'), ctx)).toEqual({ refus: false });
	});
});

describe('motifRegleInvalide', () => {
	const regle = (motifs: unknown[], type = 'chemins_interdits'): Regle => ({ type, motifs } as Regle);
	it('1 à 20 motifs de 1 à 200 caractères, sans caractère de contrôle', () => {
		expect(motifRegleInvalide(regle(['**/.env']))).toBeNull();
		expect(motifRegleInvalide(regle(Array.from({ length: 20 }, (_, i) => `m${i}`)))).toBeNull();
		expect(motifRegleInvalide(regle([]))).not.toBeNull();
		expect(motifRegleInvalide(regle(Array.from({ length: 21 }, (_, i) => `m${i}`)))).not.toBeNull();
		expect(motifRegleInvalide(regle(['x'.repeat(200)]))).toBeNull();
		expect(motifRegleInvalide(regle(['x'.repeat(201)]))).not.toBeNull();
		expect(motifRegleInvalide(regle(['']))).not.toBeNull();
		expect(motifRegleInvalide(regle(['   ']))).not.toBeNull();
		expect(motifRegleInvalide(regle(['a\nb']))).not.toBeNull();
		expect(motifRegleInvalide(regle(['a\u0000']))).not.toBeNull();
		expect(motifRegleInvalide(regle([3]))).not.toBeNull();
		expect(motifRegleInvalide(regle(['x'], 'autre'))).not.toBeNull();
		for (const m of ['../x', 'a/../b', '..\\x', 'a/..', '..']) expect(motifRegleInvalide(regle([m])), m).not.toBeNull();
		expect(motifRegleInvalide(regle(['a..b/..c', '.../x']))).toBeNull();
		expect(motifRegleInvalide(regle(['cd ../x'], 'commandes_interdites'))).toBeNull();
	});
});

describe('verifier', () => {
	const ctx = { racine: RACINE, cwd: RACINE, sansCasse: false, outils: CC };
	const chemins = { texte: 'Ne touche jamais aux .env.', regle: { type: 'chemins_interdits' as const, motifs: ['**/.env', 'vendor/**'] } };
	const commandes = { texte: 'Jamais de push forcé.', regle: { type: 'commandes_interdites' as const, motifs: ['git push --force*', 'rm -rf /*'] } };

	it('refuse avec la consigne et le motif', () => {
		expect(verifier([chemins], ecrire('/home/u/dossier/app/.env'), ctx)).toEqual({ refus: true, consigne: 'Ne touche jamais aux .env.', motif: '**/.env' });
		expect(verifier([chemins], ecrire('/home/u/dossier/vendor/x.php', 'Edit'), ctx)).toEqual({ refus: true, consigne: chemins.texte, motif: 'vendor/**' });
		expect(verifier([chemins, commandes], bash('ls && git  push --force-with-lease origin'), ctx)).toEqual({ refus: true, consigne: commandes.texte, motif: 'git push --force*' });
		expect(verifier([commandes], bash('rm -rf /'), ctx)).toMatchObject({ refus: true, motif: 'rm -rf /*' });
	});

	it('permet le reste', () => {
		expect(verifier([chemins, commandes], ecrire('/home/u/dossier/src/a.ts'), ctx)).toEqual({ refus: false });
		expect(verifier([chemins, commandes], bash('git push origin main'), ctx)).toEqual({ refus: false });
		expect(verifier([chemins, commandes], bash('git commit -m "git push --force"'), ctx)).toEqual({ refus: false });
		expect(verifier([chemins, commandes], { nom: 'Read', entree: { file_path: '/home/u/dossier/.env' } }, ctx)).toEqual({ refus: false });
		// un rappel, pas un bac à sable
		expect(verifier([commandes], bash('env git push --force'), ctx)).toEqual({ refus: false });
	});

	it('hors de la racine, seul un motif absolu correspond', () => {
		const abs = { texte: 'Pas dans /etc.', regle: { type: 'chemins_interdits' as const, motifs: ['/etc/**'] } };
		expect(verifier([chemins], ecrire('/home/u/autre/.env'), ctx)).toEqual({ refus: false });
		expect(verifier([abs], ecrire('/etc/hosts'), ctx)).toMatchObject({ refus: true, motif: '/etc/**' });
		// un motif absolu vise aussi un chemin sous la racine
		const dedans = { texte: 'Pas de secrets.', regle: { type: 'chemins_interdits' as const, motifs: ['/home/u/dossier/secrets/**'] } };
		expect(verifier([dedans], ecrire('secrets/a.txt'), ctx)).toMatchObject({ refus: true });
	});

	it('racine reconnue à la casse près quand sansCasse (macOS)', () => {
		const mac = { racine: '/Users/a/mnemo', cwd: '/Users/a/mnemo', sansCasse: true, outils: CC };
		expect(cheminsTouches(ecrire('/Users/A/Mnemo/vendor/x'), CC, '/Users/a/mnemo', '/', true)).toEqual(['vendor/x']);
		expect(cheminsTouches(ecrire('/Users/A/Mnemo/vendor/x'), CC, '/Users/a/mnemo', '/')).toEqual(['/Users/A/Mnemo/vendor/x']);
		expect(verifier([chemins], ecrire('/Users/A/Mnemo/vendor/x'), mac)).toMatchObject({ refus: true, motif: 'vendor/**' });
	});

	it('casse et Windows', () => {
		const win = { racine: 'C:\\Users\\u\\D', cwd: 'C:\\Users\\u\\D', sansCasse: true, outils: CC };
		expect(verifier([chemins], ecrire('C:\\Users\\u\\D\\Vendor\\A.php'), win)).toMatchObject({ refus: true, motif: 'vendor/**' });
		expect(verifier([chemins], ecrire('/home/u/dossier/Vendor/a.php'), ctx)).toEqual({ refus: false });
		expect(verifier([chemins], ecrire('/home/u/dossier/Vendor/a.php'), { ...ctx, sansCasse: true, outils: CC })).toMatchObject({ refus: true });
		const abs = { texte: 'Pas Windows.', regle: { type: 'chemins_interdits' as const, motifs: ['c:\\windows\\**'] } };
		expect(verifier([abs], ecrire('C:\\Windows\\System32\\x.dll'), win)).toMatchObject({ refus: true });
	});

	it('action non lue : refusée dès qu\'une règle valide s\'applique, permise sans aucune', () => {
		const nonLue = { nonLue: 'entree_trop_grosse' as const };
		expect(verifier([chemins], nonLue, ctx)).toEqual({ refus: true, cause: 'entree_trop_grosse', detail: null });
		expect(verifier([commandes], { nonLue: 'entree_illisible' as const }, ctx)).toEqual({ refus: true, cause: 'entree_illisible', detail: null });
		expect(verifier([], nonLue, ctx)).toEqual({ refus: false });
	});

	it('règle invalide : refus, la consigne ne peut pas être appliquée (motif de l\'invalidité en détail)', () => {
		const vide = { texte: 'Vide.', regle: { type: 'commandes_interdites' as const, motifs: [' '] } };
		const attendu = { refus: true, cause: 'consigne_illisible', detail: '« Vide. » : Chaque motif fait de 1 à 200 caractères (non blancs).' };
		expect(verifier([vide], bash('ls'), ctx)).toEqual(attendu);
		expect(verifier([vide], { nonLue: 'entree_illisible' }, ctx)).toEqual(attendu);
	});
});

describe('outils de Codex', () => {
	const patch = (corps: string): ActionOutil => ({ nom: 'apply_patch', entree: { command: `*** Begin Patch\n${corps}*** End Patch\n` } });
	const ctx = { racine: RACINE, cwd: '/home/u/dossier/projet', sansCasse: false, outils: OUTILS_CODEX };

	it('apply_patch : chemins des en-têtes Add, Update, Delete et Move to, relatifs au cwd ; les autres lignes ignorées', () => {
		const action = patch('*** Add File: src/neuf.ts\n+x\n*** Update File: /home/u/dossier/a.ts\n@@\n-*** Add File: faux.ts\n*** Move to: vendor/b.ts\n*** Delete File: ../.env\n');
		expect(cheminsTouches(action, OUTILS_CODEX, RACINE, '/home/u/dossier/projet')).toEqual(['projet/src/neuf.ts', 'a.ts', 'projet/vendor/b.ts', '.env']);
		expect(cheminsTouches({ nom: 'apply_patch', entree: {} }, OUTILS_CODEX, RACINE, RACINE)).toBe('illisible');
		expect(cheminsTouches({ nom: 'Write', entree: { file_path: '/home/u/dossier/.env' } }, OUTILS_CODEX, RACINE, RACINE)).toBeNull();
	});

	it('Bash.command pour commandes_interdites ; un autre outil n\'est pas une commande', () => {
		expect(commandesDe(bash('ls && git push --force'), OUTILS_CODEX)).toEqual(['ls', 'git push --force']);
		expect(commandesDe(patch('*** Add File: a\n'), OUTILS_CODEX)).toBeNull();
		expect(commandesDe({ nom: 'Bash', entree: { command: ['git', 'push', '--force'] } }, OUTILS_CODEX)).toEqual(['git push --force']);
	});

	it('liste d’arguments : un shell avec -c ou -lc rend sa ligne ; sinon chaque élément cité au besoin (jamais un « ; » nu)', () => {
		const liste = (command: string[], nom = 'Bash'): ActionOutil => ({ nom, entree: { command } });
		expect(commandesDe(liste(['bash', '-lc', 'ls && git push --force']), OUTILS_CODEX)).toEqual(['ls', 'git push --force']);
		expect(commandesDe(liste(['/bin/zsh', '-c', 'git push --force']), OUTILS_CODEX)).toEqual(['git push --force']);
		expect(commandesDe(liste(['echo', 'a; git push --force']), OUTILS_CODEX)).toEqual(["echo 'a; git push --force'"]);
		expect(commandesDe(liste(['sh', 'script.sh']), OUTILS_CODEX)).toEqual(['sh script.sh']);
	});

	it('outils shell de Codex selon le mode : shell, exec_command, local_shell (command ou cmd)', () => {
		for (const nom of ['shell', 'exec_command', 'local_shell']) {
			expect(commandesDe({ nom, entree: { command: ['bash', '-lc', 'git push --force'] } }, OUTILS_CODEX), nom).toEqual(['git push --force']);
			expect(commandesDe({ nom, entree: { cmd: 'git push --force' } }, OUTILS_CODEX), nom).toEqual(['git push --force']);
		}
		expect(commandesDe({ nom: 'view_image', entree: { path: 'x' } }, OUTILS_CODEX)).toBeNull();
	});

	it('apply_patch : en-têtes tolérants (casse, espaces) ; patch sous input ; patch introuvable ou sans en-tête lisible : illisible', () => {
		const p = (entree: Record<string, unknown>) => cheminsTouches({ nom: 'apply_patch', entree }, OUTILS_CODEX, RACINE, RACINE);
		expect(p({ command: '*** Begin Patch\n  ***  add file :  .env  \n***UPDATE FILE:a.ts\n*** End Patch' })).toEqual(['.env', 'a.ts']);
		expect(p({ input: '*** Begin Patch\n*** Delete File: b.ts\n*** End Patch' })).toEqual(['b.ts']);
		expect(p({ command: ['apply_patch', '*** Begin Patch\n*** Add File: c.ts\n*** End Patch'] })).toEqual(['c.ts']);
		expect(p({})).toBe('illisible');
		expect(p({ command: '*** Begin Patch\n*** Ajoute: .env\n+x\n*** End Patch' })).toBe('illisible');
		expect(p({ command: '*** Begin Patch\n*** End Patch' })).toEqual([]);
	});

	it('commande shell qui passe un patch à apply_patch (heredoc) : chemins de ses en-têtes ; grep apply_patch : pas une écriture', () => {
		const heredoc = "apply_patch <<'EOF'\n*** Begin Patch\n*** Add File: config/.env\n+A=1\n*** End Patch\nEOF";
		expect(cheminsTouches(bash(heredoc), OUTILS_CODEX, RACINE, RACINE)).toEqual(['config/.env']);
		expect(cheminsTouches({ nom: 'shell', entree: { command: ['bash', '-lc', heredoc] } }, OUTILS_CODEX, RACINE, RACINE)).toEqual(['config/.env']);
		expect(cheminsTouches(bash('grep -r apply_patch src'), OUTILS_CODEX, RACINE, RACINE)).toBeNull();
		expect(cheminsTouches(bash("apply_patch <<'EOF'\n*** Begin Patch\n*** Ajoute: .env\nEOF"), OUTILS_CODEX, RACINE, RACINE)).toBe('illisible');
	});

	it('consignes vérifiées : un patch vers un chemin interdit et une commande interdite sont refusés', () => {
		const chemins: Regle = { type: 'chemins_interdits', motifs: ['**/.env'] };
		const commandes: Regle = { type: 'commandes_interdites', motifs: ['git push --force*'] };
		expect(verifier([{ texte: 'Pas de .env.', regle: chemins }], patch('*** Update File: .env\n'), ctx)).toEqual({ refus: true, consigne: 'Pas de .env.', motif: '**/.env' });
		expect(verifier([{ texte: 'Pas de .env.', regle: chemins }], patch('*** Update File: src/a.ts\n'), ctx)).toEqual({ refus: false });
		expect(verifier([{ texte: 'Pas de push forcé.', regle: commandes }], bash('git push --force origin'), ctx)).toMatchObject({ refus: true, motif: 'git push --force*' });
		// les noms de Claude Code ne valent rien chez Codex
		expect(verifier([{ texte: 'Pas de .env.', regle: chemins }], ecrire('/home/u/dossier/.env'), ctx)).toEqual({ refus: false });
		// patch illisible : refusé là où des chemins sont interdits, permis sinon
		expect(verifier([{ texte: 'Pas de .env.', regle: chemins }], { nom: 'apply_patch', entree: {} }, ctx)).toEqual({ refus: true, cause: 'entree_illisible', detail: null });
		expect(verifier([{ texte: 'Pas de push forcé.', regle: commandes }], { nom: 'apply_patch', entree: {} }, ctx)).toEqual({ refus: false });
		expect(verifier([{ texte: 'Pas de .env.', regle: chemins }], bash("apply_patch <<'EOF'\n*** Begin Patch\n*** Update File: .env\n*** End Patch\nEOF"), ctx)).toMatchObject({ refus: true, motif: '**/.env' });
	});
});
