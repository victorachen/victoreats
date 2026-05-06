// VictorEats - Tab switching, Leaflet map, search, and inline editing

let map = null;
let mapInitialized = false;
let mapMarkers = [];

const WORKER = 'https://victoreats-edit.vchen2120.workers.dev';

// ---- Tab switching ----

function showTab(tab) {
  var tabs = ['serious', 'notserious', 'search', 'map', 'noneats'];
  tabs.forEach(function(t) {
    document.getElementById('view-' + t).style.display = t === tab ? 'block' : 'none';
    document.getElementById('tab-' + t + '-btn').classList.toggle('active', t === tab);
  });

  if (tab === 'map') {
    if (!mapInitialized) {
      initMap();
    } else {
      map.invalidateSize();
    }
  }
}

// ---- Leaflet map ----

function makeIcon(color) {
  return L.icon({
    iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-' + color + '.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
}

var redIcon = null;
var blueIcon = null;

function initMap() {
  map = L.map('map').setView([37.43, -121.9], 11);
  redIcon = makeIcon('red');
  blueIcon = makeIcon('blue');

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  mapInitialized = true;

  fetch('/index.json')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var bounds = [];
      data.forEach(function(item) {
        if (item.lat && item.lng) {
          var icon = item.serious ? redIcon : blueIcon;
          var marker = L.marker([item.lat, item.lng], { icon: icon }).addTo(map);

          var popupHtml = '<div style="max-width:220px;">';
          if (item.image) {
            popupHtml += '<img src="' + item.image + '" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-bottom:8px;">';
          }
          popupHtml += '<strong>' + item.title + '</strong>';
          if (item.address) {
            var escaped = item.address.replace(/'/g, "\\'");
            popupHtml += '<p style="font-size:0.8rem;color:#666;margin:4px 0 2px;">' + item.address + ' <button onclick="navigator.clipboard.writeText(\'' + escaped + '\');this.textContent=\'Copied!\';setTimeout(function(){this.textContent=\'Copy\';}.bind(this),1500)" style="font-size:0.7rem;padding:1px 6px;border:1px solid #ccc;border-radius:3px;background:#f8f8f8;cursor:pointer;margin-left:4px;">Copy</button></p>';
          }
          if (item.review) {
            var clean = item.review.replace(/&amp;/g, '&');
            popupHtml += '<p style="font-size:0.85rem;margin:6px 0;">' + clean + '</p>';
          }
          popupHtml += '<a href="' + item.permalink + '" style="font-size:0.8rem;">Read more</a>';
          popupHtml += '</div>';

          marker.bindPopup(popupHtml);
          marker._serious = item.serious;
          mapMarkers.push(marker);
          bounds.push([item.lat, item.lng]);
        }
      });

      if (bounds.length > 0) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      }
    })
    .catch(function(err) {
      console.error('Failed to load restaurant data:', err);
    });
}

function filterMap() {
  var seriousOnly = document.getElementById('map-serious-toggle').checked;
  mapMarkers.forEach(function(marker) {
    if (!seriousOnly || marker._serious) {
      marker.addTo(map);
    } else {
      map.removeLayer(marker);
    }
  });
}

// ---- Search ----

var userCoords = null;

