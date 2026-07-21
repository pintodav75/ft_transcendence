import lolLogo from '@/assets/logos/lol.png';
import cs2Logo from '@/assets/logos/cs2.png';
import valLogo from '@/assets/logos/val.png';
import rlLogo from '@/assets/logos/rl.png';
import chessLogo from '@/assets/logos/chess.png';

import lolIcon from '@/assets/icons/lol.png';
import cs2Icon from '@/assets/icons/cs2.png';
import valIcon from '@/assets/icons/val.png';
import rlIcon from '@/assets/icons/rl.png';
import chessIcon from '@/assets/icons/chess.png';

import lolImage from '@/assets/images/lol.webp';
import cs2Image from '@/assets/images/cs2.webp';
import valImage from '@/assets/images/val.webp';
import rlImage from '@/assets/images/rl.webp';
import chessImage from '@/assets/images/chess.webp';

export const gameOrder = ['lol', 'cs2', 'val', 'rl', 'chess'];

// Destination cliquée de chaque carte-jeu (landing). URLs à préciser plus tard :
// tant que l'entrée d'un jeu est absente, sa carte ne navigue nulle part.
// ex. lol: '/games/lol'
export const gameHref: Record<string, string> = {};

export const gameLogos: Record<string, string> = {
  lol: lolLogo,
  cs2: cs2Logo,
  val: valLogo,
  rl: rlLogo,
  chess: chessLogo,
};

export const gameIcons: Record<string, string> = {
  lol: lolIcon,
  cs2: cs2Icon,
  val: valIcon,
  rl: rlIcon,
  chess: chessIcon,
};

export const gameImages: Record<string, string> = {
  lol: lolImage,
  cs2: cs2Image,
  val: valImage,
  rl: rlImage,
  chess: chessImage,
};
