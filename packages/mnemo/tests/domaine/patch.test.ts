/** Chemins écrits par un patch `apply_patch` (Codex). */
import { describe, expect, it } from 'vitest';
import { cheminsDuPatch, cheminsEcritsDuPatch } from '../../src/domaine/moteurs/patch.ts';

describe('patch', () => {
	it('chemins des en-têtes, sans doublon ; illisible : absent, ou du contenu sans en-tête ; vide : rien', () => {
		const patch = '*** Begin Patch\n*** Add File: a.md\n+x\n*** Update File: b.md\n*** Move to: c.md\n*** Delete File: a.md\n*** End Patch';
		expect(cheminsDuPatch(patch)).toEqual(['a.md', 'b.md', 'c.md']);
		expect(cheminsEcritsDuPatch(patch)).toEqual(['a.md', 'b.md', 'c.md']);
		expect(cheminsEcritsDuPatch(null)).toBe('illisible');
		expect(cheminsEcritsDuPatch('rm -rf /')).toBe('illisible');
		expect(cheminsEcritsDuPatch('*** Begin Patch\n*** End Patch\n')).toEqual([]);
	});
});
