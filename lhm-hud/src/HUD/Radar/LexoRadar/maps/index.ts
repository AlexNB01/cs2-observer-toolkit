import { Player } from "csgogsi";
import api, { apiUrl } from "../../../../API";
import { GameMapRadar } from "../../../../API/types";

export type ZoomAreas = {
    threshold: (players: Player[]) => boolean;
    origin: number[];
    zoom: number;
};

export interface ScaleConfig {
    origin: {
        x: number;
        y: number;
    };
    pxPerUX: number;
    pxPerUY: number;
    originHeight?: number;
}

type RadarFile = string;
interface SingleLayer {
    config: ScaleConfig;
    file: RadarFile;
    zooms?: ZoomAreas[];
}

interface DoubleLayer {
    configs: {
        id: string;
        config: ScaleConfig;
        isVisible: (height: number) => boolean;
    }[];
    file: RadarFile;
    zooms?: ZoomAreas[];
}

export type MapConfig = SingleLayer | DoubleLayer;

const maps: { [key: string]: MapConfig } = {};

api.maps
    .get()
    .then((newMaps) => {
        newMaps.forEach((map) => {
            const mainRadar: GameMapRadar | null =
                map.radars.find((radar) => radar.lhmId === "default") ||
                map.radars[0] ||
                null;
            const hasMultipleRadars = map.radars.length > 1;
            if (!mainRadar) return;

            if (!hasMultipleRadars) {
                maps[map.lhmId] = {
                    config: {
                        origin: {
                            x: mainRadar.originX || 0,
                            y: mainRadar.originY || 0,
                        },
                        pxPerUX: mainRadar.pxPerUX || 0,
                        pxPerUY: mainRadar.pxPerUY || 0,
                    },
                    file: `${apiUrl}api/game-maps/cs2/image/${map.lhmId}/radar`,
                };
            } else {
                maps[map.lhmId] = {
                    configs: map.radars.map((m: any) => ({
                        id: m.lhmId,
                        config: {
                            origin: {
                                x: m.originX || 0,
                                y: m.originY || 0,
                            },
                            pxPerUX: m.pxPerUX || 0,
                            pxPerUY: m.pxPerUY || 0,
                        },
                        isVisible: (height: number) =>
                            (m.visibleUnderHeight !== null
                                ? m.visibleUnderHeight < height
                                : true) &&
                            (m.visibleOverHeight !== null
                                ? m.visibleOverHeight > height
                                : true),
                    })),
                    file: `${apiUrl}api/game-maps/cs2/image/${map.lhmId}/radar`,
                };
            }

            if (map.lhmId === "de_vertigo") {
                maps[map.lhmId].zooms = [
                    {
                        threshold: (players: Player[]) => {
                            const alivePlayers = players.filter(
                                (player) => player.state.health
                            );
                            return (
                                alivePlayers.length > 0 &&
                                alivePlayers.every((player) => player.position[2] < 11700)
                            );
                        },
                        origin: [472, 1130],
                        zoom: 2,
                    },
                    {
                        threshold: (players: Player[]) => {
                            const alivePlayers = players.filter(
                                (player) => player.state.health
                            );
                            return (
                                alivePlayers.length > 0 &&
                                players
                                    .filter((player) => player.state.health)
                                    .every((player) => player.position[2] >= 11700)
                            );
                        },
                        origin: [528, 15],
                        zoom: 1.75,
                    },
                ];
            }
        });
    })
    .catch(() => { });

export default maps;
