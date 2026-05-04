import { useStore } from "@nanostores/react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
    endGameStop,
    isLoading,
    mbtaData,
    mbtaRoutes,
    mbtaStops,
    updateMbtaRouteData,
    updateMbtaStopData,
} from "@/lib/mbta/context";
import { mbtaClient } from "@/lib/mbta/mbta";
import { LIGHT_HEAVY_RAIL_TYPES } from "@/lib/mbta/constants";
import { decodePolyline } from "@/lib/mbta/utils";
import { Marker, Polyline, Popup, Tooltip, useMap } from "react-leaflet";
import type { Stop } from "@/lib/mbta/types";
import { Icon } from "leaflet";
import { Button } from "./ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogTitle,
    DialogTrigger,
} from "./ui/dialog";
import { adjustPerRadius } from "@/maps/questions/radius";
import {
    addQuestion,
    mapGeoJSON,
    questions,
    triggerLocalRefresh,
} from "@/lib/context";
import { Spinner } from "./ui/spinner";

const routeIdColorMap = {
    "Green-B": "green",
    "Green-C": "green",
    "Green-D": "green",
    "Green-E": "green",
    Blue: "blue",
    Orange: "orange",
    Red: "red",
    Mattapan: "red",
};

const STOP_ICON_URL =
    "https://upload.wikimedia.org/wikipedia/commons/6/64/MBTA.svg";

const ZoomAwareMarker = ({
    position,
    label,
    minZoom,
    color,
    children,
    ...props
}) => {
    const map = useMap();
    const [zoom, setZoom] = useState(map.getZoom());

    useEffect(() => {
        const handleZoom = () => {
            setZoom(map.getZoom());
        };

        map.on("zoomend", handleZoom);
        return () => {
            map.off("zoomend", handleZoom);
        };
    }, [map]);

    return (
        <Marker position={position} {...props}>
            {zoom >= minZoom && (
                <Tooltip
                    permanent
                    direction="top"
                    className="font-semibold"
                    offset={[0, -5]}
                >
                    {label}
                </Tooltip>
            )}
            {children}
        </Marker>
    );
};

