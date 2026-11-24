import { describe, expect, it } from 'vitest';
import { argumentsGit } from '../../src/infra/git.ts';

describe('argumentsGit : une seule définition des options de git, plus celles propres à un usage', () => {
	it('options communes à tout appel, puis les options propres, puis les arguments', () => {
		expect(argumentsGit([], ['status'])).toEqual(['-c', 'core.quotepath=false', '-c', 'core.longpaths=true', '-c', 'commit.gpgsign=false', 'status']);
		expect(argumentsGit(['core.autocrlf=false'], ['commit', '-m', 'x'])).toEqual([
			'-c', 'core.quotepath=false', '-c', 'core.longpaths=true', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', 'commit', '-m', 'x',
		]);
	});
});
