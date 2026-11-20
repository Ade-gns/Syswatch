//! Petits utilitaires de lecture de /sys et /proc, tolérants aux erreurs.

use std::fs;
use std::path::Path;

/// Lit un fichier texte et retire les blancs ; `None` si absent ou illisible.
pub fn read_trim(p: impl AsRef<Path>) -> Option<String> {
    fs::read_to_string(p).ok().map(|s| s.trim().to_owned()).filter(|s| !s.is_empty())
}

/// Lit un entier décimal.
pub fn read_u64(p: impl AsRef<Path>) -> Option<u64> {
    read_trim(p)?.parse().ok()
}

/// Lit un entier signé (les capteurs hwmon peuvent être négatifs).
pub fn read_i64(p: impl AsRef<Path>) -> Option<i64> {
    read_trim(p)?.parse().ok()
}

/// Vrai si le fichier peut être ouvert en lecture par l'utilisateur courant.
pub fn readable(p: impl AsRef<Path>) -> bool {
    fs::File::open(p).is_ok()
}