function useMyLocation() {
  var btn = document.getElementById('search-loc-btn');
  var input = document.getElementById('search-address');
  var status = document.getElementById('search-status');

  if (!navigator.geolocation) {
    status.textContent = 'Geolocation is not supported by this browser.';
    status.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Locating...';

  navigator.geolocation.getCurrentPosition(function(pos) {
    userCoords = { lat: pos.coords.latitude, lng: pos.coords.longitude };
    input.value = '📍 Current location';
    btn.disabled = false;
    btn.textContent = '📍 Use my location';
  }, function(err) {
    userCoords = null;
    btn.disabled = false;
    btn.textContent = '📍 Use my location';
    var msg = 'Could not get your location';
    if (err.code === 1) msg = 'Location permission denied. Enable it in your browser settings.';
    else if (err.code === 2) msg = 'Location unavailable. Try again or type an address.';
    else if (err.code === 3) msg = 'Location request timed out.';
    status.textContent = msg;
    status.style.display = 'block';
  }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
}

function haversineDistance(lat1, lng1, lat2, lng2) {
  var R = 3958.8;
  var dLat = (lat2 - lat1) * Math.PI / 180;
  var dLng = (lng2 - lng1) * Math.PI / 180;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2)
    + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180)
    * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function runSearch() {
  var keyword = document.getElementById('search-keyword').value.trim().toLowerCase();
  var address = document.getElementById('search-address').value.trim();
  var radius = parseFloat(document.getElementById('search-radius').value);
  var filter = document.getElementById('search-filter').value;
  var btn = document.getElementById('search-btn');
  var status = document.getElementById('search-status');

  btn.disabled = true;
  btn.textContent = 'Searching...';
  status.style.display = 'none';

  var centerLat = null, centerLng = null, locationName = '';

  try {
    if (userCoords) {
      centerLat = userCoords.lat;
      centerLng = userCoords.lng;
      locationName = 'your location';
    } else if (address) {
      var res = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address), {
        headers: { 'User-Agent': 'VictorEats/1.0' }
      });
      var results = await res.json();
      if (!results.length) {
        status.textContent = 'Address not found. Try a more specific address.';
        status.style.display = 'block';
        return;
      }
      centerLat = parseFloat(results[0].lat);
      centerLng = parseFloat(results[0].lon);
      locationName = results[0].display_name.split(',').slice(0, 3).join(',');
    }

    var cards = document.querySelectorAll('#search-results .search-card');
    var shown = 0;

    cards.forEach(function(card) {
      var slug = card.dataset.slug;
      var data = postData[slug];
      var show = true;

      if (filter === 'serious' && card.dataset.serious !== 'true') show = false;
      if (filter === 'notserious' && card.dataset.serious === 'true') show = false;

      if (show && keyword) {
        var haystack = (data.title + ' ' + data.address + ' ' + data.review).toLowerCase();
        var words = keyword.split(/\s+/);
        for (var i = 0; i < words.length; i++) {
          if (haystack.indexOf(words[i]) === -1) { show = false; break; }
        }
      }

      if (show && centerLat !== null) {
        var lat = parseFloat(card.dataset.lat);
        var lng = parseFloat(card.dataset.lng);
        if (!lat || !lng) {
          show = false;
        } else {
          var dist = haversineDistance(centerLat, centerLng, lat, lng);
          if (dist > radius) show = false;
        }
      }

      card.style.display = show ? '' : 'none';
      if (show) shown++;
    });

    var parts = [];
    parts.push(shown + ' result' + (shown !== 1 ? 's' : ''));
    if (keyword) parts.push('matching "' + keyword + '"');
    if (centerLat !== null) parts.push('within ' + radius + ' miles of ' + locationName);
    if (filter === 'serious') parts.push('(serious eats only)');
    if (filter === 'notserious') parts.push('(not so serious only)');
    status.textContent = parts.join(' ');
    status.style.display = 'block';
  } catch (e) {
    status.textContent = 'Search failed: ' + e.message;
    status.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
  }
}

function clearSearch() {
  document.getElementById('search-keyword').value = '';
  document.getElementById('search-address').value = '';
  document.getElementById('search-radius').value = '10';
  document.getElementById('search-filter').value = 'all';
  document.getElementById('search-status').style.display = 'none';
  userCoords = null;
  document.querySelectorAll('#search-results .search-card').forEach(function(card) {
    card.style.display = 'none';
  });
}

document.addEventListener('DOMContentLoaded', function() {
  document.getElementById('search-keyword').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') runSearch();
  });
  var addrInput = document.getElementById('search-address');
  addrInput.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') runSearch();
  });
  addrInput.addEventListener('input', function() {
    if (addrInput.value !== '📍 Current location') userCoords = null;
  });
  addrInput.addEventListener('focus', function() {
    if (addrInput.value === '📍 Current location') {
      addrInput.value = '';
      userCoords = null;
    }
  });
});

// ---- Edit / Delete ----

function openEdit(slug) {
  var data = postData[slug];
  if (!data) { alert('Post not found'); return; }

  document.getElementById('edit-slug').value = slug;
  document.getElementById('edit-title').value = data.title;
  document.getElementById('edit-address').value = data.address;
  document.getElementById('edit-review').value = data.review.trim();
  document.getElementById('edit-serious-yes').checked = data.serious;
  document.getElementById('edit-serious-no').checked = !data.serious;
  document.getElementById('edit-save-btn').disabled = false;
  document.getElementById('edit-delete-btn').disabled = false;
  document.getElementById('edit-modal').style.display = 'flex';
}

function closeEdit() {
  document.getElementById('edit-modal').style.display = 'none';
}

