PluginsAPI.Map.willAddControls([
  'coordsearch/style.css'
], function(args, _){
  var map = args.map
  var control = L.Control.extend({
    options: { position: 'topleft' },
    onAdd: function(){
      var container = L.DomUtil.create('div', 'leaflet-bar coordsearch-control')

      var toggle = L.DomUtil.create('div', 'coordsearch-toggle', container)
      var btn = L.DomUtil.create('a', '', toggle)
      btn.href = '#'
      btn.title = '坐标搜索'
      btn.innerHTML = '<i class="fa fa-search"></i>'

      var inputWrap = L.DomUtil.create('div', 'coordsearch-input', toggle)
      var input = L.DomUtil.create('input', '', inputWrap)
      input.type = 'text'
      input.placeholder = 'lng,lat 或 lat,lng'
      var go = L.DomUtil.create('button', 'btn btn-sm btn-primary', inputWrap)
      go.innerText = '搜索'

      function toggleExpand(e){
        if (e) L.DomEvent.preventDefault(e)
        if (L.DomUtil.hasClass(container, 'coordsearch-expanded')){
          L.DomUtil.removeClass(container, 'coordsearch-expanded')
        }else{
          L.DomUtil.addClass(container, 'coordsearch-expanded')
          setTimeout(function(){ input.focus() }, 0)
        }
      }

      function parseCoords(text){
        if (!text) return null
        var s = String(text).trim().replace(/，/g, ',')
        var parts = s.split(',').map(function(p){ return p.trim() })
        if (parts.length !== 2) return null
        var a = parseFloat(parts[0])
        var b = parseFloat(parts[1])
        if (!isFinite(a) || !isFinite(b)) return null
        // decide order: lng lat or lat lng
        var inLng = function(x){ return x>=-180 && x<=180 }
        var inLat = function(x){ return x>=-90 && x<=90 }
        if (inLng(a) && inLat(b)) return { lng: a, lat: b }
        if (inLat(a) && inLng(b)) return { lng: b, lat: a }
        // fallback treat first as lng
        return { lng: a, lat: b }
      }

      function doSearch(e){
        if (e) L.DomEvent.preventDefault(e)
        var c = parseCoords(input.value)
        if (!c){ alert('请输入有效坐标，如 lng,lat 或 lat,lng'); return }
        map.setView([c.lat, c.lng])
      }

      L.DomEvent.on(btn, 'click', toggleExpand)
      L.DomEvent.on(go, 'click', doSearch)
      L.DomEvent.on(input, 'keydown', function(e){ if (e.key === 'Enter') doSearch(e) })
      L.DomEvent.disableClickPropagation(container)
      return container
    }
  })

  new control().addTo(map)
})