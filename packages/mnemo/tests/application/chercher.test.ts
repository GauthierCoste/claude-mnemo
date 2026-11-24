import { describe, expect, it } from 'vitest';
import { chercher, chronologie, voisins } from '../../src/application/chercher.ts';
import { estEncadre } from '../../src/domaine/contexte.ts';
import { fauxPorts } from '../aides/faux-ports.ts';

const entete = (type = 'sujet', extra = '') => `---\nid: 01ABC\ntype: ${type}\n${extra}updated: 2026-11-01\n---\n`;
const ligne = (texte: string, ancre: string, extra = '', appris = '2026-11-20') =>
	`- ${texte} | declare | src: utilisateur oral | appris ${appris} | confiance 100 %${extra} ^${ancre}`;

describe('chercher', () => {
	it('exclut barrés et à confirmer par défaut, les trouve avec les options', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'a.md',
			`${entete()}# A\n\n## Faits\n${ligne('Zanzibar servi', 'f-0001')}\n- ~~Zanzibar barré~~ | declare | src: utilisateur oral | ^f-0002\n${ligne('Zanzibar douteux', 'f-0003', ' | a confirmer')}\n`,
		);
		expect((await chercher(dep, { texte: 'zanzibar' })).map((t) => t.id)).toEqual(['a.md#^f-0001']);
		const confirmer = await chercher(dep, { texte: 'zanzibar', inclureAConfirmer: true });
		expect(confirmer.map((t) => t.id).sort()).toEqual(['a.md#^f-0001', 'a.md#^f-0003']);
		const invalides = await chercher(dep, { texte: 'zanzibar', inclureInvalides: true });
		expect(invalides.map((t) => t.id).sort()).toEqual(['a.md#^f-0001', 'a.md#^f-0002']);
	});

	it('ne lève pas d\'erreur sur la syntaxe FTS5 et rend [] pour une requête sans mot', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${ligne("L'inventaire est fait", 'f-0001')}\n`);
		for (const texte of ['"', 'a:b', 'NEAR(', '*', '-x', '(', "l'inventaire", 'inventaire AND']) {
			await expect(chercher(dep, { texte })).resolves.toBeDefined();
		}
		expect(await chercher(dep, { texte: '"*-:()' })).toEqual([]);
		expect((await chercher(dep, { texte: "l'inventaire" })).length).toBe(1);
	});

	it('accents, casse et préfixe', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${ligne('Réunion des inventaires', 'f-0001')}\n`);
		expect((await chercher(dep, { texte: 'reunion' })).length).toBe(1);
		expect((await chercher(dep, { texte: 'inventaire' })).length).toBe(1);
	});

	it('alias : « ML » trouve un fait qui contient « Marc Lefèvre »', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('clients/ml.md', `${entete('entite', 'alias: [ML, Marc]\n')}# Marc Lefèvre\n`);
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Faits\n${ligne('Marc Lefèvre valide le devis', 'f-0001')}\n`);
		const trouves = await chercher(dep, { texte: 'ML', genres: ['fait'] });
		expect(trouves.map((t) => t.id)).toEqual(['projets/p/p.md#^f-0001']);
	});

	it('position : à pertinence égale, la fiche liée à la position passe devant', async () => {
		const dep = fauxPorts();
		const fiche = (texte: string) => `${entete()}# F\n\n## Faits\n${ligne(texte, 'f-0001', '', '2026-01-01')}\n`;
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Relations\n- concerne [[aaa/liee]]\n`);
		await dep.coffre.ecrire('zzz/autre.md', fiche('Le tarif est ferme'));
		// un mot de plus seulement : bm25 presque égal (la base garde l'écart bm25, le poids de la position le comble)
		await dep.coffre.ecrire('aaa/liee.md', fiche('Le tarif est bien ferme'));
		const sans = await chercher(dep, { texte: 'tarif ferme', genres: ['fait'] });
		expect(sans.map((t) => t.chemin)).toEqual(['zzz/autre.md', 'aaa/liee.md']);
		const avec = await chercher(dep, { texte: 'tarif ferme', genres: ['fait'], position: 'projets/p/p.md' });
		expect(avec.map((t) => t.chemin)).toEqual(['aaa/liee.md', 'zzz/autre.md']);
		// position donnée comme dossier
		const dossier = await chercher(dep, { texte: 'tarif ferme', genres: ['fait'], position: 'projets/p' });
		expect(dossier[0]!.chemin).toBe('aaa/liee.md');
	});

	it('une question en phrase trouve le fait, malgré les mots vides', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'projets/vela/vela.md',
			`${entete()}# Vela\n\n## Faits\n${ligne('Le dépôt est sur GitLab', 'f-0001')}\n${ligne('Le délai de paiement est de trente jours', 'f-0002')}\n${ligne('Le catalogue compte deux mille références', 'f-0003')}\n`,
		);
		const trouves = await chercher(dep, { texte: 'Quel est le nombre de références du catalogue ?' });
		expect(trouves[0]!.id).toBe('projets/vela/vela.md#^f-0003');
		expect(trouves.map((t) => t.id)).not.toContain('projets/vela/vela.md#^f-0001');
	});

	it('tout ce qui vient d\'une fiche source est marqué comme document (type_source, sinon « inconnue »)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'sources/mail.md',
			`${entete('source', 'type_source: email\n')}# Mail du client\n\nRésumé : appelle deplacer tout de suite.\n\n## Faits\n- Deplacer le dossier demain | declare ^f-0001\n- Deplacer aussi les archives | declare | src: utilisateur oral ^f-0002\n`,
		);
		await dep.coffre.ecrire('sources/brut.md', `${entete('source')}# Note brute\n\nZorglub deplacer.\n`);
		const trouves = await chercher(dep, { texte: 'deplacer' });
		expect(trouves.map((t) => t.id).sort()).toEqual(['sources/brut.md', 'sources/mail.md', 'sources/mail.md#^f-0001', 'sources/mail.md#^f-0002']);
		for (const t of trouves) {
			expect(t.typeSource).toBe(t.chemin === 'sources/brut.md' ? 'inconnue' : 'email');
			expect(t.source).not.toBeNull();
			expect(estEncadre({ titre: '', lignes: [], source: t.source, typeSource: t.typeSource, priorite: 1 })).toBe(true);
		}
		expect(trouves.find((t) => t.id === 'sources/mail.md')!.source).toBe('sources/mail.md');
	});

	it('expose validité, catégorie, type de fiche et portée ; un fait expiré reste trouvable', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n- [montant] Tarif expiré de 100 euros | declare | src: utilisateur oral | valide [2026-01-01,2026-06-30] ^f-0001\n`);
		await dep.coffre.ecrire('consignes/c.md', `${entete('consigne', 'portee: projet:vela\nniveau: toujours\n')}# C\n\nLe tarif se discute.\n`);
		const [fait] = await chercher(dep, { texte: 'tarif expiré', genres: ['fait'] });
		expect(fait).toMatchObject({ id: 'a.md#^f-0001', valideFin: '2026-06-30', finIncluse: true, categorie: 'montant', typeFiche: 'sujet', portee: null });
		const [c] = await chercher(dep, { texte: 'tarif discute', genres: ['consigne'] });
		expect(c).toMatchObject({ typeFiche: 'consigne', portee: 'projet:vela', valideFin: null });
	});

	it('respecte le périmètre et la limite', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a/x.md', `${entete()}# X\n\n## Faits\n${ligne('Mot commun un', 'f-0001')}\n${ligne('Mot commun deux', 'f-0002')}\n`);
		await dep.coffre.ecrire('b/y.md', `${entete()}# Y\n\n## Faits\n${ligne('Mot commun trois', 'f-0001')}\n`);
		expect((await chercher(dep, { texte: 'commun', perimetre: 'a', genres: ['fait'] })).length).toBe(2);
		expect((await chercher(dep, { texte: 'commun', genres: ['fait'], limite: 1 })).length).toBe(1);
	});
});

