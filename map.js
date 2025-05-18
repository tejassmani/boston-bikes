import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7.9.0/+esm";
import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";

console.log("Mapbox GL JS Loaded:", mapboxgl);

// Set Mapbox access token
mapboxgl.accessToken =
  "pk.eyJ1IjoidGVqYXNtYW5pIiwiYSI6ImNtYXJlcDdrNTBhdXgyanE3YzZza210MDQifQ.bGe6buB18nq73E6GRNOGgA";

// Initialize the Mapbox map
const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027],
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// Select the SVG element inside the map container and style it
const svg = d3
  .select("#map")
  .append("svg")
  .style("position", "absolute")
  .style("top", 0)
  .style("left", 0)
  .style("width", "100%")
  .style("height", "100%")
  .style("pointer-events", "none"); // allow map interactions underneath

// Helper function to convert lat/lon to pixel coords
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

// Once the map loads...
map.on("load", async () => {
  // Add Boston bike lanes
  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  // Add Cambridge bike lanes
  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  const bikeLaneStyle = {
    "line-color": "#32D400",
    "line-width": 5,
    "line-opacity": 0.6,
  };

  map.addLayer({
    id: "bike-lanes-boston",
    type: "line",
    source: "boston_route",
    paint: bikeLaneStyle,
  });

  map.addLayer({
    id: "bike-lanes-cambridge",
    type: "line",
    source: "cambridge_route",
    paint: bikeLaneStyle,
  });

  try {
    // Load Bluebikes station data
    const jsonurl =
      "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
    const jsonData = await d3.json(jsonurl);
    let stations = jsonData.data.stations;

    // Load Bluebikes trip data
    const tripUrl =
      "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
    let trips = await d3.csv(
      "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv",
      (trip) => {
        trip.started_at = new Date(trip.started_at);
        trip.ended_at = new Date(trip.ended_at);
        return trip;
      },
    );

    // Compute departures and arrivals
    const departures = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.start_station_id,
    );

    const arrivals = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.end_station_id,
    );

    // Enrich stations with traffic data
    stations = stations.map((station) => {
      let id = station.short_name;
      station.arrivals = arrivals.get(id) ?? 0;
      station.departures = departures.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });

    console.log("Stations with traffic:", stations);

    // Create radius scale
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (d) => d.totalTraffic)])
      .range([0, 25]);

    // Draw circles
    const circles = svg
      .selectAll("circle")
      .data(stations)
      .enter()
      .append("circle")
      .attr("r", (d) => radiusScale(d.totalTraffic))
      .attr("fill", "steelblue")
      .attr("stroke", "white")
      .attr("stroke-width", 1)
      .attr("opacity", 0.8)
      .style("pointer-events", "auto");

    // Add tooltips
    // Create a tooltip div
    const tooltip = d3.select("body").append("div").attr("class", "tooltip");

    // Add mouse events for tooltip
    circles
      .on("mouseenter", function (event, d) {
        tooltip
          .style("display", "block")
          .html(
            `<strong>${d.name}</strong><br>${d.totalTraffic} trips<br>(${d.departures} departures, ${d.arrivals} arrivals)`,
          );
        d3.select(this).attr("stroke", "black").attr("stroke-width", 2);
      })
      .on("mousemove", function (event) {
        tooltip
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY + 10 + "px");
      })
      .on("mouseleave", function () {
        tooltip.style("display", "none");
        d3.select(this).attr("stroke", "white").attr("stroke-width", 1);
      });

    // Update circle positions on map movement
    function updatePositions() {
      circles
        .attr("cx", (d) => getCoords(d).cx)
        .attr("cy", (d) => getCoords(d).cy);
    }

    // Initial position update
    updatePositions();

    // Recalculate positions on interaction
    map.on("move", updatePositions);
    map.on("zoom", updatePositions);
    map.on("resize", updatePositions);
  } catch (error) {
    console.error("Error loading data:", error);
  }
  const tooltip = d3.select("#tooltip");

  // Global time filter value
  let timeFilter = -1;

  // Format minutes since midnight to HH:MM AM/PM
  function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString("en-US", { timeStyle: "short" });
  }

  // Minutes since midnight for a given Date object
  function minutesSinceMidnight(date) {
    return date.getHours() * 60 + date.getMinutes();
  }

  // Filter trips within ±60 minutes of timeFilter
  function filterTripsByTime(trips, timeFilter) {
    return timeFilter === -1
      ? trips
      : trips.filter((trip) => {
          const start = minutesSinceMidnight(trip.started_at);
          const end = minutesSinceMidnight(trip.ended_at);
          return (
            Math.abs(start - timeFilter) <= 60 ||
            Math.abs(end - timeFilter) <= 60
          );
        });
  }

  // Compute arrivals, departures, and total traffic
  function computeStationTraffic(stations, trips) {
    const departures = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.start_station_id,
    );

    const arrivals = d3.rollup(
      trips,
      (v) => v.length,
      (d) => d.end_station_id,
    );

    return stations.map((station) => {
      const id = station.short_name;
      station.departures = departures.get(id) ?? 0;
      station.arrivals = arrivals.get(id) ?? 0;
      station.totalTraffic = station.arrivals + station.departures;
      return station;
    });
  }
});
