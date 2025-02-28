import path from "path";
import { promises as fs } from "fs";
import {
  IMatch,
  IKill,
  IRoundKillPlayer,
  IClutch,
  IMatchDataDTO,
  IPlayerDTO,
  IRoundDTO,
  OptionsGetFrags,
} from "../types";
import { LOG } from "./utils/logger";

export async function getFrags(options: OptionsGetFrags = {}): Promise<IMatch[]> {
  const dir = path.resolve(__dirname, options.jsonDir || "../../json");
  const files = await fs.readdir(dir);
  const jsonFiles = files.filter(
    (file: string) => path.extname(file).toLowerCase() === ".json"
  );
  const matchesAnalyzed: IMatch[] = [];

  for (let i = 0; i < jsonFiles.length; i++) {
    const data = await fs.readFile(`${dir}/${jsonFiles[i]}`, { encoding: "utf8" });
    const matchData: IMatchDataDTO = JSON.parse(data);
    LOG("analyzing match: ", matchData.name);

    matchesAnalyzed.push({
      demoName: matchData.name.replace(".dem", ""),
      map: matchData.map_name.replace("de_", ""),
      rounds: [],
    });

    if (demoIsBroken(matchData)) {
      matchesAnalyzed[i].errorMessage = getErrorMessage(matchData);
      continue;
    }

    const allNotableClutchesInMatch: IClutch[] = matchData.players.flatMap((player) => {
      return player.clutches
        .filter((clutch) => clutch.has_won && clutch.opponent_count >= 3)
        .map((clutch) => {
          return {
            playerSteamId: player.steamid,
            opponentCount: clutch.opponent_count,
            roundNumber: clutch.round_number,
          };
        });
    });

    matchData.rounds.forEach((currentRound: IRoundDTO, roundIndex: number) => {
      matchesAnalyzed[i].rounds.push({
        roundNumber: currentRound.number,
        highlights: [],
      });

      const roundkillsPerPlayer = currentRound.kills.reduce(
        (acc: IRoundKillPlayer[], kill) => {
          //Do not include teamkills.
          if (
            kill.killer_team === kill.killed_team ||
            (options.playerSteamId && options.playerSteamId !== kill.killer_steamid)
          ) {
            return acc;
          }

          const killMapped = {
            tick: kill.tick,
            time: kill.time_death_seconds,
            weaponType: kill.weapon.type,
            weaponName: kill.weapon.weapon_name,
            isHeadshot: kill.is_headshot,
            killedPlayerSteamId: kill.killed_steamid,
          };

          const player = acc.find((player) => player.steamid === kill.killer_steamid);

          if (player) {
            player.allKillsThatRoundForPlayer.push(killMapped);
          } else {
            acc.push({
              steamid: kill.killer_steamid,
              playerName: kill.killer_name,
              team: kill.killer_team,
              allKillsThatRoundForPlayer: [killMapped],
            });
          }
          return acc;
        },
        []
      );

      for (const player of roundkillsPerPlayer) {
        const { allKillsThatRoundForPlayer, steamid, team: playerTeam, playerName } = player;

        const clutch = allNotableClutchesInMatch.find(
          (clutch) =>
            clutch.roundNumber === currentRound.number && clutch.playerSteamId === steamid
        );

        const fragType = clutch ? "clutch" : getFragtype(allKillsThatRoundForPlayer);

        if (allKillsThatRoundForPlayer.length >= 3 || fragType.includes("deagle")) {
          const fragCategory =
            clutch || allKillsThatRoundForPlayer.length > 3
              ? 1
              : fragType.includes("deagle")
              ? 2
              : 3;

          const team = playerTeam
            ? playerTeam.includes("]")
              ? playerTeam.split("]")[1].trim()
              : playerTeam.trim()
            : "not found";

          const isAntieco = isHighlightAntieco(
            allKillsThatRoundForPlayer,
            matchData.players,
            currentRound.number
          );

          matchesAnalyzed[i].rounds[roundIndex].highlights.push({
            playerName,
            team,
            fragType,
            fragCategory,
            ...(clutch ? { clutchOpponents: clutch.opponentCount } : {}),
            isAntieco,
            allKillsThatRoundForPlayer,
          });
        }
      }
    });
  }
  return matchesAnalyzed;
}

function demoIsBroken(matchData: IMatchDataDTO): boolean {
  return matchData.rounds.length <= 15;
}

function getFragtype(kills: IKill[]): string {
  if (kills.length >= 3) {
    return `${kills.length}k`;
  }

  if (hasDeagleHs(kills)) {
    const deagleKills = kills.filter((kill) => kill.weaponName === "Desert Eagle");
    return `deagle${deagleKills.length}k`;
  }
  return `${kills.length}k`;
}

function hasDeagleHs(kills: IKill[]) {
  return kills.some((kill) => kill.weaponName === "Desert Eagle" && kill.isHeadshot);
}

function isHighlightAntieco(kills: IKill[], players: IPlayerDTO[], roundNumber: number) {
  const THRESHOLD = 2000;
  const killedSteamIds = kills.map((kill) => kill.killedPlayerSteamId);
  const enemyPlayers = players.filter((player) => killedSteamIds.includes(player.steamid));

  return (
    enemyPlayers.filter((player) => player.equipement_value_rounds[roundNumber] < THRESHOLD)
      .length > 3 && ![1, 16].includes(roundNumber)
  );
}

function getErrorMessage(matchData: IMatchDataDTO): string {
  const len = matchData.rounds.length;
  const errorMessage = `Unable to extract highlights from this match. There ${
    len === 1 ? "is" : "are"
  } ${len === 0 ? "no" : "only"}${len ? ` ${len}` : ""} round${
    len === 1 ? "" : "s"
  } in the JSON file. The demo is probably partially corrupted, but looking through it manually in-game might work.`;

  return errorMessage;
}