describe('voisins', () => {
	it('rend relations sortantes et liens entrants ; id d\'élément accepté ; inconnu → null', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Faits\n${ligne('Un fait', 'f-0001')}\n\n## Relations\n- concerne [[clients/c/c]]\n`);
		await dep.coffre.ecrire('clients/c/c.md', `${entete('entite')}# C\n\nVoir [[projets/p/p]].\n`);
		const v = await voisins(dep, 'projets/p/p.md');
		expect(v!.fiche).toBe('projets/p/p.md');
		expect(v!.sortants).toContainEqual({ de: 'projets/p/p.md', vers: 'clients/c/c.md', verbe: 'concerne' });
		expect(v!.entrants).toContainEqual({ de: 'clients/c/c.md', vers: 'projets/p/p.md', verbe: null });
		expect(v!.existants).toContain('clients/c/c.md');
		expect(v!.documents).toEqual([]);
		expect((await voisins(dep, 'projets/p/p.md#^f-0001'))!.fiche).toBe('projets/p/p.md');
		expect(await voisins(dep, 'inconnue.md')).toBeNull();
		expect(await voisins(dep, 'inconnue.md#^f-0001')).toBeNull();
	});
});

describe('voisins : même résolveur que le graphe et la vue d’une fiche', () => {
	it('un lien par titre ou par alias mène à la fiche (sortant existant, entrant compté)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\nVoir [[Client C]].\n`);
		await dep.coffre.ecrire('clients/c/c.md', `${entete('entite', 'alias:\n  - Cé\n')}# Client C\n\nTravaille sur [[P]].\n`);
		await dep.coffre.ecrire('notes/n.md', `${entete()}# N\n\nCité : [[cé]].\n`);
		const p = await voisins(dep, 'projets/p/p.md');
		expect(p!.existants).toEqual(['clients/c/c.md']);
		expect(p!.sortants).toEqual([{ de: 'projets/p/p.md', vers: 'clients/c/c.md', verbe: null }]);
		expect(p!.entrants).toEqual([{ de: 'clients/c/c.md', vers: 'projets/p/p.md', verbe: null }]);
		const c = await voisins(dep, 'clients/c/c.md');
		expect(c!.entrants).toEqual([
			{ de: 'notes/n.md', vers: 'clients/c/c.md', verbe: null },
			{ de: 'projets/p/p.md', vers: 'clients/c/c.md', verbe: null },
		]);
	});
});

