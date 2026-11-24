/** Node 25 et plus posent son propre `localStorage` (indéfini sans fichier) : un stockage en mémoire à la place (à défaire par `vi.unstubAllGlobals()`). */
import { vi } from 'vitest';

export function stockage(): Map<string, string> {
	const valeurs = new Map<string, string>();
	vi.stubGlobal('localStorage', { getItem: (k: string) => valeurs.get(k) ?? null, setItem: (k: string, v: string) => void valeurs.set(k, v), removeItem: (k: string) => void valeurs.delete(k) });
	return valeurs;
}
