/* global google */
(function () {
    "use strict";

    var state = {
        pickup: null,
        dropoff: null
    };
    var uiBound = false;

    var services = {
        geocoder: null,
        directions: null
    };

    var NYC_COUNTIES = {
        "Bronx": true,
        "Kings": true,
        "New York": true,
        "Queens": true,
        "Richmond": true
    };

    var MTA_SURCHARGE_COUNTIES = {
        "Bronx": true,
        "Kings": true,
        "New York": true,
        "Queens": true,
        "Richmond": true,
        "Nassau": true,
        "Suffolk": true,
        "Westchester": true,
        "Rockland": true,
        "Dutchess": true,
        "Orange": true,
        "Putnam": true
    };

    var AIRPORTS = {
        JFK: { lat: 40.6413, lng: -73.7781, radiusMiles: 1.8 },
        LGA: { lat: 40.7769, lng: -73.8740, radiusMiles: 1.5 },
        EWR: { lat: 40.6895, lng: -74.1745, radiusMiles: 1.8 }
    };

    function byId(id) {
        return document.getElementById(id);
    }

    function money(n) {
        return "$" + (Math.round(n * 100) / 100).toFixed(2);
    }

    function setStatus(el, msg, type) {
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("text-muted", "text-success", "text-danger");
        el.classList.add(type || "text-muted");
    }

    function setEstimateStatus(msg, type) {
        setStatus(byId("estimate-status"), msg, type);
    }

    function resetFareDisplay() {
        byId("fare-total").textContent = "$--.--";
        byId("fare-range").textContent = "Range: $-- to $--";
        byId("fare-base").textContent = "$--.--";
        byId("fare-distance").textContent = "$--.--";
        byId("fare-time").textContent = "$--.--";
        byId("fare-surcharges").textContent = "$--.--";
        byId("fare-message").textContent = "Enter trip details and click Estimate Fare.";
        byId("fare-rate-message").textContent = "Rate message: Rate #01 - Standard City Rate.";
    }

    function applyFareDisplay(result) {
        byId("fare-total").textContent = money(result.total);
        byId("fare-range").textContent = "Range: " + money(result.rangeLow) + " to " + money(result.rangeHigh);
        byId("fare-base").textContent = money(result.baseCharge);
        byId("fare-distance").textContent = money(result.distanceCharge);
        byId("fare-time").textContent = money(result.timeCharge);
        byId("fare-surcharges").textContent = money(result.surchargeTotal);
        byId("fare-message").textContent = result.message;
        byId("fare-rate-message").textContent = "Rate message: " + result.rateMessage;
    }

    function toLocalDatetimeValue(date) {
        var pad = function (n) {
            return n < 10 ? "0" + String(n) : String(n);
        };
        return date.getFullYear() +
            "-" + pad(date.getMonth() + 1) +
            "-" + pad(date.getDate()) +
            "T" + pad(date.getHours()) +
            ":" + pad(date.getMinutes());
    }

    function getPickupTime() {
        var input = byId("pickup-time");
        if (!input || !input.value) {
            return new Date();
        }
        var parsed = new Date(input.value);
        if (Number.isNaN(parsed.getTime())) {
            return new Date();
        }
        return parsed;
    }

    function bindAutocomplete(inputId, statusId, stateKey) {
        var input = byId(inputId);
        var status = byId(statusId);
        if (!input || !status) return;

        var ac = new google.maps.places.Autocomplete(input, {
            fields: ["formatted_address", "geometry", "name", "place_id"],
            componentRestrictions: { country: "us" }
        });

        ac.addListener("place_changed", function () {
            var place = ac.getPlace();
            if (!place || !place.geometry || !place.geometry.location) {
                state[stateKey] = null;
                setStatus(status, "Pick an address from suggestions.", "text-danger");
                return;
            }

            state[stateKey] = {
                placeId: place.place_id || "",
                name: place.name || "",
                address: place.formatted_address || input.value,
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng()
            };
            setStatus(status, "Selected: " + state[stateKey].address, "text-success");
            setEstimateStatus("Ready to estimate.", "text-success");
        });

        input.addEventListener("input", function () {
            state[stateKey] = null;
            setStatus(status, "Start typing to see suggestions.", "text-muted");
            setEstimateStatus("Select valid pickup and dropoff places.", "text-muted");
        });
    }

    function metersToMiles(meters) {
        return meters / 1609.344;
    }

    function haversineMiles(a, b) {
        var toRad = function (deg) { return deg * Math.PI / 180; };
        var dLat = toRad(b.lat - a.lat);
        var dLng = toRad(b.lng - a.lng);
        var lat1 = toRad(a.lat);
        var lat2 = toRad(b.lat);
        var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
        var c = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
        return 3958.8 * c;
    }

    function isOvernight(d) {
        var h = d.getHours();
        return h >= 20 || h < 6;
    }

    function nthWeekdayOfMonth(year, monthIndex, weekday, nth) {
        var d = new Date(year, monthIndex, 1);
        var shift = (7 + weekday - d.getDay()) % 7;
        return new Date(year, monthIndex, 1 + shift + (nth - 1) * 7);
    }

    function lastWeekdayOfMonth(year, monthIndex, weekday) {
        var d = new Date(year, monthIndex + 1, 0);
        var shift = (7 + d.getDay() - weekday) % 7;
        return new Date(year, monthIndex, d.getDate() - shift);
    }

    function dateKey(d) {
        return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate();
    }

    function isLikelyLegalHoliday(d) {
        var y = d.getFullYear();
        var holidays = {};
        holidays[dateKey(new Date(y, 0, 1))] = true;
        holidays[dateKey(lastWeekdayOfMonth(y, 4, 1))] = true;
        holidays[dateKey(new Date(y, 6, 4))] = true;
        holidays[dateKey(nthWeekdayOfMonth(y, 8, 1, 1))] = true;
        holidays[dateKey(nthWeekdayOfMonth(y, 10, 4, 4))] = true;
        holidays[dateKey(new Date(y, 11, 25))] = true;
        return !!holidays[dateKey(d)];
    }

    function isRushHour(d) {
        var day = d.getDay();
        var hour = d.getHours();
        return day >= 1 && day <= 5 && hour >= 16 && hour < 20 && !isLikelyLegalHoliday(d);
    }

    function geocodeLatLng(lat, lng) {
        return new Promise(function (resolve, reject) {
            services.geocoder.geocode({ location: { lat: lat, lng: lng } }, function (results, status) {
                if (status !== "OK" || !results || !results.length) {
                    reject(new Error("geocode failed"));
                    return;
                }
                resolve(results[0]);
            });
        });
    }

    function routeTrip(origin, destination, when) {
        return new Promise(function (resolve, reject) {
            if (!services.directions) {
                reject(new Error("Directions service unavailable"));
                return;
            }
            services.directions.route({
                origin: { placeId: origin.placeId },
                destination: { placeId: destination.placeId },
                travelMode: google.maps.TravelMode.DRIVING,
                drivingOptions: {
                    departureTime: when,
                    trafficModel: google.maps.TrafficModel.BEST_GUESS
                }
            }, function (response, status) {
                if (status !== "OK" || !response || !response.routes || !response.routes.length) {
                    reject(new Error("directions failed"));
                    return;
                }
                resolve(response.routes[0]);
            });
        });
    }

    function getAddressPart(result, type) {
        var i;
        if (!result || !result.address_components) return "";
        for (i = 0; i < result.address_components.length; i += 1) {
            if (result.address_components[i].types.indexOf(type) !== -1) {
                return result.address_components[i].long_name || "";
            }
        }
        return "";
    }

    function normalizeCounty(countyName) {
        return (countyName || "").replace(/ County$/i, "").trim();
    }

    function isNycCounty(county) {
        return !!NYC_COUNTIES[county];
    }

    function inApproxManhattan(lat, lng) {
        return lat >= 40.68 && lat <= 40.89 && lng >= -74.03 && lng <= -73.90;
    }

    function inSouth96Zone(lat, lng) {
        return inApproxManhattan(lat, lng) && lat <= 40.7935;
    }

    function inSouth60Zone(lat, lng) {
        return inApproxManhattan(lat, lng) && lat <= 40.7681;
    }

    function routeTouchesZone(path, zoneFn) {
        var i;
        if (!path || !path.length) return false;
        for (i = 0; i < path.length; i += 1) {
            if (zoneFn(path[i].lat(), path[i].lng())) {
                return true;
            }
        }
        return false;
    }

    function isAirport(place, code) {
        var p = AIRPORTS[code];
        var name = (place.name || "") + " " + (place.address || "");
        var lowered = name.toLowerCase();
        var byText = (code === "JFK" && (lowered.indexOf("jfk") !== -1 || lowered.indexOf("john f") !== -1)) ||
            (code === "LGA" && (lowered.indexOf("lga") !== -1 || lowered.indexOf("laguardia") !== -1)) ||
            (code === "EWR" && (lowered.indexOf("ewr") !== -1 || lowered.indexOf("newark") !== -1));
        if (byText) return true;
        return haversineMiles({ lat: place.lat, lng: place.lng }, { lat: p.lat, lng: p.lng }) <= p.radiusMiles;
    }

    function isManhattanEndpoint(geoResult, place) {
        var county = normalizeCounty(getAddressPart(geoResult, "administrative_area_level_2"));
        if (county === "New York") return true;
        return inApproxManhattan(place.lat, place.lng);
    }

    function inSet(obj, key) {
        return !!obj[key];
    }

    function computeFare(ctx) {
        var distanceMiles = ctx.distanceMiles;
        var durationSeconds = ctx.durationSeconds;
        var pickupTime = ctx.pickupTime;
        var pickupCounty = ctx.pickupCounty;
        var dropoffCounty = ctx.dropoffCounty;

        var isJfk = ctx.pickupIsJFK || ctx.dropoffIsJFK;
        var isLga = ctx.pickupIsLGA || ctx.dropoffIsLGA;
        var isEwr = ctx.pickupIsEWR || ctx.dropoffIsEWR;
        var jfkFlatEligible = isJfk && ctx.oneEndManhattan;

        var base = 3.00;
        var distanceUnits = distanceMiles / 0.2;
        var totalMinutes = durationSeconds / 60;
        var avgMph = totalMinutes > 0 ? distanceMiles / (totalMinutes / 60) : 0;
        var assumedCruiseMph = 18;
        var estimatedMovingMinutes = Math.min(totalMinutes, (distanceMiles / assumedCruiseMph) * 60);
        var slowTrafficMinutes = Math.max(totalMinutes - estimatedMovingMinutes, 0);
        var timeUnits = slowTrafficMinutes;
        var distanceCharge = 0;
        var timeCharge = 0;
        var rateMessage = "Rate #01 - Standard City Rate.";
        var notes = [];

        if (jfkFlatEligible) {
            base = 70.00;
            rateMessage = "Rate #2 - JFK Airport.";
            notes.push("Flat JFK-Manhattan fare applied.");
        } else {
            // Approximate meter behavior by splitting trip into moving distance-based
            // time and slow/stopped time-based minutes.
            distanceCharge = 0.70 * distanceUnits;
            timeCharge = 0.70 * timeUnits;
        }

        var surcharge = 0;

        if (inSet(MTA_SURCHARGE_COUNTIES, dropoffCounty)) {
            surcharge += 0.50;
            notes.push("$0.50 MTA state surcharge.");
        }

        surcharge += 1.00;

        if (!jfkFlatEligible && isOvernight(pickupTime)) {
            surcharge += 1.00;
            notes.push("$1.00 overnight surcharge.");
        }

        if (jfkFlatEligible) {
            if (isRushHour(pickupTime)) {
                surcharge += 5.00;
                notes.push("$5.00 JFK rush-hour surcharge.");
            }
        } else if (isRushHour(pickupTime)) {
            surcharge += 2.50;
            notes.push("$2.50 rush-hour surcharge.");
        }

        if (ctx.congestionSouth96) {
            surcharge += 2.50;
            notes.push("$2.50 NYS congestion surcharge.");
        }

        if (ctx.congestionSouth60) {
            surcharge += 0.75;
            notes.push("$0.75 MTA congestion pricing toll.");
        }

        if (ctx.pickupIsJFK || ctx.pickupIsLGA) {
            surcharge += 1.75;
            notes.push("$1.75 airport access pickup fee.");
        }

        if (isLga) {
            surcharge += 5.00;
            notes.push("$5.00 LGA surcharge.");
        }

        if (isEwr) {
            surcharge += 20.00;
            rateMessage = "Rate #3 - Newark Airport.";
            notes.push("$20.00 Newark surcharge (tolls extra)." );
        }

        if (!jfkFlatEligible && (dropoffCounty === "Nassau" || dropoffCounty === "Westchester" || pickupCounty === "Nassau" || pickupCounty === "Westchester")) {
            var outOfCityAdjustment = 0.5 * (distanceCharge + timeCharge);
            surcharge += outOfCityAdjustment;
            rateMessage = "Rate #04 - Out of City Rate to Nassau or Westchester.";
            notes.push("Approximation applied for out-of-city doubled segment.");
        }

        if (!isNycCounty(dropoffCounty) && !inSet(MTA_SURCHARGE_COUNTIES, dropoffCounty) && dropoffCounty) {
            rateMessage = "Rate #05 - Out of City Negotiated Flat Rate.";
            notes.push("Trips beyond NYC may require a negotiated flat fare.");
        }

        var subtotal = base + distanceCharge + timeCharge + surcharge;
        var total = Math.max(subtotal, 0);
        var rangePad = Math.max(total * 0.15, 2.00);

        return {
            total: total,
            rangeLow: Math.max(total - rangePad, 0),
            rangeHigh: total + rangePad,
            baseCharge: base,
            distanceCharge: distanceCharge,
            timeCharge: timeCharge,
            surchargeTotal: surcharge,
            rateMessage: rateMessage,
            message: "Distance " + distanceMiles.toFixed(2) + " mi, duration " + Math.round(durationSeconds / 60) + " min (avg " + avgMph.toFixed(1) + " mph). " +
                "Meter split approx: " + estimatedMovingMinutes.toFixed(1) + " moving min + " + slowTrafficMinutes.toFixed(1) + " slow/stopped min. " +
                notes.join(" ")
        };
    }

    function extractRouteData(route) {
        var leg = route.legs && route.legs[0] ? route.legs[0] : null;
        if (!leg) {
            throw new Error("No route leg available.");
        }
        return {
            distanceMiles: metersToMiles(leg.distance.value),
            durationSeconds: (leg.duration_in_traffic && leg.duration_in_traffic.value) || leg.duration.value,
            path: route.overview_path || []
        };
    }

    function setButtonBusy(isBusy) {
        var btn = byId("estimate-fare-btn");
        if (!btn) return;
        btn.disabled = isBusy;
        btn.textContent = isBusy ? "Estimating..." : "Estimate Fare";
    }

    async function estimateFare() {
        try {
            if (!state.pickup || !state.dropoff) {
                setEstimateStatus("Select a valid pickup and dropoff from suggestions.", "text-danger");
                return;
            }

            setButtonBusy(true);
            setEstimateStatus("Fetching route and fare details...", "text-muted");

            var pickupTime = getPickupTime();
            var route = await routeTrip(state.pickup, state.dropoff, pickupTime);
            var routeData = extractRouteData(route);

            var pickupGeo = await geocodeLatLng(state.pickup.lat, state.pickup.lng);
            var dropoffGeo = await geocodeLatLng(state.dropoff.lat, state.dropoff.lng);

            var pickupCounty = normalizeCounty(getAddressPart(pickupGeo, "administrative_area_level_2"));
            var dropoffCounty = normalizeCounty(getAddressPart(dropoffGeo, "administrative_area_level_2"));

            var pickupIsJFK = isAirport(state.pickup, "JFK");
            var dropoffIsJFK = isAirport(state.dropoff, "JFK");
            var pickupIsLGA = isAirport(state.pickup, "LGA");
            var dropoffIsLGA = isAirport(state.dropoff, "LGA");
            var pickupIsEWR = isAirport(state.pickup, "EWR");
            var dropoffIsEWR = isAirport(state.dropoff, "EWR");

            var zoneSouth96 = inSouth96Zone(state.pickup.lat, state.pickup.lng) ||
                inSouth96Zone(state.dropoff.lat, state.dropoff.lng) ||
                routeTouchesZone(routeData.path, inSouth96Zone);

            var zoneSouth60 = inSouth60Zone(state.pickup.lat, state.pickup.lng) ||
                inSouth60Zone(state.dropoff.lat, state.dropoff.lng) ||
                routeTouchesZone(routeData.path, inSouth60Zone);

            var fare = computeFare({
                distanceMiles: routeData.distanceMiles,
                durationSeconds: routeData.durationSeconds,
                pickupTime: pickupTime,
                pickupCounty: pickupCounty,
                dropoffCounty: dropoffCounty,
                pickupIsJFK: pickupIsJFK,
                dropoffIsJFK: dropoffIsJFK,
                pickupIsLGA: pickupIsLGA,
                dropoffIsLGA: dropoffIsLGA,
                pickupIsEWR: pickupIsEWR,
                dropoffIsEWR: dropoffIsEWR,
                oneEndManhattan: isManhattanEndpoint(pickupGeo, state.pickup) || isManhattanEndpoint(dropoffGeo, state.dropoff),
                congestionSouth96: zoneSouth96,
                congestionSouth60: zoneSouth60
            });

            applyFareDisplay(fare);
            setEstimateStatus("Estimate complete.", "text-success");
        } catch (err) {
            if (window.console && typeof window.console.error === "function") {
                console.error("Estimate error:", err);
            }
            resetFareDisplay();
            byId("fare-message").textContent = "Could not compute estimate for this trip. Try re-selecting both addresses.";
            setEstimateStatus("Unable to estimate. Check key permissions and selected places.", "text-danger");
        } finally {
            setButtonBusy(false);
        }
    }

    function setupEstimatorUi() {
        if (uiBound) return;
        var btn = byId("estimate-fare-btn");
        var pickupTimeEl = byId("pickup-time");
        if (pickupTimeEl && !pickupTimeEl.value) {
            pickupTimeEl.value = toLocalDatetimeValue(new Date());
        }
        if (btn) {
            btn.addEventListener("click", estimateFare);
        }
        uiBound = true;
    }

    window.initTaxiAutocomplete = function initTaxiAutocomplete() {
        services.geocoder = new google.maps.Geocoder();
        services.directions = new google.maps.DirectionsService();
        bindAutocomplete("pickup-location", "pickup-status", "pickup");
        bindAutocomplete("dropoff-location", "dropoff-status", "dropoff");
        setEstimateStatus("Autocomplete ready.", "text-success");
    };

    function loadGoogleMaps() {
        var pickupStatus = byId("pickup-status");
        var dropoffStatus = byId("dropoff-status");

        if (!window.GOOGLE_MAPS_API_KEY || window.GOOGLE_MAPS_API_KEY.indexOf("REPLACE_WITH") === 0) {
            setStatus(pickupStatus, "Missing API key in js/maps_config.js.", "text-danger");
            setStatus(dropoffStatus, "Missing API key in js/maps_config.js.", "text-danger");
            setEstimateStatus("Add a valid API key to enable estimation.", "text-danger");
            return;
        }

        setStatus(pickupStatus, "Loading Google autocomplete...", "text-muted");
        setStatus(dropoffStatus, "Loading Google autocomplete...", "text-muted");

        var s = document.createElement("script");
        s.src = "https://maps.googleapis.com/maps/api/js?key=" +
            encodeURIComponent(window.GOOGLE_MAPS_API_KEY) +
            "&libraries=places&callback=initTaxiAutocomplete";
        s.async = true;
        s.defer = true;
        s.onerror = function () {
            setStatus(pickupStatus, "Could not load Google Maps script.", "text-danger");
            setStatus(dropoffStatus, "Could not load Google Maps script.", "text-danger");
            setEstimateStatus("Check key restrictions and enabled APIs.", "text-danger");
        };
        document.head.appendChild(s);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", function () {
            resetFareDisplay();
            setupEstimatorUi();
            loadGoogleMaps();
        });
    } else {
        resetFareDisplay();
        setupEstimatorUi();
        loadGoogleMaps();
    }
})();