describe('chronologie', () => {
	it('trie par date croissante, date nulle en dernier, sans seuil', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'a.md',
			`${entete()}# A\n\n## Faits\n${ligne('Livraison tardive', 'f-0001', '', '2026-10-01')}\n${ligne('Livraison précoce', 'f-0002', '', '2026-02-01')}\n- Livraison sans date | declare | src: utilisateur oral ^f-0003\n${ligne('Livraison douteuse', 'f-0004', ' | a confirmer', '2025-01-01')}\n`,
		);
		const t = await chronologie(dep, 'livraison');
		expect(t.map((x) => x.id)).toEqual(['a.md#^f-0004', 'a.md#^f-0002', 'a.md#^f-0001', 'a.md#^f-0003']);
	});
});

describe('chronologie : dédoublonnée', () => {
	it('trois sources de même texte : une seule ligne', async () => {
		const dep = fauxPorts();
		for (const d of ['a', 'b', 'c']) await dep.coffre.ecrire(`sources/${d}/regle.md`, `${entete('source', 'type_source: note\n')}# Zorglub\n\nPoser le zorglub à plat.\n`);
		expect(await chronologie(dep, 'zorglub')).toHaveLength(1);
	});
});

describe('chercher : une entrée par document et par contenu', () => {
	it('trois sources de même texte : une entrée, les deux autres signalées en copies ; dédoublonner faux les rend toutes', async () => {
		const dep = fauxPorts();
		for (const d of ['a', 'b', 'c']) await dep.coffre.ecrire(`sources/${d}/regle.md`, `${entete('source', 'type_source: note\n')}# Zorglub\n\nPoser le zorglub à plat.\n`);
		const trouves = await chercher(dep, { texte: 'zorglub', genres: ['fiche'] });
		expect(trouves).toHaveLength(1);
		expect(trouves[0]!.copies).toHaveLength(2);
		expect(await chercher(dep, { texte: 'zorglub', genres: ['fiche'], dedoublonner: false })).toHaveLength(3);
	});
});

