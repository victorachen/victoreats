// VictorEats - Tab switching and Leaflet map

let map = null;
let mapInitialized = false;

function showTab(tab) {
  const listView = document.getElementById('view-list');
  const mapView = document.getElementById('view-map');
  const listBtn = document.getElementById('tab-list-btn');
  const mapBtn = document.getElementById('tab-map-btn');

  if (tab === 'list') {
    listView.style.display = 'block';
    mapView.style.display = 'none';
    listBtn.classList.add('active');
    mapBtn.classList.remove('active');
  } else {
    listView.style.display = 'none';
    mapView.style.display = 'block';
    listBtn.classList.remove('active');
    mapBtn.classList.add('active');

    // Lazy-init map only when tab is first shown
    if (!mapInitialized) {
      initMap();
    } else {
      map.invalidateSize();
    }
  }
}

function initMap() {
  map = L.map('map').setView([37.43, -121.9], 11);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(map);

  mapInitialized = true;

  // Fetch restaurant data and add markers
  fetch('/index.json')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      var bounds = [];
      data.forEach(function(item) {
        if (item.lat && item.lng) {
          var marker = L.marker([item.lat, item.lng]).addTo(map);

          var popupHtml = '<div style="max-width:220px;">';
          if (item.image) {
            popupHtml += '<img src="' + item.image + '" style="width:100%;height:120px;object-fit:cover;border-radius:4px;margin-bottom:8px;">';
          }
          popupHtml += '<strong>' + item.title + '</strong>';
          if (item.review) {
            popupHtml += '<p style="font-size:0.85rem;margin:6px 0;">' + item.review + '</p>';
          }
          popupHtml += '<a href="' + item.permalink + '" style="font-size:0.8rem;">Read more</a>';
          popupHtml += '</div>';

          marker.bindPopup(popupHtml);
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
