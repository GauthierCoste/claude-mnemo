/**
 * Lots d'informations de la démonstration (`?demo`), comme les proposerait l'archiviste : quatre doublons dans Module
 * stocks (trois lignes, dont une qui en absorbe deux), une suppression dans Dépôt SFTP, une confirmation dans Architecture,
 * et un lot périmé (l'information visée dans Export CSV a changé depuis la proposition).
 */
import type { InformationDuLotVue, LotVue } from '@mnemo/contrat';

const STOCKS = 'projets/erp-saas/Module stocks.md';

const info = (ancre: string, ...lignes: string[]): InformationDuLotVue => ({ ancre, lignes });

export function lotsDemo(maintenant: number): LotVue[] {
	return [
		{
			id: 'lot-demo-doublons',
			genre: 'fusionner',
			fiche: STOCKS,
			titre: 'Module stocks',
			motif: 'Quatre informations répètent une information déjà écrite, venue d’une autre source.',
			proposeMs: maintenant - 25 * 60_000,
			session: null,
			perime: false,
			lignes: [
				{
					indice: 0,
					ligne: { garder: 'f-0001', absorber: ['f-0006'] },
					avant: [
						info('f-0001', '- [decision] Les lots sont portés par une table stock_lot séparée. | declare | src: [[sources/cr-atelier-12-11]] | appris 2026-11-12 | valide [2026-11-12,) | confiance 90 % ^f-0001'),
						info('f-0006', '- [decision] Une table stock_lot distincte porte les lots. | observe | src: [[sources/cdc-stocks-v2]] p.4 | appris 2026-11-20 | confiance 80 % ^f-0006'),
					],
					apres: info(
						'f-0001',
						'- [decision] Les lots sont portés par une table stock_lot séparée. | declare | src: [[sources/cr-atelier-12-11]] | appris 2026-11-12 | valide [2026-11-12,) | confiance 90 % ^f-0001',
						'  + src: [[sources/cdc-stocks-v2]] p.4 | corroboré 2026-11-24',
					),
					motif: null,
					deja: false,
				},
				{
					indice: 1,
					ligne: { garder: 'f-0002', absorber: ['f-0007'] },
					avant: [
						info('f-0002', '- [delai] Livraison du module stocks au 15/12/2026. | observe | src: [[sources/cdc-stocks-v2]] p.12 | appris 2026-11-20 | valide [2026-11-20,) | confiance 80 % ^f-0002', '  > « La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »'),
						info('f-0007', '- [delai] Le module stocks est livré le 15 décembre 2026. | observe | src: [[sources/mails-refonte-stocks]] 2026-11-05 | appris 2026-11-22 | confiance 70 % ^f-0007'),
					],
					apres: info(
						'f-0002',
						'- [delai] Livraison du module stocks au 15/12/2026. | observe | src: [[sources/cdc-stocks-v2]] p.12 | appris 2026-11-20 | valide [2026-11-20,) | confiance 90 % ^f-0002',
						'  > « La livraison du module stocks est fixée au 15 décembre 2026, recette incluse. »',
						'  + src: [[sources/mails-refonte-stocks]] 2026-11-05 | corroboré 2026-11-24',
					),
					motif: null,
					deja: false,
				},
				{
					indice: 2,
					ligne: { garder: 'f-0005', absorber: ['f-0008', 'f-0009'] },
					avant: [
						info('f-0005', "- [regle] L'inventaire tournant est reporté à une phase ultérieure. | observe | src: [[sources/cr-atelier-12-11]] p.2 | appris 2026-11-12 | valide [2026-11-12,) | confiance 60 % ^f-0005"),
						info('f-0008', "- [planning] L'inventaire tournant attendra une prochaine phase. | infere | src: session 7f3a | appris 2026-11-21 | confiance 42 % ^f-0008"),
						info('f-0009', "- [planning] Pas d'inventaire tournant dans la première livraison. | observe | src: [[sources/mails-refonte-stocks]] 2026-11-05 | appris 2026-11-22 | confiance 70 % ^f-0009"),
					],
					apres: info(
						'f-0005',
						"- [regle] L'inventaire tournant est reporté à une phase ultérieure. | observe | src: [[sources/cr-atelier-12-11]] p.2 | appris 2026-11-12 | valide [2026-11-12,) | confiance 90 % ^f-0005",
						'  + src: session 7f3a | corroboré 2026-11-24',
						'  + src: [[sources/mails-refonte-stocks]] 2026-11-05 | corroboré 2026-11-24',
					),
					motif: null,
					deja: false,
				},
			],
		},
		{
			id: 'lot-demo-suppression',
			genre: 'supprimer',
			fiche: 'projets/api-facturation/Dépôt SFTP.md',
			titre: 'Dépôt SFTP',
			motif: 'Note de travail d’une session, sans valeur durable.',
			proposeMs: maintenant - 12 * 60_000,
			session: null,
			perime: false,
			lignes: [
				{
					indice: 0,
					ligne: { ancre: 'f-0002' },
					avant: [info('f-0002', '- [config] Relancer le test de connexion après la pause déjeuner. | infere | src: session a90b | appris 2026-11-22 | confiance 42 % ^f-0002')],
					apres: null,
					motif: null,
					deja: false,
				},
			],
		},
		{
			id: 'lot-demo-confirmations',
			genre: 'confirmer',
			fiche: 'projets/agent-maison/Architecture.md',
			titre: 'Architecture',
			motif: 'Découpage repris tel quel par les trois dernières sessions.',
			proposeMs: maintenant - 4 * 60_000,
			session: null,
			perime: false,
			lignes: [
				{
					indice: 0,
					ligne: { ancre: 'f-0001' },
					avant: [info('f-0001', '- [decision] Découpage en 4 modules : Accueil des demandes, Planification, Exécution, Journal. | infere | src: session c21e | appris 2026-11-21 | a confirmer ^f-0001')],
					apres: info('f-0001', '- [decision] Découpage en 4 modules : Accueil des demandes, Planification, Exécution, Journal. | infere | src: session c21e | appris 2026-11-21 ^f-0001'),
					motif: null,
					deja: false,
				},
			],
		},
		{
			id: 'lot-demo-perime',
			genre: 'confirmer',
			fiche: 'projets/erp-saas/Export CSV.md',
			titre: 'Export CSV',
			motif: 'Règle vérifiée par deux sessions.',
			proposeMs: maintenant - 90 * 60_000,
			session: null,
			perime: true,
			lignes: [
				{
					indice: 0,
					ligne: { ancre: 'f-0001' },
					avant: [info('f-0001', '- [regle] Les libellés sont échappés quand ils contiennent un point-virgule. | observe | src: session 41d7 | appris 2026-11-21 | valide [2026-11-21,) | a confirmer ^f-0001')],
					apres: info('f-0001', '- [regle] Les libellés sont échappés quand ils contiennent un point-virgule. | observe | src: session 41d7 | appris 2026-11-21 | valide [2026-11-21,) ^f-0001'),
					motif: null,
					deja: false,
				},
			],
		},
	];
}
