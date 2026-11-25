/** Vue des modèles locaux pour les tests : installés (bge-m3, bge-reranker-v2-m3, llama.cpp b11671), complets, prêts. */
import type { EtatModelesVue } from '@mnemo/contrat';

export function vueModeles(e: Partial<EtatModelesVue> = {}): EtatModelesVue {
	return {
		installes: true,
		niveau: 'complets',
		gardien: 'pret',
		sens: 'pret',
		reranker: 'pret',
		pieces: {
			sens: { modele: 'bge-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 634_553_888, empreinte: 'aa473d51' },
			reranker: { modele: 'bge-reranker-v2-m3', editeur: 'BAAI', quantification: 'Q8_0', octets: 635_768_640, empreinte: 'a43c7c9b' },
			moteur: { version: 'b11671', plateforme: 'macOS arm64' },
		},
		activites: [],
		...e,
	};
}

/** Vue selon l'état du reranker, comme les anciens faux du service : `arrete` (gardien arrêté), `absent` (non installés). */
export function vueSelonReranker(reranker: EtatModelesVue['reranker']): EtatModelesVue {
	if (reranker === 'absent') return vueModeles({ installes: false, gardien: 'arrete', sens: 'absent', reranker: 'absent', pieces: { sens: null, reranker: null, moteur: null } });
	if (reranker === 'arrete') return vueModeles({ gardien: 'arrete', sens: 'arrete', reranker: 'arrete' });
	return vueModeles({ reranker });
}
