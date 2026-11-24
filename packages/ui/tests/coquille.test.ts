// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { estAppDeBureau, poserCoquille } from '../src/coquille.ts';

const NAVIGATEUR = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const APP = `${NAVIGATEUR} MnemoApp/1.5.0`;

afterEach(() => {
	delete document.documentElement.dataset['coquille'];
});

describe('coquille de l’app de bureau', () => {
	it('reconnaît l’agent utilisateur de l’app de bureau, et lui seul', () => {
		expect(estAppDeBureau(APP)).toBe(true);
		expect(estAppDeBureau(NAVIGATEUR)).toBe(false);
		expect(estAppDeBureau(`${NAVIGATEUR} AutreApp/2.0.0`)).toBe(false);
	});

	it('pose data-coquille="app" sur <html> dans l’app de bureau', () => {
		poserCoquille(document.documentElement, APP);
		expect(document.documentElement.getAttribute('data-coquille')).toBe('app');
	});

	it('ne pose rien dans un navigateur', () => {
		poserCoquille(document.documentElement, NAVIGATEUR);
		expect(document.documentElement.hasAttribute('data-coquille')).toBe(false);
	});
});
