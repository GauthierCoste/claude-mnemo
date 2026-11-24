import { execFileSync } from 'node:child_process';

/** git dans `dossier` (jamais de shell), avec une identité : les tests ne dépendent pas de la configuration de la machine. */
export function git(dossier: string, ...args: string[]): string {
	return execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@localhost', '-c', 'commit.gpgsign=false', ...args], {
		cwd: dossier,
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'ignore'],
	}).trim();
}
