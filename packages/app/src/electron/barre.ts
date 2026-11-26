/**
 * Icône de la barre des menus (`Tray`) : l'image « template » de l'état agrégé (animée s'il en a deux), l'infobulle, et
 * le menu traduit tel quel du modèle du domaine. Aucune décision ici.
 */
import { Menu, type MenuItemConstructorOptions, nativeImage, type NativeImage, Tray } from 'electron';
import type { EtatAgrege } from '../domaine/etat.ts';
import { IMAGES_ICONE, imageIcone, INTERVALLE_ANIMATION_MS } from '../domaine/icone.ts';
import type { ActionMenu, ElementMenu } from '../domaine/menu.ts';
import type { OctetsImage } from '../infra/images-barre.ts';

export type Barre = {
	afficher(etat: EtatAgrege, infobulle: string, menu: readonly ElementMenu[]): void;
	detruire(): void;
};

/** Image template aux deux échelles (16 et 32 px). */
export function imageTemplate(octets: OctetsImage): NativeImage {
	const image = nativeImage.createEmpty();
	image.addRepresentation({ scaleFactor: 1, buffer: octets.x1 });
	image.addRepresentation({ scaleFactor: 2, buffer: octets.x2 });
	image.setTemplateImage(true);
	return image;
}

function traduire(elements: readonly ElementMenu[], surAction: (a: ActionMenu) => void): MenuItemConstructorOptions[] {
	return elements.map((e): MenuItemConstructorOptions => {
		switch (e.type) {
			case 'action':
				return { label: e.libelle, ...(e.detail === null ? {} : { sublabel: e.detail }), enabled: e.actif, click: () => surAction(e.action) };
			case 'case':
				return { label: e.libelle, type: 'checkbox', checked: e.coche, click: () => surAction(e.action) };
			case 'texte':
				return { label: e.libelle, enabled: false };
			case 'separateur':
				return { type: 'separator' };
		}
	});
}

export function creerBarre(o: { images: ReadonlyMap<string, OctetsImage>; surAction: (a: ActionMenu) => void }): Barre {
	const cache = new Map<string, NativeImage>();
	const image = (nom: string): NativeImage => {
		let i = cache.get(nom);
		if (i === undefined) {
			const octets = o.images.get(nom);
			if (octets === undefined) throw new Error(`Image de la barre des menus absente : ${nom}`);
			i = imageTemplate(octets);
			cache.set(nom, i);
		}
		return i;
	};
	const tray = new Tray(image(imageIcone('arrete', 0)));
	let etatCourant: EtatAgrege | null = null;
	let infobulleCourante: string | null = null;
	let menuCourant: string | null = null;
	let animation: ReturnType<typeof setInterval> | null = null;

	function animer(etat: EtatAgrege): void {
		if (etat === etatCourant) return;
		etatCourant = etat;
		if (animation !== null) clearInterval(animation);
		animation = null;
		let pas = 0;
		tray.setImage(image(imageIcone(etat, pas)));
		if (IMAGES_ICONE[etat].length > 1) {
			animation = setInterval(() => {
				pas++;
				tray.setImage(image(imageIcone(etat, pas)));
			}, INTERVALLE_ANIMATION_MS);
		}
	}

	return {
		afficher(etat, infobulle, menu) {
			animer(etat);
			if (infobulle !== infobulleCourante) tray.setToolTip(infobulle);
			infobulleCourante = infobulle;
			// le menu n'est reconstruit que s'il change : un menu ouvert ne se referme pas à chaque message du service
			const modele = JSON.stringify(menu);
			if (modele !== menuCourant) tray.setContextMenu(Menu.buildFromTemplate(traduire(menu, o.surAction)));
			menuCourant = modele;
		},
		detruire() {
			if (animation !== null) clearInterval(animation);
			animation = null;
			tray.destroy();
		},
	};
}
