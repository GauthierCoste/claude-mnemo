import { describe, expect, it } from 'vitest';
import { variable } from '../../src/infra/environnement.ts';

describe('variable : une variable d’environnement lue comme le système la lit', () => {
	const env = { Path: 'C:\\Windows', LocalAppData: 'C:\\Users\\a\\AppData\\Local', HOME: '/Users/a' };

	it('Windows : casse ignorée, des deux côtés', () => {
		expect(variable(env, 'PATH', 'win32')).toBe('C:\\Windows');
		expect(variable(env, 'LOCALAPPDATA', 'win32')).toBe('C:\\Users\\a\\AppData\\Local');
		expect(variable(env, 'path', 'win32')).toBe('C:\\Windows');
		expect(variable(env, 'ABSENTE', 'win32')).toBeUndefined();
	});

	it('ailleurs : nom exact', () => {
		expect(variable(env, 'HOME', 'darwin')).toBe('/Users/a');
		expect(variable(env, 'PATH', 'darwin')).toBeUndefined();
		expect(variable(env, 'Path', 'linux')).toBe('C:\\Windows');
	});
});
