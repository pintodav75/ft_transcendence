import { useCallback, useState } from 'react';

/**
 * Texte d'une région live `role="status"`, et la fonction qui l'y pose.
 *
 * Deux pièges de région live, tous deux rencontrés pour de vrai, sont traités ici pour que
 * les appelants n'aient pas à y penser :
 *
 * ① **Un texte identique n'est pas ré-annoncé.** Le lecteur d'écran ne lit que ce qui
 *    CHANGE : exclure @x, le réinviter, puis le ré-exclure serait silencieux la seconde
 *    fois. On vide donc la région avant de la remplir, sur la frame suivante.
 * ② **Une région ne doit pas garder un message périmé.** `reset()` existe pour ça : une
 *    action qui rend l'annonce précédente FAUSSE (ouvrir un créneau après en avoir annulé
 *    un) doit l'effacer, sinon la région contredit ce que l'écran affiche.
 *
 * ⚠️ Ce que ce hook NE fait PAS : monter la région. Elle doit vivre dans le DOM **avant**
 * son texte — une région insérée en même temps que son contenu n'est pas annoncée de façon
 * fiable, le lecteur d'écran doit déjà la surveiller quand elle se remplit.
 */
export function useAnnouncement() {
  const [message, setMessage] = useState('');

  const announce = useCallback((text: string) => {
    setMessage('');
    // Frame suivante : dans le même rendu, React verrait une valeur identique à la
    // précédente et le DOM ne changerait pas — donc rien ne serait annoncé (piège ①).
    requestAnimationFrame(() => setMessage(text));
  }, []);

  const reset = useCallback(() => setMessage(''), []);

  return { message, announce, reset };
}