describe('chercher : note unique (base + poids)', () => {
	it('cas A réduit : le bon fait (51 %, mots exacts) devant trois faits à 100 % qui n’ont que les mots du titre de la fiche de position', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire(
			'projets/vitrail/vitrail.md',
			`${entete('dossier')}# Verrières Aubépine\n\n## Faits\n${ligne('Les commandes arrivent par le bouche-à-oreille', 'f-0001')}\n${ligne('Un devis signé précède tout achat', 'f-0002')}\n${ligne('Le règlement se fait en deux fois', 'f-0003')}\n- Le plafond de refroidissement du four est de vingt degrés par heure | observe | src: session atelier | appris 2026-11-20 | confiance 51 % ^f-0004\n`,
		);
		// « vitesse » n'est nulle part : la liste « toutes » est vide, les trois leurres sont aux rangs 2 à 5 de « une » par le titre
		const texte = 'Quel plafond de vitesse de refroidissement pour le four des verrières Aubépine ?';
		for (const position of [undefined, 'projets/vitrail/vitrail.md']) {
			const trouves = await chercher(dep, { texte, ...(position === undefined ? {} : { position }) });
			expect(trouves[0]!.id, position).toBe('projets/vitrail/vitrail.md#^f-0004');
			expect(trouves[0]!.apports.find((a) => a.poids === 'confiance')!.valeur).toBeCloseTo(-0.049, 10);
			// pas d'égalité en tête
			expect(trouves[1]!.score).toBeLessThan(trouves[0]!.score);
		}
	});

	it('le seuil porte sur la pertinence : une base sous le seuil n’entre pas, même avec le poids de la position', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('a.md', `${entete()}# A\n\n## Faits\n${ligne('Alpha beta', 'f-0001')}\n`);
		const z = Array.from({ length: 20 }, (_, i) => ligne(`Alpha ${i}`, `f-${String(i + 1).padStart(4, '0')}`)).join('\n');
		await dep.coffre.ecrire('z.md', `${entete()}# Z\n\n## Faits\n${z}\n`);
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Faits\n${ligne('Alpha revient dans une phrase bien plus longue que les autres faits de la mémoire', 'f-0001')}\n`);
		const cible = 'projets/p/p.md#^f-0001';
		const requete = { texte: 'alpha beta', position: 'projets/p/p.md', limite: 30 };
		// « toutes » : a.md seul ; « une » : a.md, les 20 faits de z.md, puis la cible (rang 22) : 61 / (2 × 82) ≈ 0,37 < 0,4
		expect((await chercher(dep, requete)).map((t) => t.id)).not.toContain(cible);
		const t = (await chercher(dep, { ...requete, sansSeuil: true })).find((x) => x.id === cible)!;
		expect(t.base).toBeLessThan(0.4);
		expect(t.apports.map((a) => a.poids)).toContain('position');
	});

	it('une fiche source compte avec la fiabilité de son type (note : 60 %) et sans le poids de la mémoire', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/n.md', `${entete('source', 'type_source: note\n')}# Zorglub\n`);
		const [t] = await chercher(dep, { texte: 'zorglub', genres: ['fiche'] });
		expect(t!.id).toBe('sources/n.md');
		const confiance = t!.apports.find((a) => a.poids === 'confiance')!;
		expect(confiance.confiance).toBe(0.6);
		expect(confiance.valeur).toBeCloseTo(-0.04, 10);
		expect(t!.apports.map((a) => a.poids)).not.toContain('memoire');
	});

	it('un fait déclaré qui cite une note importée de Claude Code, avec sa citation : la parole de l’utilisateur (aucun retrait de confiance)', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/claude-code/p/regle.md', `${entete('source', 'type_source: note\norigine: claude-code/p/memory/regle.md\n')}# Règle\n`);
		await dep.coffre.ecrire(
			'pratiques/pose.md',
			`${entete()}# Pose\n\n## Faits\n- Confirmer la pose par écrit | declare | src: [[sources/claude-code/p/regle]] | appris 2026-11-20 | confiance 60 % ^f-0001\n  > « Toujours confirmer la pose par écrit. »\n- Confirmer la pose par courrier | declare | src: [[sources/claude-code/p/regle]] | appris 2026-11-20 | confiance 60 % ^f-0002\n`,
		);
		const trouves = await chercher(dep, { texte: 'confirmer pose', genres: ['fait'] });
		const cite = trouves.find((t) => t.id === 'pratiques/pose.md#^f-0001')!;
		expect(cite.apports.map((a) => a.poids)).not.toContain('confiance');
		// sans citation, la règle ne joue pas : la confiance écrite (60 %) compte
		const nu = trouves.find((t) => t.id === 'pratiques/pose.md#^f-0002')!;
		expect(nu.apports.find((a) => a.poids === 'confiance')!.confiance).toBe(0.6);
	});

	it('la parole de l’utilisateur : aussi quand la note importée est citée par son nom ou son titre', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('sources/claude-code/p/regle-pose.md', `${entete('source', 'type_source: note\norigine: claude-code/p/memory/regle-pose.md\n')}# Règle de pose\n`);
		await dep.coffre.ecrire('notes/ailleurs.md', `${entete('source', 'type_source: note\n')}# Ailleurs\n`);
		const fait = (texte: string, src: string, ancre: string) => `- ${texte} | declare | src: ${src} | appris 2026-11-20 | confiance 60 % ^${ancre}\n  > « ${texte}. »`;
		await dep.coffre.ecrire(
			'pratiques/pose.md',
			`${entete()}# Pose\n\n## Faits\n${fait('Confirmer la pose par écrit', '[[regle-pose]]', 'f-0001')}\n${fait('Confirmer la pose par courrier', '[[Règle de pose]]', 'f-0002')}\n${fait('Confirmer la pose par téléphone', '[[Ailleurs]]', 'f-0003')}\n`,
		);
		const trouves = await chercher(dep, { texte: 'confirmer pose', genres: ['fait'] });
		const poids = (id: string) => trouves.find((t) => t.id === id)!.apports.map((a) => a.poids);
		expect(poids('pratiques/pose.md#^f-0001')).not.toContain('confiance');
		expect(poids('pratiques/pose.md#^f-0002')).not.toContain('confiance');
		// un lien qui se résout hors des notes importées : la confiance écrite compte
		expect(poids('pratiques/pose.md#^f-0003')).toContain('confiance');
	});

	it('la parole de l’utilisateur se décide par l’`origine` de la note citée, pas par son rangement : une note importée déplacée compte', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('notes/rangee.md', `${entete('source', 'type_source: note\norigine: claude-code/p/memory/rangee.md\n')}# Rangée\n`);
		await dep.coffre.ecrire('sources/claude-code/p/sans-origine.md', `${entete('source', 'type_source: note\n')}# Sans origine\n`);
		const fait = (texte: string, src: string, ancre: string) => `- ${texte} | declare | src: ${src} | appris 2026-11-20 | confiance 60 % ^${ancre}\n  > « ${texte}. »`;
		await dep.coffre.ecrire(
			'pratiques/pose.md',
			`${entete()}# Pose\n\n## Faits\n${fait('Confirmer la pose par écrit', '[[notes/rangee]]', 'f-0001')}\n${fait('Confirmer la pose par courrier', '[[sources/claude-code/p/sans-origine]]', 'f-0002')}\n`,
		);
		const trouves = await chercher(dep, { texte: 'confirmer pose', genres: ['fait'] });
		const poids = (id: string) => trouves.find((t) => t.id === id)!.apports.map((a) => a.poids);
		expect(poids('pratiques/pose.md#^f-0001')).not.toContain('confiance');
		// rangée sous sources/claude-code/ mais sans origine d'import : pas la parole de l'utilisateur
		expect(poids('pratiques/pose.md#^f-0002')).toContain('confiance');
	});
});

