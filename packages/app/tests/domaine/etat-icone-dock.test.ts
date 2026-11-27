import { PROFIL_ARCHIVISTE } from '@mnemo/commun';
import { describe, expect, it } from 'vitest';
import { iconeDockDeLaPage, pastilleDock, TAILLE_MAX_ICONE_PAGE } from '../../src/domaine/dock.ts';
import { etatAgrege } from '../../src/domaine/etat.ts';
import { IMAGES_ICONE, imageIcone, infobulle, toutesLesImages } from '../../src/domaine/icone.ts';
import { session } from '../aides/sessions.ts';

const attend = session({ id: 'a', etat: 'attend' });
const travaille = session({ id: 't', etat: 'travaille' });
const enPause = session({ id: 'p', etat: 'en_pause' });
const archivisteALEcoute = session({ id: 'r', etat: 'attend', profil: PROFIL_ARCHIVISTE });

describe('état agrégé', () => {
	it('service arrêté, en démarrage, en arrêt, en erreur : cet état, quelles que soient les sessions', () => {
		for (const vie of ['arrete', 'demarrage', 'arret', 'erreur'] as const) expect(etatAgrege(vie, [attend, travaille])).toBe(vie);
	});

	it('service vivant : attend avant travaille, travaille avant repos', () => {
		expect(etatAgrege('vivant', [travaille, attend])).toBe('attend');
		expect(etatAgrege('vivant', [travaille, enPause])).toBe('travaille');
		expect(etatAgrege('vivant', [enPause])).toBe('repos');
		expect(etatAgrege('vivant', [])).toBe('repos');
	});

	it('l’archiviste à l’écoute ne fait pas attendre ; avec un dialogue ouvert, si', () => {
		expect(etatAgrege('vivant', [archivisteALEcoute])).toBe('repos');
		expect(etatAgrege('vivant', [{ ...archivisteALEcoute, dialogueOuvert: true }])).toBe('attend');
	});
});

describe('icône', () => {
	it('une image par état, deux pour le travail (animé) ; toutes des images « template »', () => {
		expect(imageIcone('repos', 7)).toBe('etat-reposTemplate');
		expect(imageIcone('travaille', 0)).toBe('etat-travaille-1Template');
		expect(imageIcone('travaille', 1)).toBe('etat-travaille-2Template');
		expect(imageIcone('travaille', 2)).toBe('etat-travaille-1Template');
		expect(IMAGES_ICONE.travaille).toHaveLength(2);
		expect(IMAGES_ICONE.arret).toEqual(IMAGES_ICONE.travaille);
		const toutes = toutesLesImages();
		expect(toutes).toHaveLength(6);
		for (const nom of toutes) expect(nom).toMatch(/^[a-z0-9-]+Template$/u);
	});

	it('infobulle : l’état en clair, au singulier ou au pluriel ; en erreur, la raison', () => {
		expect(infobulle('attend', [attend, { ...attend, id: 'b' }, travaille], null)).toBe('Mnemo — 2 sessions attendent ta réponse');
		expect(infobulle('attend', [attend], null)).toBe('Mnemo — 1 session attend ta réponse');
		expect(infobulle('travaille', [travaille], null)).toBe('Mnemo — 1 session travaille');
		expect(infobulle('repos', [], null)).toBe('Mnemo — aucune session active');
		expect(infobulle('arrete', [], null)).toBe('Mnemo — service arrêté');
		expect(infobulle('arret', [], null)).toBe('Mnemo — arrêt du service…');
		expect(infobulle('erreur', [], 'Le service ne démarre pas.')).toBe('Mnemo — Le service ne démarre pas.');
		expect(infobulle('erreur', [], null)).toBe('Mnemo — le service ne répond pas');
	});
});

describe('pastille du Dock', () => {
	it('le nombre de sessions qui attendent une réponse ; vide à 0', () => {
		expect(pastilleDock([attend, { ...attend, id: 'b' }, travaille, archivisteALEcoute])).toBe('2');
		expect(pastilleDock([travaille, archivisteALEcoute])).toBe('');
		expect(pastilleDock([])).toBe('');
	});
});

describe('icône du Dock à la couleur de l’interface', () => {
	const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGD4DwABBAEAwS2OUAAAAABJRU5ErkJggg==';

	it('prend l’icône PNG `data:` que la page a redessinée', () => {
		expect(iconeDockDeLaPage(['http://127.0.0.1:4747/icone.svg', png])).toBe(png);
	});

	it('ignore l’icône d’origine, un autre format, une adresse mal formée ou trop lourde : le Dock garde la sienne', () => {
		expect(iconeDockDeLaPage([])).toBeNull();
		expect(iconeDockDeLaPage(['http://127.0.0.1:4747/icone.svg'])).toBeNull();
		expect(iconeDockDeLaPage(['data:image/svg+xml;base64,PHN2Zy8+'])).toBeNull();
		expect(iconeDockDeLaPage(['data:image/png;base64,<script>'])).toBeNull();
		expect(iconeDockDeLaPage([`data:image/png;base64,${'A'.repeat(TAILLE_MAX_ICONE_PAGE)}`])).toBeNull();
	});
});