export const MBTAOverlay = () => {
    useStore(triggerLocalRefresh);
    const $isLoading = useStore(isLoading);
    const $mbtaData = useStore(mbtaData);
    const $mbtaStops = useStore(mbtaStops);
    const $questions = useStore(questions);
    const $endGameStop = useStore(endGameStop);
    const [activeStop, setActiveStop] = useState<Stop | null>(null);
    const [isEndGameCircleLoading, setEndGameCircleLoading] = useState(false);
    const [endGameConfirmOpen, setEndGameConfirmOpen] = useState(false);

    const allStopsNoDuplicates = useMemo(() => {
        const allStops: any = [];
        const stopNames = new Set();
        const stops = mbtaStops.get();

        Object.entries(stops).forEach(([routeId, stops]) => {
            for (const stop of stops) {
                if (stop.name in stopNames) {
                    continue;
                }
                stopNames.add(stop.name);
                allStops.push({
                    route: routeId,
                    ...stop,
                });
            }
        });

        return allStops;
    }, [$mbtaStops]);

    const fetchPolyline = async (routeId: string) => {
        const currentData = mbtaData.get();

        if (!currentData[routeId]) {
            const response: any = await mbtaClient.fetchShapes({
                route: routeId,
            });
            const filteredData = response.data.filter(
                (item: any) =>
                    !item.id.includes("canonical") && !/[a-zA-Z]/.test(item.id),
            );
            const decodedShapeData = filteredData.map((shape: any) =>
                decodePolyline(shape.attributes.polyline),
            );
            updateMbtaRouteData(routeId, decodedShapeData);
        }
    };

    const fetchStops = async (routeId: string) => {
        const currentStops = mbtaStops.get();

        if (!currentStops || !currentStops.length) {
            const response: any = await mbtaClient.fetchStops({
                route: routeId,
            });
            const stopsData: Stop[] = response.data.map((s: any) => ({
                name: s.attributes.name,
                lat: s.attributes.latitude,
                lng: s.attributes.longitude,
                description: s.attributes.address,
            }));
            updateMbtaStopData(routeId, stopsData);
        }
    };

    const fetchRoutesAndPolylines = async () => {
        const currentRoutes = mbtaRoutes.get();

        if (!currentRoutes || !currentRoutes.length) {
            const routes: any = await mbtaClient.fetchRoutes({
                type: LIGHT_HEAVY_RAIL_TYPES,
            });
            mbtaRoutes.set(routes.data);
            await Promise.all(
                routes.data.map((route: any) =>
                    Promise.all([
                        fetchPolyline(route.id),
                        fetchStops(route.id),
                    ]),
                ),
            );
        }
    };

    const handleEndGameActivate = useCallback(
        async (stop: Stop) => {
            if (endGameStop.get()?.name === stop.name) {
                setEndGameConfirmOpen(false);
                return;
            }

            try {
                setEndGameCircleLoading(true);
                endGameStop.set(stop);
                addQuestion({
                    id: "radius",
                    data: {
                        within: true,
                        lat: stop.lat,
                        lng: stop.lng,
                        radius: 0.25,
                        unit: "miles",
                    },
                });
                setEndGameConfirmOpen(false);
            } catch (err) {
            } finally {
                setEndGameCircleLoading(false);
            }
        },
        [$endGameStop],
    );

    const handleEndGameDeactivate = useCallback(
        async (stop: Stop) => {
            try {
                setEndGameCircleLoading(true);
                endGameStop.set(null);
                questions.set(
                    $questions.filter(
                        (q) =>
                            q.data.lat !== stop.lat && q.data.lng !== stop.lng,
                    ),
                );
                setEndGameConfirmOpen(false);
            } catch (err) {
            } finally {
                setEndGameCircleLoading(false);
            }
        },
        [$endGameStop],
    );

    useEffect(() => {
        (async () => {
            try {
                isLoading.set(true);
                fetchRoutesAndPolylines();
            } catch (err) {
            } finally {
                isLoading.set(false);
            }
        })();
    }, []);

    if ($isLoading) {
        return null;
    }

    return (
        <>
            {Object.entries($mbtaData).map(([routeId, positions]) => {
                return (
                    <Polyline
                        key={`${routeId}-${positions}`}
                        positions={positions}
                        stroke
                        pathOptions={{ color: routeIdColorMap[routeId] }}
                        fill={false}
                    />
                );
            })}
            {allStopsNoDuplicates.map((stop: any) => {
                const routeId = stop.route;
                const color = routeIdColorMap[routeId];
                return (
                    <ZoomAwareMarker
                        key={`${routeId}-${stop.name}`}
                        position={[stop.lat, stop.lng]}
                        label={stop.name}
                        color={color}
                        minZoom={15}
                        icon={
                            new Icon({
                                iconUrl: STOP_ICON_URL,
                                iconSize: [15, 25],
                            })
                        }
                    >
                        <Popup>
                            <h3 className="text-center font-semibold">
                                {stop.name}
                            </h3>
                            <Dialog
                                open={endGameConfirmOpen}
                                onOpenChange={(open) => {
                                    setActiveStop(stop);
                                    setEndGameConfirmOpen(open);
                                }}
                                key={`${routeId}-${stop.name}`}
                            >
                                {endGameStop.get()?.name === stop.name ? (
                                    <Button
                                        variant="secondary"
                                        className="mt-2"
                                        onClick={() => {
                                            if (activeStop)
                                                handleEndGameDeactivate(
                                                    activeStop,
                                                );
                                        }}
                                    >
                                        Remove Endgame
                                    </Button>
                                ) : (
                                    <DialogTrigger>
                                        <Button
                                            variant="secondary"
                                            className="mt-2"
                                        >
                                            Trigger Endgame
                                        </Button>
                                    </DialogTrigger>
                                )}
                                <DialogContent>
                                    <DialogTitle>Are you sure?</DialogTitle>
                                    <DialogDescription>
                                        This will mark{" "}
                                        <strong>{activeStop?.name}</strong> as
                                        the station the hiders are at and will
                                        display a 1/4 mile radius around the
                                        station.
                                    </DialogDescription>
                                    <DialogFooter className="flex flex-row gap-3">
                                        <Button
                                            className="w-full"
                                            onClick={() =>
                                                setEndGameConfirmOpen(false)
                                            }
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            className="w-full"
                                            variant="destructive"
                                            onClick={() => {
                                                if (activeStop)
                                                    handleEndGameActivate(
                                                        activeStop,
                                                    );
                                            }}
                                        >
                                            {isEndGameCircleLoading && (
                                                <Spinner />
                                            )}
                                            Confirm
                                        </Button>
                                    </DialogFooter>
                                </DialogContent>
                            </Dialog>
                        </Popup>
                    </ZoomAwareMarker>
                );
            })}
        </>
    );
};
