/** Identité d'un modèle, pour l'afficher : `bge-m3` de `BAAI`, quantifié en `Q8_0`. */
export type IdentiteModele = { modele: string; editeur: string; quantification: string };

/**
 * Pièce figée : adresse et SHA-256 connus d'avance, vérifiés avant toute installation. `libelle` : pour les messages ; le
 * moteur porte sa `version` (`b11671`), un modèle son identité (`IdentiteModele`).
 */
export type Piece = {
	libelle: string;
	adresse: string;
	sha256: string;
	/** Archive à déplier (son premier niveau de dossier est retiré), ou `null` pour un fichier seul. */
	archive: 'tar.gz' | 'zip' | null;
	/** Chemin relatif, dans le dossier de la pièce, du fichier utile : `llama-server(.exe)`, `*.gguf`. */
	fichier: string;
} & ({ nom: 'moteur'; version: string } | ({ nom: 'sens' | 'reranker' } & IdentiteModele));

const VERSION_MOTEUR = 'b11671';
const LLAMA = `https://github.com/ggml-org/llama.cpp/releases/download/${VERSION_MOTEUR}`;
const LIBELLE_MOTEUR = `moteur llama.cpp ${VERSION_MOTEUR}`;

const MOTEURS: Record<string, Piece> = {
	'darwin-arm64': {
		nom: 'moteur',
		libelle: LIBELLE_MOTEUR,
		version: VERSION_MOTEUR,
		adresse: `${LLAMA}/llama-b11671-bin-macos-arm64.tar.gz`,
		sha256: '0f9c093f77b9c194f2f097df6204d9f5f8758968815e7db0374e98b0485ef9df',
		archive: 'tar.gz',
		fichier: 'llama-server',
	},
	'darwin-x64': {
		nom: 'moteur',
		libelle: LIBELLE_MOTEUR,
		version: VERSION_MOTEUR,
		adresse: `${LLAMA}/llama-b11671-bin-macos-x64.tar.gz`,
		sha256: 'd664a72c4c716e6fb0b90d4b2bf1c8dc2e6cff083cdbee26294fcc4f8d89366d',
		archive: 'tar.gz',
		fichier: 'llama-server',
	},
	'win32-x64': {
		nom: 'moteur',
		libelle: LIBELLE_MOTEUR,
		version: VERSION_MOTEUR,
		adresse: `${LLAMA}/llama-b11671-bin-win-cpu-x64.zip`,
		sha256: 'a9a407979a351add66016ffb558a53de8b6655fed1eec362591d66ea671fec81',
		archive: 'zip',
		fichier: 'llama-server.exe',
	},
	'win32-arm64': {
		nom: 'moteur',
		libelle: LIBELLE_MOTEUR,
		version: VERSION_MOTEUR,
		adresse: `${LLAMA}/llama-b11671-bin-win-cpu-arm64.zip`,
		sha256: '80bae6519b3f8bd1e637789cbd3f65ce2112e60b50fb7f934fa1ef34e31f1b54',
		archive: 'zip',
		fichier: 'llama-server.exe',
	},
	'linux-x64': {
		nom: 'moteur',
		libelle: LIBELLE_MOTEUR,
		version: VERSION_MOTEUR,
		adresse: `${LLAMA}/llama-b11671-bin-ubuntu-x64.tar.gz`,
		sha256: 'e4120fe6742ce204891496deb95fa49453bdb400ed85807474dbe470f98d45bd',
		archive: 'tar.gz',
		fichier: 'llama-server',
	},
};

const SENS: Piece = {
	nom: 'sens',
	libelle: 'sens bge-m3 Q8_0',
	modele: 'bge-m3',
	editeur: 'BAAI',
	quantification: 'Q8_0',
	adresse: 'https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/9eba04c5d75ba5a1595e45de734d36bef4e5cb98/bge-m3-q8_0.gguf',
	sha256: 'aa473d51f451a22f0fcf39ba3330c14bed38a385712b1113440f69df4047a173',
	archive: null,
	fichier: 'bge-m3-q8_0.gguf',
};

const RERANKER: Piece = {
	nom: 'reranker',
	libelle: 'reranker bge-reranker-v2-m3 Q8_0',
	modele: 'bge-reranker-v2-m3',
	editeur: 'BAAI',
	quantification: 'Q8_0',
	adresse: 'https://huggingface.co/gpustack/bge-reranker-v2-m3-GGUF/resolve/3093af03b1a635e67b084b1d8c03c5f5e020fd05/bge-reranker-v2-m3-Q8_0.gguf',
	sha256: 'a43c7c9b11a4c1517e5bf95151960e1621d1b72f7a493364b01e386cf1aaa1d3',
	archive: null,
	fichier: 'bge-reranker-v2-m3-Q8_0.gguf',
};

/** Pièces de cette plateforme ; `null` quand aucun moteur n'est figé pour elle (la recherche se fait alors par les mots). */
export function piecesPourPlateforme(plateforme: NodeJS.Platform, arch: string): Piece[] | null {
	const moteur = MOTEURS[`${plateforme}-${arch}`];
	if (moteur === undefined) return null;
	return [{ ...moteur }, { ...SENS }, { ...RERANKER }];
}