async function saveEdit() {
  var slug = document.getElementById('edit-slug').value;
  var title = document.getElementById('edit-title').value;
  var address = document.getElementById('edit-address').value;
  var review = document.getElementById('edit-review').value;
  var serious = document.getElementById('edit-serious-yes').checked;
  var image = postData[slug].image;
  var date = postData[slug].date;
  var lat = postData[slug].lat;
  var lng = postData[slug].lng;

  var addressChanged = address !== postData[slug].address;
  var coordsMissing = !lat || !lng;
  var saveBtn = document.getElementById('edit-save-btn');
  saveBtn.disabled = true;

  try {
    if (addressChanged || coordsMissing) {
      saveBtn.textContent = 'Geocoding...';
      var geoRes = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(address), {
        headers: { 'User-Agent': 'VictorEats/1.0' }
      });
      var geoResults = await geoRes.json();
      if (!geoResults.length) {
        alert('Could not geocode this address. Save aborted — try a more specific address (street + city + state).');
        return;
      }
      lat = parseFloat(geoResults[0].lat);
      lng = parseFloat(geoResults[0].lon);
    }

    saveBtn.textContent = 'Saving...';

    var md = '---\n'
      + 'title: "' + title.replace(/"/g, '\\"') + '"\n'
      + 'date: ' + date + '\n'
      + 'draft: false\n'
      + 'address: "' + address.replace(/"/g, '\\"') + '"\n'
      + 'lat: ' + lat + '\n'
      + 'lng: ' + lng + '\n'
      + 'image: "' + image + '"\n'
      + 'serious: ' + serious + '\n'
      + '---\n\n'
      + review + '\n';

    var path = 'content/posts/' + slug + '.md';
    var res = await fetch(WORKER + '/contents/' + path);
    if (!res.ok) throw new Error('Failed to fetch file: ' + res.status);
    var fileData = await res.json();

    var updateRes = await fetch(WORKER + '/contents/' + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update ' + title,
        content: btoa(unescape(encodeURIComponent(md))),
        sha: fileData.sha
      })
    });
    if (!updateRes.ok) throw new Error('Failed to save: ' + updateRes.status);

    alert('Saved! Site will rebuild in about a minute.');
    closeEdit();
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    document.getElementById('edit-save-btn').disabled = false;
    document.getElementById('edit-save-btn').textContent = 'Save';
  }
}

// ---- Steps modal ----

function formatDateLong(dateStr) {
  // dateStr is "YYYY-MM-DD"; build a Date in local time to avoid TZ shift
  var parts = dateStr.split('-');
  var d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
  var months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  var day = d.getDate();
  var suffix = 'th';
  var mod10 = day % 10, mod100 = day % 100;
  if (mod100 !== 11 && mod10 === 1) suffix = 'st';
  else if (mod100 !== 12 && mod10 === 2) suffix = 'nd';
  else if (mod100 !== 13 && mod10 === 3) suffix = 'rd';
  return months[d.getMonth()] + ' ' + day + suffix + ', ' + d.getFullYear();
}

function dayNumber(dateStr) {
  var s = stepsStart.split('-');
  var start = new Date(parseInt(s[0], 10), parseInt(s[1], 10) - 1, parseInt(s[2], 10));
  var p = dateStr.split('-');
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  return Math.round((d - start) / 86400000) + 1;
}

function openSteps(dateStr) {
  var entry = stepsData[dateStr];
  if (!entry) return;

  document.getElementById('steps-modal-title').textContent =
    'Day ' + dayNumber(dateStr) + ' — ' + formatDateLong(dateStr);

  var countEl = document.getElementById('steps-modal-count');
  var diff = entry.steps - stepsGoal;
  var diffStr = (diff >= 0 ? '+' : '') + diff.toLocaleString();
  countEl.textContent = entry.steps.toLocaleString() + ' steps (' + diffStr + ' vs goal)';
  countEl.classList.toggle('under-goal', entry.steps < stepsGoal);

  var noteEl = document.getElementById('steps-modal-note');
  if (entry.note) {
    noteEl.textContent = '"' + entry.note + '"';
    noteEl.style.display = '';
  } else {
    noteEl.style.display = 'none';
  }

  var imgWrap = document.getElementById('steps-modal-image-wrap');
  var img = document.getElementById('steps-modal-image');
  if (entry.image) {
    img.src = entry.image;
    img.alt = 'Day ' + dayNumber(dateStr);
    imgWrap.style.display = '';
  } else {
    imgWrap.style.display = 'none';
    img.src = '';
  }

  document.getElementById('steps-modal').style.display = 'flex';
}

function closeSteps() {
  document.getElementById('steps-modal').style.display = 'none';
}

async function deletePost() {
  if (!confirm('Delete this post permanently?')) return;

  var slug = document.getElementById('edit-slug').value;

  document.getElementById('edit-delete-btn').disabled = true;
  document.getElementById('edit-delete-btn').textContent = 'Deleting...';

  try {
    var path = 'content/posts/' + slug + '.md';
    var res = await fetch(WORKER + '/contents/' + path);
    if (!res.ok) throw new Error('Failed to fetch file: ' + res.status);
    var fileData = await res.json();

    var delRes = await fetch(WORKER + '/contents/' + path, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Delete ' + postData[slug].title,
        sha: fileData.sha
      })
    });
    if (!delRes.ok) throw new Error('Failed to delete: ' + delRes.status);

    alert('Deleted! Site will rebuild in about a minute.');
    closeEdit();
    location.reload();
  } catch (e) {
    alert('Error: ' + e.message);
  } finally {
    document.getElementById('edit-delete-btn').disabled = false;
    document.getElementById('edit-delete-btn').textContent = 'Delete';
  }
}
