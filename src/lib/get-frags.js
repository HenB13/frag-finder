const fs = require("fs").promises;
const path = require("path");

async function getFrags(pathToJsonFiles, playerChosen = false) {
    const demosHighlights = [];
    const files = await fs.readdir(pathToJsonFiles);
    const demoFiles = files.filter((file) => path.extname(file).toLowerCase() === ".json");

    for (let i = 0; i < demoFiles.length; i++) {
        const data = await fs.readFile(`${pathToJsonFiles}/${demoFiles[i]}`);
        const matchData = await JSON.parse(data);
        console.log("analyzing", matchData.name);

        demosHighlights.push({
            demoName: matchData.name.replace(".dem", ""),
            map: matchData.map_name.replace("de_", ""),
            roundsWithHighlights: [],
        });

        if (demoIsBroken(matchData)) {
            const len = matchData.rounds.length;
            const breakMsg = `Unable to extract highlights from this demo. There ${
                len === 1 ? "is" : "are"
            } ${len === 0 ? "no" : "only"}${len ? " " + len : ""} round${
                len === 1 ? "" : "s"
            } in the JSON file. The demo is probably partially corrupted, but looking through it manually in-game might work. You could also try to analyze it again in CS:GO Demos Manager, export a new JSON file, and try again.`;

            demosHighlights[i].breakMsg = breakMsg;
            continue;
        }

        const allNotableClutchesInMatch = matchData.players
            .map((player) => {
                return player.clutches
                    .filter((clutch) => clutch.has_won && clutch.opponent_count >= 3)
                    ?.map((clutch) => {
                        return {
                            player: player.name,
                            opponentCount: clutch.opponent_count,
                            roundNumber: clutch.round_number,
                        };
                    });
            })
            .filter((player) => player.length)
            .flat();

        matchData.rounds.forEach((currentRound, roundIndex) => {
            demosHighlights[i].roundsWithHighlights.push({
                roundNumber: currentRound.number,
                frags: [],
            });

            let roundkillsPerPlayer = currentRound.kills.reduce((acc, kill) => {
                if (acc[kill.killer_name]) {
                    acc[kill.killer_name].kills.push(kill);
                } else {
                    acc[kill.killer_name] = {
                        kills: [kill],
                        steamId: kill.killer_steamid,
                    };
                }
                return acc;
            }, {});

            if (playerChosen) {
                // Filter out all players except chosen user
                roundkillsPerPlayer = Object.fromEntries(
                    Object.entries(roundkillsPerPlayer).filter(
                        // eslint-disable-next-line no-unused-vars
                        ([_, val]) => val.steamId === playerChosen
                    )
                );
            }

            for (const player in roundkillsPerPlayer) {
                const { kills, steamId } = roundkillsPerPlayer[player];
                const tickFirstKill = kills[0].tick - 200;
                const clutch = allNotableClutchesInMatch.find(
                    ({ roundNumber, player }) =>
                        roundNumber === currentRound.number && player === player
                );

                const fragType = getFragtype(kills, clutch);

                if (kills.length >= 3 || fragType.includes("deagle")) {
                    const fragCategory =
                        clutch || kills.length > 3 ? 1 : fragType.includes("deagle") ? 2 : 3;

                    const team = kills[0].killer_team
                        ? kills[0].killer_team.includes("]")
                            ? kills[0].killer_team.split("]")[1].trim()
                            : kills[0].killer_team.trim()
                        : "not found";

                    demosHighlights[i].roundsWithHighlights[roundIndex].frags.push({
                        player,
                        steamId,
                        team,
                        fragType,
                        fragCategory,
                        ...(clutch ? { clutchOpponents: clutch.opponentCount } : {}),
                        antieco: isAntieco(kills, matchData, currentRound),
                        killAmount: kills.length,
                        tick: tickFirstKill,
                        individualKills: kills.map(({ time_death_seconds, weapon }) => ({
                            timestamp: time_death_seconds,
                            weapon: weapon.weapon_name,
                            weaponType: weapon.type,
                        })),
                    });
                }
            }
        });
    }
    return demosHighlights;
}

function demoIsBroken(matchData) {
    return matchData.rounds.length <= 15;
}

function getFragtype(kills, clutch) {
    if (kills.length >= 3) {
        return clutch ? "clutch" : `${kills.length}k`;
    }
    if (hasDeagleHs(kills)) {
        const deagleKills = kills.filter((kill) => kill.weapon.weapon_name === "Desert Eagle");

        return `deagle${deagleKills.length}k`;
    }
    return `${kills.length}k`;
}

function hasDeagleHs(kills) {
    return kills.some(
        (kill) => kill.weapon.weapon_name === "Desert Eagle" && kill.is_headshot
    );
}

function isAntieco(playerKills, matchData, roundNr) {
    const killedSteamIds = playerKills.map((kill) => kill.killed_steamid);
    const enemyPlayers = matchData.players.filter((player) =>
        killedSteamIds.includes(player.steamid)
    );

    return (
        enemyPlayers.every((player) => player.equipement_value_rounds[roundNr] < 1000) &&
        ![1, 16].includes(roundNr)
    );
}

module.exports = {
    getFrags,
    demoIsBroken,
    getFragtype,
    hasDeagleHs,
    isAntieco,
};