describe('chercher : entrée dédoublonnée', () => {
	it('deux faits identiques : la copie du voisinage est montrée, avec sa propre base et ses propres poids ; la place reste celle du groupe', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('projets/p/p.md', `${entete()}# P\n\n## Relations\n- concerne [[aaa/proche]]\n`);
		// la copie lointaine est récente et sûre (mieux notée même sans le projet courant) ; la proche, ancienne et peu sûre
		await dep.coffre.ecrire('zzz/loin.md', `${entete()}# Loin\n\n## Faits\n${ligne('Le vernis sèche en six heures', 'f-0001', '', '2026-11-20')}\n`);
		await dep.coffre.ecrire(
			'aaa/proche.md',
			`${entete()}# Proche\n\n## Faits\n- Le vernis sèche en six heures | observe | src: session atelier | appris 2020-01-01 | confiance 10 % ^f-0001\n`,
		);
		const requete = { texte: 'vernis six heures', genres: ['fait' as const], position: 'projets/p/p.md' };
		const bruts = await chercher(dep, { ...requete, dedoublonner: false });
		const loin = bruts.find((t) => t.id === 'zzz/loin.md#^f-0001')!;
		const proche = bruts.find((t) => t.id === 'aaa/proche.md#^f-0001')!;
		// la copie lointaine est la mieux classée du groupe
		expect(bruts[0]!.id).toBe(loin.id);
		expect(loin.score).toBeGreaterThan(proche.score);
		const trouves = await chercher(dep, requete);
		expect(trouves).toHaveLength(1);
		const [t] = trouves;
		// montrée : la copie du voisinage (avant « la plus récente »), avec sa base et ses poids (projet courant, confiance 10 %) ;
		// la place : la note du groupe (celle de la copie lointaine)
		expect(t!.id).toBe(proche.id);
		expect(t!.copies).toEqual(['zzz/loin.md']);
		expect(t!.base).toBeCloseTo(proche.base, 10);
		expect(t!.apports).toEqual(proche.apports);
		expect(t!.apports.map((a) => a.poids)).toContain('position');
		expect(t!.apports.find((a) => a.poids === 'confiance')!.confiance).toBe(0.1);
		expect(t!.score).toBeCloseTo(loin.score, 10);
		// sans position : la plus récente, la lointaine
		const sans = await chercher(dep, { texte: requete.texte, genres: requete.genres });
		expect(sans.map((x) => [x.id, x.copies])).toEqual([['zzz/loin.md#^f-0001', ['aaa/proche.md']]]);
	});

	it('la copie citée par un fait est reconnue aussi quand le fait la cite par son titre', async () => {
		const dep = fauxPorts();
		await dep.coffre.ecrire('notes/a.md', `${entete()}# Carnet A\n\n## Faits\n${ligne('Le tapir dort le jour', 'f-0001', '', '2026-01-01')}\n`);
		// la copie de b.md est plus récente : sans la citation, c'est elle qui serait montrée
		await dep.coffre.ecrire('notes/b.md', `${entete()}# Carnet B\n\n## Faits\n${ligne('Le tapir dort le jour', 'f-0001', '', '2026-11-20')}\n`);
		await dep.coffre.ecrire('notes/n.md', `${entete()}# N\n\n## Faits\n- Le tapir est nocturne | declare | src: [[Carnet A]] | appris 2026-11-20 | confiance 100 % ^f-0001\n`);
		const trouves = await chercher(dep, { texte: 'tapir', genres: ['fait'] });
		const copie = trouves.find((t) => t.copies !== undefined)!;
		expect(copie.id).toBe('notes/a.md#^f-0001');
		expect(copie.copies).toEqual(['notes/b.md']);
	});
});
