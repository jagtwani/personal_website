/* global google */
(function () {
    "use strict";

    function setStatus(el, msg, type) {
        if (!el) return;
        el.textContent = msg;
        el.classList.remove("text-muted", "text-success", "text-danger");
        el.classList.add(type || "text-muted");
    }

    function bindAutocomplete(inputId, statusId, stateKey) {
        var input = document.getElementById(inputId);
        var status = document.getElementById(statusId);
        if (!input || !status) return;

        var ac = new google.maps.places.Autocomplete(input, {
            fields: ["formatted_address", "geometry", "name", "place_id"],
            componentRestrictions: { country: "us" }
        });

        ac.addListener("place_changed", function () {
            var place = ac.getPlace();
            if (!place || !place.geometry || !place.geometry.location) {
                window.taxiEstimateState[stateKey] = null;
                setStatus(status, "Pick an address from the suggestions.", "text-danger");
                return;
            }

            window.taxiEstimateState[stateKey] = {
                placeId: place.place_id || "",
                address: place.formatted_address || input.value,
                lat: place.geometry.location.lat(),
                lng: place.geometry.location.lng()
            };
            setStatus(status, "Selected: " + window.taxiEstimateState[stateKey].address, "text-success");
        });

        input.addEventListener("input", function () {
            window.taxiEstimateState[stateKey] = null;
            setStatus(status, "Start typing to see suggestions.", "text-muted");
        });
    }

    window.initTaxiAutocomplete = function initTaxiAutocomplete() {
        window.taxiEstimateState = { pickup: null, dropoff: null };
        bindAutocomplete("pickup-location", "pickup-status", "pickup");
        bindAutocomplete("dropoff-location", "dropoff-status", "dropoff");
    };

    function loadGoogleMaps() {
        var pickupStatus = document.getElementById("pickup-status");
        var dropoffStatus = document.getElementById("dropoff-status");

        if (!window.GOOGLE_MAPS_API_KEY || window.GOOGLE_MAPS_API_KEY.indexOf("REPLACE_WITH") === 0) {
            setStatus(pickupStatus, "Missing API key in js/maps_config.js.", "text-danger");
            setStatus(dropoffStatus, "Missing API key in js/maps_config.js.", "text-danger");
            return;
        }

        setStatus(pickupStatus, "Loading autocomplete...", "text-muted");
        setStatus(dropoffStatus, "Loading autocomplete...", "text-muted");

        var s = document.createElement("script");
        s.src = "https://maps.googleapis.com/maps/api/js?key=" +
            encodeURIComponent(window.GOOGLE_MAPS_API_KEY) +
            "&libraries=places&callback=initTaxiAutocomplete";
        s.async = true;
        s.defer = true;
        s.onerror = function () {
            setStatus(pickupStatus, "Could not load Google Maps script.", "text-danger");
            setStatus(dropoffStatus, "Could not load Google Maps script.", "text-danger");
        };
        document.head.appendChild(s);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", loadGoogleMaps);
    } else {
        loadGoogleMaps();
    }
})();
