/**
 * Transformation PURE des lignes brutes de classement (issues de la requête
 * Drizzle avec jointures) en entrées propres et affichables.
 * Aucune dépendance à la DB → testable unitairement.
 */

/** Une ligne plate telle que renvoyée par le SELECT joint (users OU teams non-null). */
export type RankingRow = {
  elo: number;
  wins: number;
  losses: number;
  userId: string | null;
  teamId: string | null;
  userPseudo: string | null;
  userDisplayName: string | null;
  userAvatarUrl: string | null;
  teamName: string | null;
  teamLogoUrl: string | null;
};

export type Competitor =
  | {
      type: 'user';
      id: string;
      pseudo: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    }
  | { type: 'team'; id: string; name: string | null; logoUrl: string | null };

export type RankingEntry = {
  rank: number;
  elo: number;
  wins: number;
  losses: number;
  competitor: Competitor;
};

/**
 * Suppose `rows` déjà triées (par ELO décroissant) : le rang est simplement la
 * position dans le tableau (1-based).
 */
export function shapeRankings(rows: RankingRow[]): RankingEntry[] {
  return rows.map((row, index) => {
    let competitor: Competitor;
    if (row.userId) {
      competitor = {
        type: 'user',
        id: row.userId,
        pseudo: row.userPseudo,
        displayName: row.userDisplayName,
        avatarUrl: row.userAvatarUrl,
      };
    } else {
      // `row` est toujours OU users OU teams non-null (garantie du SELECT joint) :
      // si `userId` est absent, `teamId` l'est nécessairement.
      competitor = {
        type: 'team',
        id: row.teamId as string,
        name: row.teamName,
        logoUrl: row.teamLogoUrl,
      };
    }
    return { rank: index + 1, elo: row.elo, wins: row.wins, losses: row.losses, competitor };
  });
}
