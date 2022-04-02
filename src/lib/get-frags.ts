import { IMatch, IKill, IRoundKillPlayerSingle, IClutch, IMatchDataClutch } from "./types";

const fs = require("fs").promises;
const path = require("path");

async function getFrags(playerChosenSteamid = null) {
    const dir = __dirname + "../../../json";
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter(
        (file: any) => path.extname(file).toLowerCase() === ".json"
    );
    const matchesAnalyzed: IMatch[] = [];

    for (let i = 0; i < jsonFiles.length; i++) {
        const data = await fs.readFile(`${dir}/${jsonFiles[i]}`);
        const matchData = await JSON.parse(data);
        console.log("analyzing match: ", matchData.name);

        matchesAnalyzed.push({
            demoName: matchData.name.replace(".dem", ""),
            map: matchData.map_name.replace("de_", ""),
            rounds: [],
        });

        if (demoIsBroken(matchData)) {
            matchesAnalyzed[i].errorMessage = getErrorMessage(matchData);
            continue;
        }

        const allNotableClutchesInMatch: IClutch[] = matchData.players
            .map((player: any) => {
                return player.clutches
                    .filter(
                        (clutch: IMatchDataClutch) =>
                            clutch.has_won && clutch.opponent_count >= 3
                    )
                    ?.map((clutch: IMatchDataClutch) => {
                        return {
                            playerSteamid: player.steamid,
                            opponentCount: clutch.opponent_count,
                            roundNumber: clutch.round_number,
                        };
                    });
            })
            .filter((player: IClutch[]) => player.length)
            .flat();

        matchData.rounds.forEach((currentRound: any, roundIndex: number) => {
            matchesAnalyzed[i].rounds.push({
                roundNumber: currentRound.number,
                highlights: [],
            });

            let roundkillsPerPlayer: IRoundKillPlayerSingle[] = currentRound.kills.reduce(
                (acc: IRoundKillPlayerSingle[], kill: any) => {
                    const killMapped = {
                        tick: kill.tick,
                        time: kill.time_death_seconds,
                        weaponType: kill.weapon.type,
                        weaponName: kill.weapon.weapon_name,
                        isHeadshot: kill.is_headshot,
                        killedPlayerSteamId: kill.killed_steamid,
                    };

                    const player = acc.find(
                        (player) => player.steamid === kill.killer_steamid
                    );

                    if (player) {
                        player.allKillsThatRoundForPlayer.push(killMapped);
                    } else {
                        acc.push({
                            steamid: kill.killer_steamid,
                            killerName: kill.killer_name,
                            killerTeam: kill.killer_team,
                            allKillsThatRoundForPlayer: [killMapped],
                        });
                    }
                    return acc;
                },
                []
            );

            if (playerChosenSteamid) {
                roundkillsPerPlayer = roundkillsPerPlayer.filter(
                    (player) => player.steamid === playerChosenSteamid
                );
            }

            for (const player of roundkillsPerPlayer) {
                const { allKillsThatRoundForPlayer, steamid, killerTeam, killerName } = player;

                const clutch = allNotableClutchesInMatch.find(
                    (clutch) =>
                        clutch.roundNumber === currentRound.number &&
                        clutch.playerSteamid === steamid
                );

                const fragType: string = clutch
                    ? "clutch"
                    : getFragtype(allKillsThatRoundForPlayer);

                if (allKillsThatRoundForPlayer.length >= 3 || fragType.includes("deagle")) {
                    const fragCategory =
                        clutch || allKillsThatRoundForPlayer.length > 3
                            ? 1
                            : fragType.includes("deagle")
                            ? 2
                            : 3;

                    const team = killerTeam
                        ? killerTeam.includes("]")
                            ? killerTeam.split("]")[1].trim()
                            : killerTeam.trim()
                        : "not found";

                    const isAntieco = isHighlightAntieco(
                        allKillsThatRoundForPlayer,
                        matchData,
                        currentRound
                    );

                    matchesAnalyzed[i].rounds[roundIndex].highlights.push({
                        player: killerName,
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

function demoIsBroken(matchData: any): boolean {
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

function isHighlightAntieco(kills: IKill[], matchData: any, roundNr: number) {
    const killedSteamIds = kills.map((kill) => kill.killedPlayerSteamId);
    const enemyPlayers = matchData.players.filter((player: any) =>
        killedSteamIds.includes(player.steamid)
    );

    return (
        enemyPlayers.every((player: any) => player.equipement_value_rounds[roundNr] < 1000) &&
        ![1, 16].includes(roundNr)
    );
}

function getErrorMessage(matchData: any) {
    const len = matchData.rounds.length;
    const errorMessage = `Unable to extract highlights from this match. There ${
        len === 1 ? "is" : "are"
    } ${len === 0 ? "no" : "only"}${len ? " " + len : ""} round${
        len === 1 ? "" : "s"
    } in the JSON file. The demo is probably partially corrupted, but looking through it manually in-game might work.`;

    return errorMessage;
}

module.exports = {
    getFrags,
    demoIsBroken,
    getFragtype,
    hasDeagleHs,
    isAntieco: isHighlightAntieco,
};